/**
 * PadStudio Live - Database Module
 * Robust SQLite (better-sqlite3) persistence with WAL mode and atomic transactions
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'padstudio.db');
const db = new Database(DB_FILE);

// Enable WAL mode for high concurrency & reliability
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    band_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS setlists (
    user_id TEXT PRIMARY KEY,
    songs_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    host_token TEXT NOT NULL,
    owner_id TEXT,
    room_pin TEXT,
    leader_pin TEXT,
    state_json TEXT NOT NULL,
    permissions_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL
  );
`);

// Migrate legacy db.json if present
(function migrateLegacyJson() {
  const legacyPath = path.join(DATA_DIR, 'db.json');
  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.users) && data.users.length > 0) {
        const insertUser = db.prepare(`
          INSERT OR IGNORE INTO users (id, email, password_hash, name, band_name, created_at)
          VALUES (@id, @email, @password_hash, @name, @band_name, @created_at)
        `);
        const insertMany = db.transaction((users) => {
          for (const u of users) {
            insertUser.run({
              id: u.id,
              email: u.email.toLowerCase().trim(),
              password_hash: u.passwordHash,
              name: u.name,
              band_name: u.bandName,
              created_at: u.createdAt || new Date().toISOString()
            });
          }
        });
        insertMany(data.users);
      }
      if (data.setlists && typeof data.setlists === 'object') {
        const insertSetlist = db.prepare(`
          INSERT OR REPLACE INTO setlists (user_id, songs_json, updated_at)
          VALUES (@user_id, @songs_json, @updated_at)
        `);
        for (const [userId, item] of Object.entries(data.setlists)) {
          insertSetlist.run({
            user_id: userId,
            songs_json: JSON.stringify(item.songs || []),
            updated_at: item.updatedAt || new Date().toISOString()
          });
        }
      }
      // Rename legacy file to indicate completed migration
      fs.renameSync(legacyPath, `${legacyPath}.migrated`);
      console.log('[DB] Migração legada de db.json para SQLite concluída com sucesso!');
    } catch (e) {
      console.warn('[DB] Aviso na migração de db.json:', e.message);
    }
  }
})();

// ==========================================
// USER OPERATIONS
// ==========================================

const stmtGetUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
function getUserByEmail(email) {
  if (!email) return null;
  const row = stmtGetUserByEmail.get(email.toLowerCase().trim());
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    bandName: row.band_name,
    createdAt: row.created_at
  };
}

const stmtGetUserById = db.prepare('SELECT * FROM users WHERE id = ?');
function getUserById(id) {
  if (!id) return null;
  const row = stmtGetUserById.get(id);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    bandName: row.band_name,
    createdAt: row.created_at
  };
}

const stmtCreateUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, name, band_name, created_at)
  VALUES (@id, @email, @password_hash, @name, @band_name, @created_at)
`);

function createUser(userData) {
  const newUser = {
    id: 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
    email: userData.email.toLowerCase().trim(),
    password_hash: userData.passwordHash,
    name: userData.name || userData.email.split('@')[0],
    band_name: userData.bandName || 'Banda de Louvor',
    created_at: new Date().toISOString()
  };

  stmtCreateUser.run(newUser);

  return {
    id: newUser.id,
    email: newUser.email,
    passwordHash: newUser.password_hash,
    name: newUser.name,
    bandName: newUser.band_name,
    createdAt: newUser.created_at
  };
}

// ==========================================
// SETLIST OPERATIONS
// ==========================================

const stmtSaveSetlist = db.prepare(`
  INSERT OR REPLACE INTO setlists (user_id, songs_json, updated_at)
  VALUES (@user_id, @songs_json, @updated_at)
`);

function saveUserSetlist(userId, songs) {
  stmtSaveSetlist.run({
    user_id: userId,
    songs_json: JSON.stringify(songs || []),
    updated_at: new Date().toISOString()
  });
}

const stmtGetSetlist = db.prepare('SELECT songs_json FROM setlists WHERE user_id = ?');
function getUserSetlist(userId) {
  const row = stmtGetSetlist.get(userId);
  if (!row || !row.songs_json) return null;
  try {
    return JSON.parse(row.songs_json);
  } catch (e) {
    return null;
  }
}

// ==========================================
// ROOM PERSISTENCE (SERVER REBOOT RECOVERY)
// ==========================================

const stmtSaveRoom = db.prepare(`
  INSERT OR REPLACE INTO rooms (code, host_token, owner_id, room_pin, leader_pin, state_json, permissions_json, created_at, last_activity)
  VALUES (@code, @host_token, @owner_id, @room_pin, @leader_pin, @state_json, @permissions_json, @created_at, @last_activity)
`);

function saveRoomDb(room) {
  if (!room || !room.code) return;
  stmtSaveRoom.run({
    code: room.code,
    host_token: room.hostToken,
    owner_id: room.ownerId || null,
    room_pin: room.roomPin || null,
    leader_pin: room.leaderPin || null,
    state_json: JSON.stringify(room.state || {}),
    permissions_json: JSON.stringify(room.permissions || {}),
    created_at: room.createdAt || Date.now(),
    last_activity: room.lastActivity || Date.now()
  });
}

const stmtGetActiveRooms = db.prepare(`
  SELECT * FROM rooms WHERE last_activity > ?
`);

function loadActiveRoomsDb(maxAgeMs = 15 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const rows = stmtGetActiveRooms.all(cutoff);
  return rows.map(r => ({
    code: r.code,
    hostToken: r.host_token,
    ownerId: r.owner_id,
    roomPin: r.room_pin,
    leaderPin: r.leader_pin,
    state: JSON.parse(r.state_json),
    permissions: JSON.parse(r.permissions_json),
    createdAt: r.created_at,
    lastActivity: r.last_activity
  }));
}

const stmtDeleteRoom = db.prepare('DELETE FROM rooms WHERE code = ?');
function deleteRoomDb(code) {
  stmtDeleteRoom.run(code);
}

module.exports = {
  db,
  getUserByEmail,
  getUserById,
  createUser,
  saveUserSetlist,
  getUserSetlist,
  saveRoomDb,
  loadActiveRoomsDb,
  deleteRoomDb
};
