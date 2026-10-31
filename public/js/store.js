/**
 * Estado compartilhado do app e um barramento de eventos simples.
 *
 * Fluxo de dados (sempre em uma direção):
 *   ação do usuário → dispatch() → host/solo executa no motor → store.view → evento 'view' → telas
 *   controle remoto: dispatch() → servidor → host executa → estado volta pela sala → store.view
 */

import { Library } from './library.js';
import { defaultPermissions, can } from './permissions.js';
import { DEFAULT_PRESET, DEFAULT_KIT, DEFAULT_CLICK } from './catalog.js';

const PREFS_KEY = 'padstudio_prefs';

function loadPrefs() {
  const defaults = { notation: 'cifra', accidental: 'sharp', midi: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch (e) {
    return defaults;
  }
}

export function defaultView() {
  return {
    activeToneIndex: null,
    padPreset: DEFAULT_PRESET,
    padLoading: false,
    drumKit: DEFAULT_KIT,
    bpm: 120,
    timeSig: '4/4',
    metroPlaying: false,
    metroPan: 0,
    countIn: false,
    subdivide: false,
    clickSound: DEFAULT_CLICK,
    volumes: { pad: 90, drums: 85, metro: 80, master: 90 },
    activeSongId: null,
    songs: [],
    lists: [],
    activeListId: null
  };
}

export const store = {
  /** 'solo' | 'host' | 'keyboardist' | 'drummer' | 'leader' */
  role: 'solo',
  roomCode: null,
  engine: null,
  library: new Library(),
  view: defaultView(),
  permissions: defaultPermissions(),
  prefs: loadPrefs(),
  user: null
};

export const REMOTE_ROLES = ['keyboardist', 'drummer', 'leader'];
export const isLocal = () => store.role === 'host' || store.role === 'solo';
export const isRemote = () => REMOTE_ROLES.includes(store.role);
export const allowed = (capability) => can(store.permissions, store.role, capability);

export function savePrefs(patch) {
  Object.assign(store.prefs, patch);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs)); } catch (e) { /* modo privado */ }
  emit('prefs');
}

// Barramento de eventos
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, data) {
  listeners.get(event)?.forEach(fn => {
    try { fn(data); } catch (err) { console.error(`[evento ${event}]`, err); }
  });
}
