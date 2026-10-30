/**
 * PadStudio Live - Collaborative Band Server
 * Express + WebSocket (TCP_NODELAY) + REST API + HTTPS optional
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const apiRoutes = require('./routes');
const { validateRolePin } = require('./auth');
const {
  rooms,
  createRoom,
  getRoom,
  updateRoomState,
  broadcastToRoom,
  notifyRoomMembers,
  isActionAllowed,
  formatRoleName
} = require('./rooms');

const app = express();

const PORT = process.env.PORT || 3000;
const keyPath = process.env.SSL_KEY || path.join(__dirname, '../key.pem');
const certPath = process.env.SSL_CERT || path.join(__dirname, '../cert.pem');

let server;
let isHttps = false;

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    server = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    }, app);
    isHttps = true;
    console.log('[HTTPS] Certificados SSL locais carregados com sucesso.');
  } catch (err) {
    console.warn('[HTTPS] Falha ao carregar certificados, iniciando em HTTP:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server });

// Express Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Railway, Render, container monitors (verifies disk write access)
app.get('/health', (req, res) => {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  let isWritable = false;
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const testFile = path.join(dataDir, `.health_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    isWritable = true;
  } catch (err) {
    console.error('[HEALTH CHECK ERROR] Falha na escrita em DATA_DIR:', err.message);
    return res.status(500).json({
      status: 'error',
      storage: 'read-only or unavailable',
      error: err.message,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  res.status(200).json({
    status: 'ok',
    storage: 'writable',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Serve static assets from public/ and audio/
app.use(express.static(path.join(__dirname, '../public')));
app.use('/audio', express.static(path.join(__dirname, '../audio')));

// Test comparison route for loop-test.html (serves original WAVs from backup outside deploy)
const backupWavPath = path.join(__dirname, '../_audio_backup_wav');
if (fs.existsSync(backupWavPath)) {
  app.use('/test-audio-wav', express.static(backupWavPath));
}

// Get local IPv4 addresses on Wi-Fi/LAN
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ name, address: iface.address });
      }
    }
  }
  addresses.sort((a, b) => {
    if (a.name === 'en0') return -1;
    if (b.name === 'en0') return 1;
    return 0;
  });
  return addresses;
}

// Mount Modular REST API Routes (/api/*)
app.use('/api', apiRoutes);

// Discovery API
app.get('/api/server-info', (req, res) => {
  res.json({
    ips: getLocalIpAddresses(),
    port: PORT,
    protocol: isHttps ? 'https' : 'http',
    isServerless: false
  });
});

// PIN Rate Limiting per IP
const pinAttemptsByIp = new Map();

function checkPinRateLimit(ip) {
  const rec = pinAttemptsByIp.get(ip);
  if (rec && rec.lockedUntil && Date.now() < rec.lockedUntil) {
    const remainingMin = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    return { allowed: false, message: `Muitas tentativas de PIN incorretas. Tente novamente em ${remainingMin} minuto(s).` };
  }
  return { allowed: true };
}

function recordFailedPin(ip) {
  const rec = pinAttemptsByIp.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count++;
  if (rec.count >= 5) {
    rec.lockedUntil = Date.now() + 10 * 60 * 1000; // 10 min lockout
    rec.count = 0;
    console.warn(`[SEGURANÇA] IP ${ip} bloqueado temporariamente por 5 tentativas de PIN inválidas.`);
  }
  pinAttemptsByIp.set(ip, rec);
}

function resetPinFailures(ip) {
  pinAttemptsByIp.delete(ip);
}

// Strict Message Schema Validation
function isValidMessageFormat(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (!msg.type || typeof msg.type !== 'string' || msg.type.length > 50) return false;
  if (msg.toneIndex !== undefined && (typeof msg.toneIndex !== 'number' || msg.toneIndex < 0 || msg.toneIndex > 11)) return false;
  if (msg.bpm !== undefined && (typeof msg.bpm !== 'number' || msg.bpm < 30 || msg.bpm > 320)) return false;
  if (msg.velocity !== undefined && (typeof msg.velocity !== 'number' || msg.velocity < 0 || msg.velocity > 1)) return false;
  return true;
}

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  // Disable Nagle's algorithm for sub-millisecond real-time live performance
  if (ws._socket && ws._socket.setNoDelay) {
    ws._socket.setNoDelay(true);
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  ws.clientIp = clientIp;
  ws.isAlive = true;
  ws.roomCode = null;
  ws.role = null;
  ws.clientName = null;
  ws.clientId = Math.random().toString(36).substring(2, 9);
  ws.latency = 0;
  ws.msgCount = 0;
  ws.lastSec = Date.now();

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    // 1. Size limit (max 4096 bytes per message)
    if (raw.length > 4096) {
      ws.send(JSON.stringify({ type: 'error', message: 'Mensagem excede o tamanho limite permitido (4 KB).' }));
      return;
    }

    // 2. Rate limit (max 80 msgs per second per socket)
    const now = Date.now();
    if (now - ws.lastSec > 1000) {
      ws.lastSec = now;
      ws.msgCount = 0;
    }
    ws.msgCount++;
    if (ws.msgCount > 80) {
      return; // Drop excess packets silently to prevent abuse
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Formato JSON inválido.' }));
      return;
    }

    // 3. Schema structure validation
    if (!isValidMessageFormat(msg)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Estrutura da mensagem inválida.' }));
      return;
    }

    handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    handleClientDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error(`[WS Error ${ws.clientId}]:`, err.message);
  });
});

// Process incoming WebSocket messages
function handleClientMessage(ws, msg) {
  const type = msg.type;

  // 1. Latency Ping/Pong
  if (type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime }));
    if (typeof msg.measuredLatency === 'number') {
      ws.latency = Math.round(msg.measuredLatency);
      notifyRoomMembers(ws.roomCode);
    }
    return;
  }

  // 2. Room Creation (HOST)
  if (type === 'create_room') {
    const room = createRoom({
      hostWs: ws,
      roomPin: msg.roomPin,
      leaderPin: msg.leaderPin
    });

    ws.send(JSON.stringify({
      type: 'room_created',
      roomCode: room.code,
      role: 'host',
      hostToken: room.hostToken,
      hasRoomPin: !!room.roomPin,
      hasLeaderPin: !!room.leaderPin,
      state: room.state
    }));

    console.log(`[Sala Criada]: ${room.code} (HOST conectado)`);
    return;
  }

  // 2b. Reconnect HOST
  if (type === 'reconnect_host') {
    const code = (msg.roomCode || '').toUpperCase().trim();
    const token = msg.hostToken;
    const room = getRoom(code);

    if (!room) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Sala "${code}" não encontrada ou expirada.`
      }));
      return;
    }

    if (!token || room.hostToken !== token) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Token de anfitrião inválido para esta sala.'
      }));
      return;
    }

    // Host re-authenticated
    room.hostWs = ws;
    room.clients.add(ws);
    ws.roomCode = code;
    ws.role = 'host';
    ws.clientName = 'Mesa de Som (HOST)';
    ws.hostToken = token;

    ws.send(JSON.stringify({
      type: 'room_reconnected',
      roomCode: code,
      role: 'host',
      hostToken: token,
      state: room.state,
      permissions: room.permissions
    }));

    broadcastToRoom(room, {
      type: 'host_reconnected',
      message: 'HOST restabeleceu conexão com a sala.'
    }, ws);

    notifyRoomMembers(code);
    console.log(`[HOST Reconectado]: Sala ${code}`);
    return;
  }

  // 3. Room Joining (REMOTE CONTROLLERS)
  if (type === 'join_room') {
    const code = (msg.roomCode || '').toUpperCase().trim();
    const room = getRoom(code);

    if (!room) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Sala "${code}" não encontrada. Verifique o código no HOST.`
      }));
      return;
    }

    // Security: Only allow remote controller roles in join_room (never 'host')
    const validRoles = ['keyboardist', 'drummer', 'leader'];
    const chosenRole = validRoles.includes(msg.role) ? msg.role : null;
    if (!chosenRole) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Papel inválido "${msg.role}". Apenas Tecladista, Baterista ou Líder podem entrar.`
      }));
      return;
    }

    // PIN Rate Limiting Check
    const rateCheck = checkPinRateLimit(ws.clientIp);
    if (!rateCheck.allowed) {
      ws.send(JSON.stringify({
        type: 'error',
        message: rateCheck.message
      }));
      return;
    }

    // PIN Authentication Check
    const pinCheck = validateRolePin(room, chosenRole, msg.pin || msg.leaderPin);
    if (!pinCheck.valid) {
      recordFailedPin(ws.clientIp);
      ws.send(JSON.stringify({
        type: 'error',
        message: pinCheck.message
      }));
      return;
    }
    resetPinFailures(ws.clientIp);

    // Assign role
    ws.roomCode = code;
    ws.role = chosenRole;
    ws.clientName = msg.name || formatRoleName(ws.role);
    room.clients.add(ws);

    // Confirm connection to controller with current room state
    ws.send(JSON.stringify({
      type: 'room_joined',
      roomCode: code,
      role: ws.role,
      name: ws.clientName,
      state: room.state,
      permissions: room.permissions
    }));

    // Notify HOST and everyone that a new member arrived
    notifyRoomMembers(code);
    console.log(`[Entrou na Sala ${code}]: ${ws.clientName} (${ws.role})`);
    return;
  }

  // Guard: ensure client is in a valid room
  const room = getRoom(ws.roomCode);
  if (!room) return;

  // 4. Role Permissions Enforcement
  if (!isActionAllowed(ws.role, msg, room.permissions)) {
    ws.send(JSON.stringify({
      type: 'permission_denied',
      action: type,
      message: 'Seu papel atual não tem permissão para este comando.'
    }));
    return;
  }

  // 5. Host State Confirmation & Broadcast (Persists to SQLite)
  if (ws.role === 'host' && type === 'host_state_update') {
    updateRoomState(room, msg.state);
    broadcastToRoom(room, {
      type: 'state',
      state: room.state
    }, ws); // don't echo to host
    return;
  }

  // 6. Commands from Controllers -> Relay to HOST
  if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
    room.hostWs.send(JSON.stringify({
      ...msg,
      fromRole: ws.role,
      fromClientId: ws.clientId,
      fromName: ws.clientName
    }));
  } else {
    ws.send(JSON.stringify({
      type: 'host_offline',
      message: 'O aparelho HOST de áudio está desconectado.'
    }));
  }
}

function handleClientDisconnect(ws) {
  if (!ws.roomCode) return;
  const room = getRoom(ws.roomCode);
  if (!room) return;

  room.clients.delete(ws);

  if (ws.role === 'host') {
    room.hostWs = null;
    console.log(`[HOST DESCONECTOU]: Sala ${ws.roomCode}`);
    broadcastToRoom(room, {
      type: 'host_disconnected',
      message: 'O HOST de áudio foi desconectado. Aguardando reconexão...'
    });
  } else {
    console.log(`[Controle Saiu]: ${ws.clientName} da sala ${ws.roomCode}`);
    notifyRoomMembers(ws.roomCode);
  }
}

// Keep-alive heartbeat (30s interval)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Start Server & Print Wi-Fi Connection Information
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  const scheme = isHttps ? 'https' : 'http';
  console.log('====================================================');
  console.log('  🎵 PadStudio Live - Servidor de Banda ao Vivo 🎵  ');
  console.log('====================================================');
  console.log(`\n• Acesso Local no Mac/PC:`);
  console.log(`  ${scheme}://localhost:${PORT}`);
  console.log(`\n• Acesso nos Celulares/Tablets na mesma rede Wi-Fi:`);
  if (ips.length === 0) {
    console.log(`  ${scheme}://<seu-ip-local>:${PORT}`);
  } else {
    ips.forEach(iface => {
      console.log(`  ${scheme}://${iface.address}:${PORT}  (${iface.name})`);
    });
  }
  console.log('\n====================================================\n');
});
