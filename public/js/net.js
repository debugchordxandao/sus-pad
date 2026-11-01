/**
 * Conexão WebSocket com a sala: envio, reconexão automática e medição de latência.
 */

import { store, emit } from './store.js';
import { showBanner, hideBanner, toast } from './ui.js';

let ws = null;
let reconnectTimer = null;
let attempts = 0;
let manualClose = true;
let rejoin = null;
const handlers = new Map();

export function onMessage(type, fn) {
  handlers.set(type, fn);
}

/** Função chamada a cada reconexão para se autenticar de novo na sala. */
export function setRejoin(fn) {
  rejoin = fn;
}

function wsUrl() {
  const custom = window.SUSPAD_WS_URL || window.PADSTUDIO_WS_URL;
  if (custom) return custom;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

export function connect(onOpen) {
  manualClose = false;
  if (ws && ws.readyState === WebSocket.OPEN) { onOpen?.(); return; }
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    ws.addEventListener('open', () => onOpen?.(), { once: true });
    return;
  }

  let socket;
  try {
    socket = new WebSocket(wsUrl());
  } catch (err) {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.addEventListener('open', () => {
    attempts = 0;
    onOpen?.();
  });
  socket.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    const handler = handlers.get(msg.type);
    if (handler) handler(msg);
    else emit(`msg:${msg.type}`, msg);
  });
  socket.addEventListener('close', () => {
    if (ws !== socket) return; // conexão antiga, já substituída
    ws = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (manualClose || !store.roomCode || reconnectTimer) return;
  attempts += 1;
  const delay = Math.min(1000 * 1.5 ** (attempts - 1), 10000);
  showBanner(`Conexão perdida. Reconectando em ${Math.ceil(delay / 1000)} s…`, 'warning');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(() => {
      hideBanner();
      toast('Reconectado', 'success');
      rejoin?.();
    });
  }, delay);
}

export function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

export function disconnect() {
  manualClose = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  attempts = 0;
  if (ws) {
    try { ws.close(); } catch (e) { /* já fechado */ }
    ws = null;
  }
}

// Latência de ida e volta, medida a cada 2 s. A última medida vai junto no ping
// seguinte para o servidor mostrar a latência de cada aparelho na tela da sala.
let lastLatency = null;
setInterval(() => {
  if (store.role === 'solo') return;
  send({ type: 'ping', clientTime: performance.now(), ...(lastLatency ? { measuredLatency: lastLatency } : {}) });
}, 2000);

// Diferença entre o relógio deste aparelho e o do servidor (mediana das últimas medidas).
// Serve para o click visual piscar ao mesmo tempo em todos os celulares.
const offsets = [];
onMessage('pong', (msg) => {
  if (typeof msg.clientTime !== 'number') return;
  const rtt = performance.now() - msg.clientTime;
  lastLatency = Math.max(1, Math.round(rtt));
  emit('latency', lastLatency);
  if (typeof msg.serverTime === 'number' && rtt < 300) {
    offsets.push(msg.serverTime + rtt / 2 - Date.now());
    if (offsets.length > 7) offsets.shift();
    const sorted = [...offsets].sort((a, b) => a - b);
    store.clockOffset = sorted[Math.floor(sorted.length / 2)];
  }
});
