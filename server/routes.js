/**
 * PadStudio Live - API Routes
 * Auth endpoints, Room management, PIN validation, SSE Stream & Action Dispatch
 */

const express = require('express');
const QRCode = require('qrcode');
const {
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
  optionalAuthMiddleware,
  validateRolePin
} = require('./auth');
const db = require('./db');
const { getClientIp, pinLimiter, authLimiter } = require('./rate-limit');
const {
  createRoom,
  getRoom,
  broadcastToRoom,
  notifyRoomMembers,
  isActionAllowed,
  formatRoleName
} = require('./rooms');

const router = express.Router();

// ==========================================
// 1. AUTHENTICATION & USER ENDPOINTS
// ==========================================

// Register User / Band
router.post('/auth/register', authLimiter.middleware, async (req, res) => {
  try {
    const { email, password, name, bandName } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    if (password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }

    const passwordHash = await hashPassword(password);
    const user = db.createUser({ email, passwordHash, name, bandName });
    const token = generateToken(user);

    res.status(201).json({
      message: 'Conta criada com sucesso!',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        bandName: user.bandName
      }
    });
  } catch (err) {
    console.error('[Auth Register Error]:', err);
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

// Login User / Band
router.post('/auth/login', authLimiter.middleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const token = generateToken(user);
    res.json({
      message: 'Login realizado com sucesso!',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        bandName: user.bandName
      }
    });
  } catch (err) {
    console.error('[Auth Login Error]:', err);
    res.status(500).json({ error: 'Erro ao autenticar.' });
  }
});

// Get Current User Profile (JWT Protected)
router.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id) || {
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    bandName: req.user.bandName
  };

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      bandName: user.bandName
    },
    savedSetlist: db.getUserSetlist(user.id)
  });
});

// Save User Setlist to Cloud Profile
router.post('/auth/setlist', authMiddleware, (req, res) => {
  const { songs } = req.body;
  if (!Array.isArray(songs) || songs.length > 500) {
    return res.status(400).json({ error: 'Formato de repertório inválido.' });
  }

  db.saveUserSetlist(req.user.id, songs);
  res.json({ message: 'Repertório salvo na nuvem com sucesso!' });
});

// ==========================================
// 2. ROOM & PIN VALIDATION ENDPOINTS
// ==========================================

// Create Room via HTTP REST (with optional PINs and Auth)
router.post('/rooms/create', optionalAuthMiddleware, (req, res) => {
  const { roomPin, leaderPin } = req.body;
  const ownerId = req.user ? req.user.id : null;

  const room = createRoom({
    roomPin: roomPin || null,
    leaderPin: leaderPin || null,
    ownerId
  });

  res.json({
    roomCode: room.code,
    hostToken: room.hostToken,
    hasRoomPin: !!room.roomPin,
    hasLeaderPin: !!room.leaderPin,
    state: room.state
  });
});

// Validate PIN before joining
router.post('/rooms/validate-pin', (req, res) => {
  // Mesmo limitador do WebSocket: sem ele, o PIN de 4–6 dígitos cairia por força bruta
  const ip = getClientIp(req);
  const rate = pinLimiter.check(ip);
  if (!rate.allowed) return res.status(429).json({ error: rate.message });

  const { roomCode, role, pin } = req.body;
  const room = getRoom(typeof roomCode === 'string' ? roomCode : '');
  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  const check = validateRolePin(room, role, typeof pin === 'string' || typeof pin === 'number' ? String(pin) : '');
  if (!check.valid) {
    pinLimiter.fail(ip);
    return res.status(403).json({ error: check.message });
  }

  pinLimiter.reset(ip);
  res.json({ valid: true });
});

// Get Room State
router.get('/rooms/:code/state', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  res.json({
    code: room.code,
    state: room.state,
    permissions: room.permissions,
    hasRoomPin: !!room.roomPin,
    hasLeaderPin: !!room.leaderPin
  });
});

// ==========================================
// 3. UTILITY ENDPOINTS
// ==========================================

// QR Code Generator
router.get('/qr', async (req, res) => {
  const text = req.query.text;
  if (typeof text !== 'string' || !text || text.length > 512) {
    return res.status(400).json({ error: 'Texto inválido para QR Code.' });
  }
  try {
    // Preto no branco: é o que todo leitor de QR reconhece
    const dataUrl = await QRCode.toDataURL(text, {
      margin: 0,
      width: 360,
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.json({ qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao gerar QR Code.' });
  }
});

module.exports = router;

