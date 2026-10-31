import { store, emit, on, isLocal, isRemote, allowed } from '../store.js';
import { connect, disconnect, send, onMessage, setRejoin } from '../net.js';
import { commit, dispatch, runCommand, applyRemoteState, broadcastNow, COMMANDS } from '../actions.js';
import { $, el, toast, showBanner, hideBanner, openModal, closeModal } from '../ui.js';
import { ROLES, CAPABILITIES, normalizePermissions, defaultPermissions } from '../permissions.js';
import { PadStudioAudioEngine } from '../audio-engine.js';
import { startKeepAwake, stopKeepAwake } from '../wake.js';

const HOST_SESSION_KEY = 'padstudio_host_session';
const HOST_SESSION_MAX_AGE = 12 * 60 * 60 * 1000;
const ROLE_NAMES = { host: 'Host', keyboardist: 'Tecladista', drummer: 'Baterista', leader: 'Líder' };

let joinPin = null;        // fica só na memória, para reconectar a uma sala com PIN
let restoreState = null;   // estado salvo na sala, aplicado quando o host volta depois de fechar a aba

// ---------------------------------------------------------------------------
// Motor de áudio (um só por página: navegadores limitam quantos AudioContext existem)
// ---------------------------------------------------------------------------

async function getEngine() {
  if (!store.engine) {
    const engine = new PadStudioAudioEngine();
    engine.onChange = () => commit();
    engine.onError = (message) => toast(message, 'error');
    engine.onBeat = (beat, accent) => emit('beat', { beat, accent });
    store.engine = engine;
  }
  await store.engine.unlock();
  return store.engine;
}

// ---------------------------------------------------------------------------
// Sessão do host salva no aparelho (sobrevive a fechar a aba)
// ---------------------------------------------------------------------------

function saveHostSession(roomCode, hostToken) {
  try { localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ roomCode, hostToken, savedAt: Date.now() })); } catch (e) { /* ignore */ }
}

function loadHostSession() {
  try {
    const s = JSON.parse(localStorage.getItem(HOST_SESSION_KEY) || 'null');
    if (s && s.roomCode && s.hostToken && Date.now() - s.savedAt < HOST_SESSION_MAX_AGE) return s;
  } catch (e) { /* ignore */ }
  clearHostSession();
  return null;
}

function clearHostSession() {
  try { localStorage.removeItem(HOST_SESSION_KEY); } catch (e) { /* ignore */ }
}

function renderHostResume() {
  const session = loadHostSession();
  $('group-host-resume').classList.toggle('hidden', !session);
  if (session) $('btn-host-resume').textContent = `Voltar para a sala ${session.roomCode}`;
}

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

export function switchTab(tabId) {
  document.querySelectorAll('.nav-segment').forEach(s => s.classList.toggle('active', s.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
}

const TAB_CAPABILITY = { 'tab-pads': 'pads', 'tab-drums': 'drums', 'tab-metro': 'metro', 'tab-setlist': 'setlist', 'tab-mixer': 'mixer' };

function applyRoleUI() {
  const body = document.body;
  for (const cap of CAPABILITIES) body.classList.toggle(`no-${cap.id}`, !allowed(cap.id));
  body.dataset.role = store.role;

  $('header-room-display').textContent = store.role === 'solo' ? 'Solo' : (store.roomCode || '');
  $('latency-indicator').classList.toggle('hidden', store.role === 'solo');
  $('host-foreground-banner').classList.toggle('hidden', store.role !== 'host');
  $('btn-panic').classList.toggle('hidden', !allowed('panic'));

  const current = document.querySelector('.tab-pane.active')?.id;
  if (!current || !allowed(TAB_CAPABILITY[current])) {
    const first = Object.keys(TAB_CAPABILITY).find(tab => allowed(TAB_CAPABILITY[tab]));
    if (first) switchTab(first);
  }
  emit('permissions');
}

function goToStage() {
  $('screen-room-gateway').classList.remove('active');
  $('screen-main-stage').classList.add('active');
  switchTab(store.role === 'drummer' ? 'tab-drums' : 'tab-pads');
  applyRoleUI();
  startKeepAwake();
  if (isLocal()) commit();
}

function goToGateway() {
  $('screen-main-stage').classList.remove('active');
  $('screen-room-gateway').classList.add('active');
  stopKeepAwake();
  renderHostResume();
}

function leaveRoom() {
  if (store.role === 'host') clearHostSession();
  store.engine?.panicStop();
  disconnect();
  store.role = 'solo';
  store.roomCode = null;
  store.permissions = defaultPermissions();
  joinPin = null;
  hideBanner();
  closeModal($('modal-room-info'));
  goToGateway();
}

// ---------------------------------------------------------------------------
// Entrada: criar, entrar, solo, voltar como host
// ---------------------------------------------------------------------------

function showGatewayError(message) {
  $('gateway-error').textContent = message;
  $('gateway-error').classList.remove('hidden');
}

function revealJoinPin() {
  const input = $('input-join-pin');
  input.classList.remove('hidden');
  input.value = '';
  input.focus();
}

async function createRoom() {
  await getEngine();
  store.role = 'host';
  const roomPin = $('input-host-room-pin').value.trim() || undefined;
  const leaderPin = $('input-host-leader-pin').value.trim() || undefined;
  connect(() => send({ type: 'create_room', roomPin, leaderPin }));
}

async function resumeHost() {
  const session = loadHostSession();
  if (!session) { renderHostResume(); return; }
  await getEngine();
  store.role = 'host';
  store.roomCode = session.roomCode;
  restoreState = 'pending';
  connect(() => send({ type: 'reconnect_host', roomCode: session.roomCode, hostToken: session.hostToken }));
}

function joinRoom() {
  const code = $('input-gateway-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    showGatewayError('Digite o código de 4 caracteres mostrado no host.');
    return;
  }
  $('gateway-error').classList.add('hidden');
  store.role = $('select-gateway-role').value;
  joinPin = $('input-join-pin').value.trim() || null;
  connect(() => send({ type: 'join_room', roomCode: code, role: store.role, pin: joinPin || undefined }));
}

async function playSolo() {
  await getEngine();
  disconnect();
  store.role = 'solo';
  store.roomCode = null;
  store.permissions = defaultPermissions();
  goToStage();
}

// Reautenticação automática depois de uma queda de conexão
setRejoin(() => {
  if (store.role === 'host') {
    const session = loadHostSession();
    if (session) send({ type: 'reconnect_host', roomCode: session.roomCode, hostToken: session.hostToken });
  } else if (isRemote()) {
    send({ type: 'join_room', roomCode: store.roomCode, role: store.role, pin: joinPin || undefined });
  }
});

// ---------------------------------------------------------------------------
// Sheet da sala: QR, membros e permissões
// ---------------------------------------------------------------------------

async function loadQrCode(code) {
  let base = location.origin;
  try {
    const info = await (await fetch('/api/server-info')).json();
    const lan = info.ips?.[0]?.address;
    const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (lan && isLocalhost) {
      const port = [80, 443].includes(Number(info.port)) ? '' : `:${info.port}`;
      base = `${info.protocol || 'http'}://${lan}${port}`;
    }
  } catch (e) { /* usa a origem atual */ }

  const url = `${base}/?room=${code}`;
  $('modal-lbl-url').textContent = url;
  $('modal-lbl-url').href = url;
  try {
    const data = await (await fetch(`/api/qr?text=${encodeURIComponent(url)}`)).json();
    if (data.qr) $('room-qr-img').src = data.qr;
  } catch (e) { /* sem QR: o link e o código continuam visíveis */ }
}

function renderMembers(members) {
  $('room-members-status').textContent = members.length === 1 ? '1 aparelho na sala' : `${members.length} aparelhos na sala`;
  $('room-members-list').replaceChildren(...members.map(m => {
    const lat = m.latency || 0;
    return el('div', { class: 'member-item' }, [
      el('span', { class: 'member-name-text', text: m.name || m.id }),
      el('span', { class: 'member-role-badge', text: ROLE_NAMES[m.role] || 'Membro' }),
      el('span', {
        class: `member-latency-tag ${lat < 30 ? 'lat-green' : lat < 80 ? 'lat-yellow' : 'lat-red'}`,
        text: lat ? `${lat} ms` : ''
      })
    ]);
  }));
}

function renderPermissions() {
  const isHost = store.role === 'host';
  $('group-permissions').classList.toggle('hidden', !isHost);
  if (!isHost) return;
  const header = el('div', { class: 'perm-row perm-head' }, [
    el('span'), ...ROLES.map(r => el('span', { class: 'perm-role', text: r.name }))
  ]);
  const rows = CAPABILITIES.map(cap => el('div', { class: 'perm-row' }, [
    el('span', { class: 'perm-cap', text: cap.name }),
    ...ROLES.map(role => {
      const input = el('input', {
        type: 'checkbox', class: 'switch switch--sm',
        'aria-label': `${cap.name} para ${role.name}`,
        checked: store.permissions[role.id][cap.id]
      });
      input.addEventListener('change', () => {
        store.permissions[role.id][cap.id] = input.checked;
        send({ type: 'set_permissions', permissions: store.permissions });
      });
      return el('span', { class: 'perm-cell' }, [input]);
    })
  ]));
  $('permissions-grid').replaceChildren(header, ...rows);
}

function openRoomSheet() {
  const solo = store.role === 'solo';
  $('room-online').classList.toggle('hidden', solo);
  $('room-solo').classList.toggle('hidden', !solo);
  $('room-info-title').textContent = solo ? 'Modo solo' : 'Sala';
  $('btn-leave-room').textContent = solo ? 'Voltar ao início' : 'Sair da sala';
  renderPermissions();
  openModal($('modal-room-info'));
}

// ---------------------------------------------------------------------------
// Mensagens do servidor
// ---------------------------------------------------------------------------

function enterRoom(msg) {
  store.roomCode = msg.roomCode;
  store.permissions = normalizePermissions(msg.permissions);
  $('modal-lbl-code').textContent = msg.roomCode;
  try {
    sessionStorage.setItem('padstudio_room_code', msg.roomCode);
    sessionStorage.setItem('padstudio_role', store.role);
  } catch (e) { /* ignore */ }
  hideBanner();
  loadQrCode(msg.roomCode);
}

/** Host que voltou depois de fechar a aba: recupera timbre, kit, BPM, volumes e repertório (sem tocar nada). */
function restoreHostState(state) {
  const e = store.engine;
  if (!state || !e) return;
  if (state.padPreset) e.setPadPreset(state.padPreset);
  if (state.drumKit) e.setDrumKit(state.drumKit);
  if (state.bpm) e.setMetronomeBpm(state.bpm);
  if (state.timeSig) e.setMetronomeTimeSig(state.timeSig);
  if (typeof state.metroPan === 'number') e.setMetronomePan(state.metroPan);
  e.setMetronomeOptions({ countIn: state.countIn, subdivide: state.subdivide, clickSound: state.clickSound });
  for (const [k, v] of Object.entries(state.volumes || {})) e.setVolume(k, v);
  if (state.activeListId) store.library.selectList(state.activeListId);
  if (state.activeSongId && store.library.getSong(state.activeSongId)) store.library.activeSongId = state.activeSongId;
}

function registerMessages() {
  onMessage('room_created', (msg) => {
    saveHostSession(msg.roomCode, msg.hostToken);
    enterRoom(msg);
    goToStage();
  });

  onMessage('room_reconnected', (msg) => {
    saveHostSession(msg.roomCode, msg.hostToken);
    enterRoom(msg);
    if (restoreState === 'pending') {
      restoreHostState(msg.state);
      toast(`Sala ${msg.roomCode} recuperada`, 'success');
    }
    restoreState = null;
    if (!$('screen-main-stage').classList.contains('active')) goToStage();
    else { applyRoleUI(); broadcastNow(); }
    commit();
  });

  onMessage('room_joined', (msg) => {
    enterRoom(msg);
    goToStage();
    applyRemoteState(msg.state);
  });

  onMessage('state', (msg) => { if (isRemote()) applyRemoteState(msg.state); });

  onMessage('permissions', (msg) => {
    store.permissions = normalizePermissions(msg.permissions);
    applyRoleUI();
    if ($('group-permissions') && !$('modal-room-info').classList.contains('hidden')) renderPermissions();
  });

  onMessage('members_update', (msg) => renderMembers(msg.members || []));
  onMessage('permission_denied', (msg) => toast(msg.message || 'Sem permissão para isso.', 'error'));
  onMessage('host_offline', (msg) => showBanner(msg.message || 'O host está desconectado.', 'error'));
  onMessage('host_disconnected', (msg) => showBanner(msg.message || 'Host desconectado. Aguardando…', 'warning'));
  onMessage('host_reconnected', () => { hideBanner(); toast('Host reconectado', 'success'); });
  onMessage('server_restarting', (msg) => showBanner(msg.message || 'Servidor reiniciando…', 'warning'));

  onMessage('error', (msg) => {
    const message = msg.message || 'Não foi possível concluir.';
    if ($('screen-room-gateway').classList.contains('active')) {
      showGatewayError(message);
      if (/PIN/i.test(message)) revealJoinPin();
      if (restoreState === 'pending') { clearHostSession(); restoreState = null; renderHostResume(); }
      disconnect();
    } else {
      toast(message, 'error');
    }
  });

  // Comandos dos controles remotos, executados no host
  for (const type of COMMANDS) {
    onMessage(type, (msg) => { if (store.role === 'host') runCommand(type, msg); });
  }
}

export function initRoom() {
  registerMessages();
  $('btn-gateway-create').addEventListener('click', createRoom);
  $('btn-gateway-join').addEventListener('click', joinRoom);
  $('btn-gateway-solo').addEventListener('click', playSolo);
  $('btn-host-resume').addEventListener('click', resumeHost);
  $('input-gateway-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('input-join-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('select-gateway-role').addEventListener('change', (e) => {
    $('input-join-pin').placeholder = e.target.value === 'leader' ? 'PIN do líder' : 'PIN da sala';
  });

  $('btn-room-info').addEventListener('click', openRoomSheet);
  $('btn-close-room-info').addEventListener('click', () => closeModal($('modal-room-info')));
  $('btn-leave-room').addEventListener('click', leaveRoom);

  document.querySelectorAll('.nav-segment').forEach(seg => seg.addEventListener('click', () => switchTab(seg.dataset.tab)));
  $('btn-panic').addEventListener('click', () => dispatch('panic'));

  on('latency', (lat) => {
    const ind = $('latency-indicator');
    ind.classList.remove('lat-green', 'lat-yellow', 'lat-red');
    ind.classList.add(lat < 30 ? 'lat-green' : lat < 80 ? 'lat-yellow' : 'lat-red');
    $('latency-val').textContent = `${lat} ms`;
  });

  // ?room=K7QF (QR Code) ou a última sala desta aba
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('room');
  const saved = (() => { try { return sessionStorage.getItem('padstudio_room_code'); } catch (e) { return null; } })();
  const savedRole = (() => { try { return sessionStorage.getItem('padstudio_role'); } catch (e) { return null; } })();
  if (fromUrl) $('input-gateway-code').value = fromUrl.toUpperCase().slice(0, 4);
  else if (saved && savedRole !== 'host') $('input-gateway-code').value = saved;
  if (savedRole && ['keyboardist', 'drummer', 'leader'].includes(savedRole)) $('select-gateway-role').value = savedRole;

  renderHostResume();
}
