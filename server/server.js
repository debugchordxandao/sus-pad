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

// Health check endpoint for Railway, Render, container monitors
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Serve static assets from public/ and audio/
app.use(express.static(path.join(__dirname, '../public')));
app.use('/audio', express.static(path.join(__dirname, '../audio')));

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

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  // Disable Nagle's algorithm for sub-millisecond real-time live performance
  if (ws._socket && ws._socket.setNoDelay) {
    ws._socket.setNoDelay(true);
  }

  ws.isAlive = true;
  ws.roomCode = null;
  ws.role = null;
  ws.clientName = null;
  ws.clientId = Math.random().toString(36).substring(2, 9);
  ws.latency = 0;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
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

    // PIN Authentication Check
    const pinCheck = validateRolePin(room, chosenRole, msg.pin || msg.leaderPin);
    if (!pinCheck.valid) {
      ws.send(JSON.stringify({
        type: 'error',
        message: pinCheck.message
      }));
      return;
    }

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

  // 5. Host State Confirmation & Broadcast
  if (ws.role === 'host' && type === 'host_state_update') {
    room.state = { ...room.state, ...msg.state };
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
