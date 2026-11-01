/**
 * Entrar com o Google: confere o "credential" (ID token) que o botão do Google entrega ao navegador.
 * A conferência é feita pelo próprio Google (tokeninfo), que valida assinatura e validade.
 * Só depende de GOOGLE_CLIENT_ID; sem ele, o botão nem aparece.
 */

const TOKENINFO_URL = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

function clientId() {
  return (process.env.GOOGLE_CLIENT_ID || '').trim() || null;
}

/** Devolve { email, name, picture } se o token é do nosso app e o e-mail está verificado; senão lança erro com `status`. */
async function verifyGoogleCredential(credential, expectedClientId = clientId(), fetchImpl = fetch) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!expectedClientId) throw fail(503, 'Entrar com o Google não está configurado neste servidor.');
  if (typeof credential !== 'string' || credential.length < 20 || credential.length > 4096) throw fail(400, 'Credencial do Google inválida.');

  let info;
  try {
    const resp = await fetchImpl(`${TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw fail(401, 'O Google não confirmou este login.');
    info = await resp.json();
  } catch (err) {
    if (err.status) throw err;
    throw fail(502, 'Não foi possível falar com o Google agora.');
  }

  if (info.aud !== expectedClientId) throw fail(401, 'Este login não é para este app.');
  if (!ISSUERS.has(info.iss)) throw fail(401, 'Origem do login não reconhecida.');
  if (Number(info.exp) * 1000 < Date.now()) throw fail(401, 'Login do Google expirou. Tente de novo.');
  if (String(info.email_verified) !== 'true' || typeof info.email !== 'string') throw fail(401, 'O e-mail do Google não está verificado.');
  // A foto só vale se vier do domínio de imagens do Google (https)
  let picture = null;
  try {
    const url = new URL(String(info.picture || ''));
    if (url.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(url.hostname) && url.href.length < 500) picture = url.href;
  } catch (e) { /* sem foto */ }
  return { email: info.email.toLowerCase(), name: typeof info.name === 'string' ? info.name.slice(0, 60) : '', picture };
}

module.exports = { verifyGoogleCredential, googleClientId: clientId };
