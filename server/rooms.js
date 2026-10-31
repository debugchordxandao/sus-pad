/**
 * PadStudio Live - Room Manager Module
 * Manages rooms, role permissions, PIN security, state synchronization,
 * and SQLite persistence across server reboots.
 */

const crypto = require('crypto');
const { WebSocket } = require('ws');
const { saveRoomDb, loadActiveRoomsDb, deleteRoomDb } = require('./db');
const { defaultPermissions, normalizePermissions, isCommandAllowed } = require('./permissions');

// Room Characters (ambiguity-free alphanumeric)
const ROOM_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CHARS[crypto.randomInt(ROOM_CHARS.length)];
  }
  return code;
}

// Global Rooms Map
const rooms = new Map();

// Recover active rooms from persistent SQLite database on startup
(function loadSavedRooms() {
  try {
    const saved = loadActiveRoomsDb(15 * 60 * 1000);
    for (const r of saved) {
      rooms.set(r.code, {
        code: r.code,
        hostToken: r.hostToken,
        hostWs: null,
        ownerId: r.ownerId,
        roomPin: r.roomPin,
        leaderPin: r.leaderPin,
        clients: new Set(),
        permissions: normalizePermissions(r.permissions),
        state: r.state,
        createdAt: r.createdAt,
        lastActivity: r.lastActivity
      });
    }
    if (saved.length > 0) {
      console.log(`[DB] ${saved.length} sala(s) ativa(s) recuperada(s) do banco de dados persistente.`);
    }
  } catch (err) {
    console.warn('[DB] Aviso ao restaurar salas do SQLite:', err.message);
  }
})();

function createRoom({ hostWs = null, roomPin = null, leaderPin = null, ownerId = null } = {}) {
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  // Token do host dá controle total da sala: precisa ser imprevisível
  const hostToken = crypto.randomBytes(24).toString('base64url');

  const room = {
    code,
    hostToken,
    hostWs,
    ownerId,
    roomPin: roomPin ? String(roomPin).trim() : null,
    leaderPin: leaderPin ? String(leaderPin).trim() : null,
    clients: new Set(),
    permissions: defaultPermissions(),
    // O host envia o estado completo assim que entra na sala
    state: {},
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  if (hostWs) {
    room.clients.add(hostWs);
    hostWs.roomCode = code;
    hostWs.role = 'host';
    hostWs.clientName = 'Mesa de Som (HOST)';
    hostWs.hostToken = hostToken;
  }

  rooms.set(code, room);
  saveRoomDb(room);
  return room;
}

function getRoom(code) {
  if (typeof code !== 'string' || !code) return null;
  return rooms.get(code.toUpperCase().trim()) || null;
}

function deleteRoom(code) {
  if (!code) return false;
  const upper = code.toUpperCase().trim();
  clearTimeout(pendingSaves.get(upper));
  pendingSaves.delete(upper);
  deleteRoomDb(upper);
  return rooms.delete(upper);
}

// Real-Time Broadcast to Room (WebSocket with TCP_NODELAY)
function broadcastToRoom(room, data, excludeWs = null) {
  if (!room) return;
  room.lastActivity = Date.now();
  const payload = JSON.stringify(data);

  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {}
    }
  }
}

// Persistência com debounce: o host manda estado a cada toque de pad, mas gravar no
// SQLite a cada toque bloquearia o event loop no meio da música.
const SAVE_DEBOUNCE_MS = 1500;
const pendingSaves = new Map(); // code -> timeout

function scheduleSave(room) {
  if (pendingSaves.has(room.code)) return;
  pendingSaves.set(room.code, setTimeout(() => {
    pendingSaves.delete(room.code);
    if (rooms.has(room.code)) saveRoomDb(room);
  }, SAVE_DEBOUNCE_MS));
}

function flushAllRooms() {
  for (const [code, timer] of pendingSaves) {
    clearTimeout(timer);
    const room = rooms.get(code);
    if (room) saveRoomDb(room);
  }
  pendingSaves.clear();
}

// Update Room State & Persist
function updateRoomState(room, partialState) {
  if (!room) return;
  room.state = { ...room.state, ...partialState };
  room.lastActivity = Date.now();
  scheduleSave(room);
}

// Notify room roster & latency
function notifyRoomMembers(code) {
  const room = getRoom(code);
  if (!room) return;

  const members = [];
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      members.push({
        id: client.clientId,
        name: client.clientName,
        role: client.role,
        latency: client.latency || 0
      });
    }
  }

  broadcastToRoom(room, {
    type: 'members_update',
    members
  });
}

/** Um controle remoto pode enviar este comando? (tabela em ./permissions.js) */
function isActionAllowed(role, msg, permissions) {
  if (msg.type === 'host_state_update' || msg.type === 'set_permissions') return role === 'host';
  if (msg.type === 'ping') return true;
  return isCommandAllowed(role, msg.type, permissions);
}

function formatRoleName(role) {
  switch (role) {
    case 'keyboardist': return 'Tecladista';
    case 'drummer': return 'Baterista';
    case 'leader': return 'Líder de Louvor';
    case 'host': return 'Saída de Áudio (Host)';
    default: return 'Controle Remoto';
  }
}

// Auto-cleanup stale rooms after 15 minutes of inactivity without clients
const ROOM_TTL_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const totalClients = room.clients ? room.clients.size : 0;
    if (totalClients === 0 && (now - room.lastActivity > ROOM_TTL_MS)) {
      deleteRoom(code);
      console.log(`[Auto-Cleanup] Sala expirada removida do cache e do SQLite: ${code}`);
    }
  }
}, 60000).unref();

/** Altera as permissões da sala (só o host chama). */
function setRoomPermissions(room, raw) {
  room.permissions = normalizePermissions(raw);
  room.lastActivity = Date.now();
  scheduleSave(room);
  return room.permissions;
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  deleteRoom,
  updateRoomState,
  broadcastToRoom,
  notifyRoomMembers,
  isActionAllowed,
  setRoomPermissions,
  formatRoleName,
  flushAllRooms
};
