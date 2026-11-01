import { store, emit } from '../store.js';
import { commit } from '../actions.js';
import { $, openModal, closeModal, toast } from '../ui.js';

const TOKEN_KEY = 'padstudio_auth_token';
const SYNC_DELAY_MS = 1500;

let token = null;
let mode = 'login';
let syncTimer = null;
let applyingRemote = false;
let googleReady = false;

try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }

async function api(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(data.error || 'Erro no servidor.'), { status: resp.status });
  return data;
}

function render() {
  const user = store.user;
  $('btn-auth-open').classList.toggle('logged', !!user);
  $('auth-pill-text').textContent = user ? (user.bandName || user.name) : 'Entrar';
  $('form-auth').classList.toggle('hidden', !!user);
  $('google-signin').classList.toggle('hidden', !googleReady || !!user);
  $('auth-user-logged').classList.toggle('hidden', !user);
  if (user) {
    $('logged-user-name').textContent = user.bandName || user.name;
    $('logged-band-name').textContent = user.email || '';
  }
}

function setMode(next) {
  mode = next;
  $('tab-auth-login').classList.toggle('active', mode === 'login');
  $('tab-auth-register').classList.toggle('active', mode === 'register');
  $('field-band-name').classList.toggle('hidden', mode === 'login');
  $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('btn-auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
  $('auth-error').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Repertórios na conta: o mais recente vence; depois, cada alteração sobe sozinha
// ---------------------------------------------------------------------------

async function pullLibrary() {
  try {
    const { library } = await api('/api/auth/library');
    const local = store.library.toJSON();
    if (library && (Number(library.updatedAt) || 0) > (local.updatedAt || 0)) {
      applyingRemote = true;
      store.library.replace(library);
      applyingRemote = false;
      commit();
      $('sync-status').textContent = 'Repertórios sincronizados';
    } else {
      await pushLibrary();
    }
  } catch (e) {
    $('sync-status').textContent = 'Não foi possível sincronizar agora';
  }
}

async function pushLibrary() {
  if (!token) return;
  try {
    await api('/api/auth/library', { method: 'PUT', body: JSON.stringify({ library: store.library.toJSON() }) });
    $('sync-status').textContent = 'Repertórios sincronizados';
  } catch (e) {
    $('sync-status').textContent = 'Alterações ainda não enviadas';
  }
}

function scheduleSync() {
  if (!token || applyingRemote) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushLibrary, SYNC_DELAY_MS);
}

function signedIn(data) {
  token = data.token || token;
  store.user = data.user;
  try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
  render();
  emit('auth', store.user);
  pullLibrary();
}

function signOut() {
  token = null;
  store.user = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  render();
  emit('auth', null);
}

async function submit(e) {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const bandName = $('auth-band-name').value.trim();
  const body = mode === 'register'
    ? { email, password, name: bandName || email.split('@')[0], bandName }
    : { email, password };
  $('btn-auth-submit').disabled = true;
  try {
    const data = await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
    signedIn(data);
    $('auth-password').value = '';
    toast(`Bem-vindo, ${data.user.bandName || data.user.name}`, 'success');
    closeModal($('modal-auth'));
  } catch (err) {
    $('auth-error').textContent = err.status ? err.message : 'Sem conexão com o servidor.';
    $('auth-error').classList.remove('hidden');
  } finally {
    $('btn-auth-submit').disabled = false;
  }
}

/** "Entrar com o Google": só aparece se o servidor tem GOOGLE_CLIENT_ID. */
async function initGoogle() {
  let clientId;
  try { clientId = (await api('/api/auth/config')).googleClientId; } catch (e) { return; }
  if (!clientId) return;
  await new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = resolve; // sem internet: o login por e-mail continua valendo
    document.head.appendChild(script);
  });
  const gsi = window.google?.accounts?.id;
  if (!gsi) return;
  gsi.initialize({
    client_id: clientId,
    callback: async ({ credential }) => {
      try {
        const data = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
        signedIn(data);
        toast(`Bem-vindo, ${data.user.bandName || data.user.name}`, 'success');
        closeModal($('modal-auth'));
      } catch (err) {
        $('auth-error').textContent = err.status ? err.message : 'Sem conexão com o servidor.';
        $('auth-error').classList.remove('hidden');
      }
    }
  });
  const box = $('google-signin');
  gsi.renderButton(box, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', locale: 'pt-BR', width: 320 });
  googleReady = true;
  render();
}

export function initAuth() {
  $('btn-auth-open').addEventListener('click', () => openModal($('modal-auth')));
  $('btn-close-auth').addEventListener('click', () => closeModal($('modal-auth')));
  $('tab-auth-login').addEventListener('click', () => setMode('login'));
  $('tab-auth-register').addEventListener('click', () => setMode('register'));
  $('form-auth').addEventListener('submit', submit);
  $('btn-auth-logout').addEventListener('click', () => {
    signOut();
    toast('Você saiu da conta.');
    closeModal($('modal-auth'));
  });

  store.library.onChange(scheduleSync);
  initGoogle();
  setMode('login');
  render();

  if (token) {
    api('/api/auth/me')
      .then(data => signedIn({ user: data.user }))
      .catch(err => { if (err.status === 401) signOut(); });
  }
}
