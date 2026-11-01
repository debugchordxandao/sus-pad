/**
 * Sus Pad - Auth Module
 * JWT Authentication, Bcrypt Password Hashing, Role & Room PIN Validation
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[FATAL] A variável de ambiente JWT_SECRET é obrigatória em produção.');
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[AUTH] Aviso: JWT_SECRET não foi fornecido via variável de ambiente. Uma chave aleatória temporária foi gerada para esta sessão.');
}

const JWT_EXPIRES_IN = '7d';

// Hash password with bcrypt
async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}

// Compare password
async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

// Generate JWT for user
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      bandName: user.bandName || user.name
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Verify JWT
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Express Auth Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  req.user = decoded;
  next();
}

// Optional Auth Middleware (attaches req.user if token present)
function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    req.user = verifyToken(token);
  }
  next();
}

// Validate Room PIN and Leader PIN
function validateRolePin(room, role, pin) {
  if (!room) return { valid: false, message: 'Sala não encontrada.' };

  const pinStr = (typeof pin === 'string' || typeof pin === 'number') ? String(pin).trim() : '';

  // 1. Leader Role Verification
  if (role === 'leader' && room.leaderPin && room.leaderPin.trim() !== '') {
    if (!pinStr) return { valid: false, message: 'Digite o PIN do host.' };
    if (pinStr !== room.leaderPin.trim()) {
      return { valid: false, message: 'PIN do host incorreto.' };
    }
    return { valid: true };
  }

  // 2. Room Access PIN Verification
  if (room.roomPin && room.roomPin.trim() !== '') {
    if (!pinStr) return { valid: false, message: 'Esta sala pede um PIN.' };
    if (pinStr !== room.roomPin.trim()) {
      return { valid: false, message: 'PIN de acesso da sala incorreto.' };
    }
  }

  return { valid: true };
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  authMiddleware,
  optionalAuthMiddleware,
  validateRolePin
};
