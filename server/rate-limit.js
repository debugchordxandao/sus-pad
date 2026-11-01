/**
 * Sus Pad - Rate limiting compartilhado (WebSocket + HTTP)
 * Tudo em memória, com limpeza periódica para não crescer indefinidamente.
 */

const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production';

/** IP real do cliente. Só confia em X-Forwarded-For atrás de proxy (Railway/Render). */
function getClientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Bloqueio por falhas: após `maxFailures` erros, bloqueia o IP por `lockMs`.
 */
function createFailureLimiter({ maxFailures = 5, lockMs = 10 * 60 * 1000, label = 'limite' } = {}) {
  const records = new Map(); // ip -> { count, lockedUntil, touched }

  function check(ip) {
    const rec = records.get(ip);
    if (rec && rec.lockedUntil > Date.now()) {
      const min = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
      return { allowed: false, message: `Muitas tentativas incorretas. Tente novamente em ${min} minuto(s).` };
    }
    return { allowed: true };
  }

  function fail(ip) {
    const rec = records.get(ip) || { count: 0, lockedUntil: 0 };
    rec.count += 1;
    rec.touched = Date.now();
    if (rec.count >= maxFailures) {
      rec.lockedUntil = Date.now() + lockMs;
      rec.count = 0;
      console.warn(`[SEGURANÇA] ${label}: IP ${ip} bloqueado por ${Math.round(lockMs / 60000)} min.`);
    }
    records.set(ip, rec);
  }

  function reset(ip) {
    records.delete(ip);
  }

  function prune() {
    const now = Date.now();
    for (const [ip, rec] of records) {
      if (rec.lockedUntil < now && now - (rec.touched || 0) > lockMs) records.delete(ip);
    }
  }

  return { check, fail, reset, prune };
}

/** Janela fixa simples para rotas HTTP (ex.: login). */
function createWindowLimiter({ max = 20, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map(); // ip -> { count, start }

  function middleware(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now - rec.start > windowMs) {
      rec = { count: 0, start: now };
      hits.set(ip, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'Muitas requisições. Aguarde alguns minutos.' });
    }
    next();
  }

  function prune() {
    const now = Date.now();
    for (const [ip, rec] of hits) if (now - rec.start > windowMs) hits.delete(ip);
  }

  return { middleware, prune };
}

// Instâncias compartilhadas
const pinLimiter = createFailureLimiter({ maxFailures: 5, lockMs: 10 * 60 * 1000, label: 'PIN de sala' });
// Códigos de sala inexistentes: impede descobrir salas sem PIN testando códigos
const roomLookupLimiter = createFailureLimiter({ maxFailures: 10, lockMs: 10 * 60 * 1000, label: 'Código de sala' });
const authLimiter = createWindowLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

setInterval(() => {
  pinLimiter.prune();
  roomLookupLimiter.prune();
  authLimiter.prune();
}, 5 * 60 * 1000).unref();

module.exports = { getClientIp, pinLimiter, roomLookupLimiter, authLimiter, createFailureLimiter };
