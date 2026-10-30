/**
 * PadStudio Live - Room Manager Module
 * Manages rooms, role permissions, PIN security, state synchronization,
 * and SQLite persistence across server reboots.
 */

const { WebSocket } = require('ws');
const { saveRoomDb, loadActiveRoomsDb, deleteRoomDb } = require('./db');

// Room Characters (ambiguity-free alphanumeric)
const ROOM_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
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
        permissions: r.permissions || { keyboardist: true, drummer: true, leader: true },
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

  const hostToken = Math.random().toString(36).substring(2) + Date.now().toString(36);

  const room = {
    code,
    hostToken,
    hostWs,
    ownerId,
    roomPin: roomPin ? String(roomPin).trim() : null,
    leaderPin: leaderPin ? String(leaderPin).trim() : null,
    clients: new Set(),
    permissions: {
      keyboardist: true,
      drummer: true,
      leader: true
    },
    state: {
      activeToneIndex: null,
      padPreset: 'shimmer_2',
      padVolume: 90,
      bpm: 120,
      timeSig: '4/4',
      metroPlaying: false,
      metroVolume: 80,
      metroPan: 0,
      drumVolume: 85,
      drumKit: 'kit_3',
      masterVolume: 90,
      activeSongId: null,
      setlist: [
        { id: '1', title: '01. A Casa é Sua', keyIndex: 7, bpm: 130, timeSig: '4/4', preset: 'warm_pad' },
        { id: '2', title: '02. Ousado Amor', keyIndex: 8, bpm: 68, timeSig: '6/8', preset: 'pad_shimmer' },
        { id: '3', title: '03. Lindo És', keyIndex: 0, bpm: 72, timeSig: '4/4', preset: 'worship' },
        { id: '4', title: '04. Ruja o Leão', keyIndex: 2, bpm: 140, timeSig: '4/4', preset: 'abba_pad' }
      ]
    },
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
  if (!code) return null;
  return rooms.get(code.toUpperCase().trim()) || null;
}

function deleteRoom(code) {
  if (!code) return false;
  const upper = code.toUpperCase().trim();
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

// Update Room State & Persist
function updateRoomState(room, partialState) {
  if (!room) return;
  room.state = { ...room.state, ...partialState };
  room.lastActivity = Date.now();
  saveRoomDb(room);
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

// Role Permissions Validation
function isActionAllowed(role, msg, permissions) {
  const actionType = msg.type;

  // Only host socket can ever broadcast host_state_update
  if (actionType === 'host_state_update') {
    return role === 'host';
  }

  if (role === 'host') return true;

  if (role === 'keyboardist') {
    if (!permissions.keyboardist) return false;
    if (actionType === 'volume' && msg.target && msg.target !== 'pad') return false;
    return ['pad_on', 'pad_off', 'pad_preset', 'volume', 'ping'].includes(actionType);
  }

  if (role === 'drummer') {
    if (!permissions.drummer) return false;
    if (actionType === 'volume' && msg.target && msg.target !== 'drums') return false;
    return ['drum', 'drum_hit', 'drum_kit', 'volume', 'ping'].includes(actionType);
  }

  if (role === 'leader') {
    if (!permissions.leader) return false;
    const allowed = [
      'pad_on', 'pad_off', 'pad_preset',
      'drum', 'drum_hit', 'drum_kit',
      'metro', 'bpm', 'timesig', 'metro_pan',
      'volume', 'panic',
      'song_activate', 'setlist_update', 'setlist_add', 'setlist_edit', 'setlist_delete',
      'permission_toggle', 'ping'
    ];
    return allowed.includes(actionType);
  }

  return false;
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
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const totalClients = room.clients ? room.clients.size : 0;
    if (totalClients === 0 && (now - room.lastActivity > 15 * 60 * 1000)) {
      rooms.delete(code);
      deleteRoomDb(code);
      console.log(`[Auto-Cleanup] Sala expirada removida do cache e do SQLite: ${code}`);
    }
  }
}, 60000);

module.exports = {
  rooms,
  createRoom,
  getRoom,
  deleteRoom,
  updateRoomState,
  broadcastToRoom,
  notifyRoomMembers,
  isActionAllowed,
  formatRoleName
};
