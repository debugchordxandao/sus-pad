/**
 * Sus Pad - Collaborative Band Server
 * Express + WebSocket (TCP_NODELAY) + REST API + HTTPS optional
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

// Carrega variáveis do arquivo .env ou .env.local se existirem (apenas fora do ambiente de teste)
if (process.env.NODE_ENV !== 'test') {
  for (const envFile of ['.env.local', '.env']) {
    const envPath = path.join(__dirname, '..', envFile);
    if (fs.existsSync(envPath)) {
      try {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (_) {}
    }
  }
}

const apiRoutes = require('./routes');
const { getClientIp, pinLimiter, roomLookupLimiter } = require('./rate-limit');
const { validateRolePin } = require('./auth');
const {
  createRoom,
  getRoom,
  updateRoomState,
  broadcastToRoom,
  notifyRoomMembers,
  isActionAllowed,
  setRoomPermissions,
  formatRoleName,
  flushAllRooms
} = require('./rooms');

const app = express();

const PORT = process.env.PORT || 3000;

// Limites de tamanho: o host envia o estado completo (inclui o repertório), controles enviam comandos curtos
const MAX_CLIENT_MSG_BYTES = 32 * 1024; // comporta colar um repertório inteiro
const MAX_HOST_MSG_BYTES = 128 * 1024;
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

const wss = new WebSocketServer({ server, maxPayload: MAX_HOST_MSG_BYTES });

// Express Middlewares
if (process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  next();
});
// O repertório da conta leva as cifras coladas, então tem limite maior (a rota exige login)
app.use('/api/auth/library', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Health check endpoint for Railway, Render, container monitors (verifies disk write access)
app.get('/health', (req, res) => {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const testFile = path.join(dataDir, `.health_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
  } catch (err) {
    console.error('[HEALTH CHECK ERROR] Falha na escrita em DATA_DIR:', err.message);
    return res.status(500).json({
      status: 'error',
      storage: 'read-only or unavailable',
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
// HTML/JS/CSS sempre revalidados (deploy novo aparece na hora); áudio é imutável e fica em cache longo
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders(res, filePath) {
    if (/\.(html|js|css|json)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use('/audio', express.static(path.join(__dirname, '../audio'), {
  maxAge: '30d',
  immutable: true
}));

// Ferramentas de desenvolvimento (calibração dos loops): nunca expostas em produção
if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/loop-test', (req, res) => res.sendFile(path.join(__dirname, '../tools/loop-test.html')));
  const backupWavPath = path.join(__dirname, '../_audio_backup_wav');
  if (fs.existsSync(backupWavPath)) {
    app.use('/test-audio-wav', express.static(backupWavPath));
  }
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


function sanitizeName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return clean || fallback;
}

function sanitizePin(pin) {
  if (pin === undefined || pin === null || pin === '') return undefined;
  if (typeof pin !== 'string' && typeof pin !== 'number') return undefined;
  return String(pin).trim().slice(0, 12);
}

// Validação estrutural das mensagens (o host ainda normaliza tudo que executa)
const isShortString = (v, max = 40) => typeof v === 'string' && v.length <= max;
const optional = (v, check) => v === undefined || check(v);

function isValidMessageFormat(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (!isShortString(msg.type, 50) || !msg.type) return false;
  const checks = [
    optional(msg.toneIndex, v => Number.isInteger(v) && v >= 0 && v <= 11),
    optional(msg.padIndex, v => Number.isInteger(v) && v >= 0 && v <= 15),
    optional(msg.velocity, v => typeof v === 'number' && v >= 0 && v <= 1),
    optional(msg.delta, v => v === 1 || v === -1),
    optional(msg.value, v => (typeof v === 'number' && Number.isFinite(v)) || isShortString(v, 20)),
    optional(msg.countIn, v => typeof v === 'boolean'),
    optional(msg.subdivide, v => typeof v === 'boolean'),
    ...['songId', 'listId', 'kitId', 'preset', 'action', 'target', 'clickSound', 'role', 'roomCode']
      .map(key => optional(msg[key], v => isShortString(v))),
    optional(msg.order, v => Array.isArray(v) && v.length <= 300 && v.every(id => isShortString(id))),
    optional(msg.songs, v => Array.isArray(v) && v.length <= 300 && v.every(s => s && typeof s === 'object')),
    optional(msg.text, v => isShortString(v, 60)),
    optional(msg.name, v => isShortString(v, 60)),
    ...['song', 'updates', 'permissions', 'state'].map(key => optional(msg[key], v => v && typeof v === 'object' && !Array.isArray(v)))
  ];
  return checks.every(Boolean);
}

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  // Disable Nagle's algorithm for sub-millisecond real-time live performance
  if (ws._socket && ws._socket.setNoDelay) {
    ws._socket.setNoDelay(true);
  }

  ws.clientIp = getClientIp(req);
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
    // 1. Size limit
    const limit = ws.role === 'host' ? MAX_HOST_MSG_BYTES : MAX_CLIENT_MSG_BYTES;
    if (raw.length > limit) {
      ws.send(JSON.stringify({ type: 'error', message: `Mensagem acima do limite de ${Math.round(limit / 1024)} KB.` }));
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

    try {
      handleClientMessage(ws, msg);
    } catch (err) {
      // Uma mensagem malformada nunca pode derrubar a sala inteira
      console.error(`[WS] Erro ao processar "${msg.type}" de ${ws.clientId}:`, err);
      safeSend(ws, { type: 'error', message: 'Não foi possível processar o comando.' });
    }
  });

  ws.on('close', () => {
    handleClientDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error(`[WS Error ${ws.clientId}]:`, err.message);
  });
});

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (e) { /* conexão caiu */ }
  }
}

// Process incoming WebSocket messages
function handleClientMessage(ws, msg) {
  const type = msg.type;

  // 1. Latency Ping/Pong
  if (type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() }));
    if (typeof msg.measuredLatency === 'number' && Number.isFinite(msg.measuredLatency)) {
      const latency = Math.max(0, Math.min(10000, Math.round(msg.measuredLatency)));
      // Só reenvia a lista de membros quando a latência muda de verdade
      if (Math.abs(latency - ws.latency) >= 3) {
        ws.latency = latency;
        notifyRoomMembers(ws.roomCode);
      }
    }
    return;
  }

  // 2. Room Creation (HOST)
  if (type === 'create_room') {
    const room = createRoom({
      hostWs: ws,
      roomPin: sanitizePin(msg.roomPin),
      leaderPin: sanitizePin(msg.leaderPin)
    });

    ws.send(JSON.stringify({
      type: 'room_created',
      roomCode: room.code,
      role: 'host',
      hostToken: room.hostToken,
      hasRoomPin: !!room.roomPin,
      hasLeaderPin: !!room.leaderPin,
      permissions: room.permissions,
      state: room.state
    }));

    console.log(`[Sala Criada]: ${room.code} (HOST conectado)`);
    return;
  }

  // 2b. Reconnect HOST
  if (type === 'reconnect_host') {
    const lookup = roomLookupLimiter.check(ws.clientIp);
    if (!lookup.allowed) return safeSend(ws, { type: 'error', message: lookup.message });

    const code = String(msg.roomCode || '').toUpperCase().trim();
    const token = msg.hostToken;
    const room = getRoom(code);
    // Mesma resposta para sala inexistente e token errado: não revela quais salas existem
    if (!room || typeof token !== 'string' || room.hostToken !== token) {
      roomLookupLimiter.fail(ws.clientIp);
      return safeSend(ws, { type: 'error', message: `Sala "${code}" não encontrada ou expirada.` });
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
    const lookup = roomLookupLimiter.check(ws.clientIp);
    if (!lookup.allowed) return safeSend(ws, { type: 'error', message: lookup.message });

    const code = String(msg.roomCode || '').toUpperCase().trim();
    const room = getRoom(code);

    if (!room) {
      roomLookupLimiter.fail(ws.clientIp);
      return safeSend(ws, { type: 'error', message: `Sala "${code}" não encontrada. Confira o código na tela do host.` });
    }

    // Security: Only allow remote controller roles in join_room (never 'host')
    const validRoles = ['keyboardist', 'drummer', 'leader'];
    const chosenRole = validRoles.includes(msg.role) ? msg.role : null;
    if (!chosenRole) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Papel inválido "${msg.role}". Apenas Tecladista, Baterista ou Host podem entrar.`
      }));
      return;
    }

    // PIN Rate Limiting Check
    const rateCheck = pinLimiter.check(ws.clientIp);
    if (!rateCheck.allowed) {
      ws.send(JSON.stringify({
        type: 'error',
        message: rateCheck.message
      }));
      return;
    }

    // PIN Authentication Check
    const pinCheck = validateRolePin(room, chosenRole, sanitizePin(msg.pin ?? msg.leaderPin));
    if (!pinCheck.valid) {
      pinLimiter.fail(ws.clientIp);
      ws.send(JSON.stringify({
        type: 'error',
        message: pinCheck.message
      }));
      return;
    }
    pinLimiter.reset(ws.clientIp);
    roomLookupLimiter.reset(ws.clientIp);

    // Assign role
    ws.roomCode = code;
    ws.role = chosenRole;
    ws.clientName = sanitizeName(msg.name, formatRoleName(ws.role));
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

  // 5b. Sinais para a banda: vão para todos os aparelhos da sala (inclusive quem enviou)
  if (type === 'cue') {
    const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
    if (!text) return;
    broadcastToRoom(room, { type: 'cue', text, from: ws.clientName, fromRole: ws.role });
    return;
  }

  // 5a. Permissões por função (só o host)
  if (type === 'set_permissions') {
    const permissions = setRoomPermissions(room, msg.permissions);
    broadcastToRoom(room, { type: 'permissions', permissions });
    return;
  }

  // 5. Host State Confirmation & Broadcast (Persists to SQLite)
  if (ws.role === 'host' && type === 'host_state_update') {
    if (!msg.state || typeof msg.state !== 'object' || Array.isArray(msg.state)) return;
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
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Encerramento limpo (Railway/Render enviam SIGTERM a cada deploy)
function shutdown(signal) {
  console.log(`\n[${signal}] Encerrando: avisando salas e salvando estado...`);
  clearInterval(heartbeat);
  for (const client of wss.clients) {
    safeSend(client, { type: 'server_restarting', message: 'Servidor reiniciando. Reconectando em instantes...' });
    client.close(1012, 'restart');
  }
  flushAllRooms();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start Server & Print Wi-Fi Connection Information
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  const scheme = isHttps ? 'https' : 'http';
  console.log('====================================================');
  console.log('  🎵 Sus Pad - Servidor de Banda ao Vivo 🎵  ');
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
