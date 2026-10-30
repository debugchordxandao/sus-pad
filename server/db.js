/**
 * PadStudio Live - Database Module
 * Persistent JSON database supporting local directories and persistent volume mounts (Railway/Render)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db.json');

// In-memory state cache
let db = {
  users: [],
  rooms: {},
  setlists: {}
};

// Load database from file
function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      db = JSON.parse(raw);
    } else {
      saveDb();
    }
  } catch (err) {
    console.warn('[DB] Erro ao ler banco de dados persistente:', err.message);
  }
}

// Atomic save database to file
function saveDb() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${DB_PATH}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    console.error('[DB] Falha ao persistir dados no disco:', err.message);
  }
}

// Initial load
loadDb();

// User Operations
function getUserByEmail(email) {
  loadDb();
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  return db.users.find(u => u.email.toLowerCase() === normalized) || null;
}

function getUserById(id) {
  loadDb();
  return db.users.find(u => u.id === id) || null;
}

function createUser(userData) {
  loadDb();
  const newUser = {
    id: 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
    email: userData.email.toLowerCase().trim(),
    passwordHash: userData.passwordHash,
    name: userData.name || userData.email.split('@')[0],
    bandName: userData.bandName || 'Banda de Louvor',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDb();
  return newUser;
}

// Setlist Operations
function saveUserSetlist(userId, songs) {
  loadDb();
  db.setlists[userId] = {
    songs,
    updatedAt: new Date().toISOString()
  };
  saveDb();
}

function getUserSetlist(userId) {
  loadDb();
  return db.setlists[userId]?.songs || null;
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  saveUserSetlist,
  getUserSetlist
};

