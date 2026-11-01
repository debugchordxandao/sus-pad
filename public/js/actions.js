/**
 * Ações do app. Toda interação passa por dispatch():
 * - no host e no modo solo, a ação roda direto no motor de áudio;
 * - num controle remoto, vai para o host pela sala (e a tela já reflete a mudança).
 * O host executa os comandos recebidos pelo mesmo caminho (runCommand).
 */

import { store, emit, isLocal, allowed } from './store.js';
import { send } from './net.js';
import { COMMAND_CAPABILITY } from './permissions.js';
import { TIME_SIGNATURES } from './catalog.js';
import { toast } from './ui.js';

const lib = () => store.library;
const engine = () => store.engine;

function activeChartOf(l) {
  const song = l.getSong(l.activeSongId);
  return song && song.chart ? { songId: song.id, text: song.chart, key: song.chartKey } : null;
}

/** Estado visível da sala, montado a partir do motor e da biblioteca (host/solo). */
export function buildView() {
  const e = engine();
  const l = lib();
  const anchor = e.metroAnchorWallClock();
  return {
    activeToneIndex: e.activeToneIndex,
    padPreset: e.targetPreset,
    padLoading: e.padLoading,
    drumKit: e.drumKit,
    bpm: e.bpm,
    timeSig: e.timeSig,
    metroPlaying: e.metroPlaying,
    metroPan: e.metroPan,
    countIn: e.countIn,
    subdivide: e.subdivide,
    clickSound: e.clickSound,
    // Em relógio do servidor, para cada celular converter para o próprio relógio
    metroAnchor: anchor ? { at: anchor.at + (store.clockOffset || 0), beat: anchor.beat } : null,
    padBrightness: e.padBrightness,
    padFade: e.padFade,
    volumes: { ...e.volumes },
    activeSongId: l.activeSongId,
    // A cifra é pesada: a lista só diz se existe (hasChart) e o texto vai só da música ativa
    activeChart: activeChartOf(l),
    songs: l.songs.map(({ chart, chartKey, ...song }) => ({ ...song, hasChart: !!chart })),
    lists: l.lists.map(x => ({ id: x.id, name: x.name })),
    activeListId: l.list.id
  };
}

// Fade geral do pad, guardado enquanto uma música com fade próprio está ativa
let baseFade = null;

function applySongFade(song) {
  const e = engine();
  if (song.fade) {
    if (baseFade === null) baseFade = e.padFade;
    e.setPadOptions({ fade: song.fade });
  } else if (baseFade !== null) {
    e.setPadOptions({ fade: baseFade });
    baseFade = null;
  }
}

function activateSong(song, silent = false) {
  if (!song) return;
  const e = engine();
  if (silent) { // só seleciona a música (ex.: cifra recém-colada), sem tocar o pad nem mexer no click
    lib().activeSongId = song.id;
    emit('song-activated', song);
    return;
  }
  applySongFade(song);
  // Toca na hora (no timbre atual) e faz crossfade para o timbre da música quando ele carregar
  e.playTone(song.keyIndex);
  e.setPadPreset(song.preset, song.keyIndex);
  e.setMetronomeBpm(song.bpm);
  e.setMetronomeTimeSig(song.timeSig);
  lib().activeSongId = song.id;
  emit('song-activated', song);
  const next = lib().nextSong();
  if (next && next.preset !== song.preset) e.prefetchPreset(next.preset);
}

const validTone = (i) => Number.isInteger(i) && i >= 0 && i <= 11;

/** Executores (rodam só no host/solo). Retornar false = não mudou o estado da sala. */
const executors = {
  pad_on: ({ toneIndex }) => { if (validTone(toneIndex)) engine().playTone(toneIndex); },
  pad_off: () => engine().stopPad(0.4),
  pad_preset: ({ preset }) => { engine().setPadPreset(preset); },
  pad_opts: ({ brightness, fade }) => {
    if (fade !== undefined) baseFade = null;
    engine().setPadOptions({ brightness, fade });
  },
  drum_hit: ({ padIndex, velocity }) => {
    engine().playDrumPad(padIndex, typeof velocity === 'number' ? velocity : 1);
    emit('drum-hit', padIndex);
    return false;
  },
  drum_kit: ({ kitId }) => engine().setDrumKit(kitId),
  metro: ({ action }) => (action === 'start' ? engine().startMetronome() : engine().stopMetronome()),
  bpm: ({ value }) => engine().setMetronomeBpm(value),
  timesig: ({ value }) => { if (TIME_SIGNATURES.includes(value)) engine().setMetronomeTimeSig(value); },
  metro_pan: ({ value }) => engine().setMetronomePan(value),
  metro_opts: ({ countIn, subdivide, clickSound }) => engine().setMetronomeOptions({ countIn, subdivide, clickSound }),
  volume: ({ target, value }) => engine().setVolume(target, value),
  panic: ({ fromName }) => {
    engine().panicStop();
    toast(fromName ? `Pânico acionado por ${fromName}` : 'Todos os sons parados', 'error');
  },
  song_activate: ({ songId, silent }) => activateSong(lib().getSong(songId), silent === true),
  song_next: () => {
    const next = lib().nextSong();
    if (next) activateSong(next);
    else toast('Fim do repertório');
  },
  // Muda o tom da música ativa: meio tom (delta) ou direto para um tom (toneIndex)
  transpose: ({ delta, toneIndex }) => {
    const song = lib().getSong(lib().activeSongId);
    if (!song) return false;
    let key;
    if (validTone(toneIndex)) key = toneIndex;
    else if (delta === 1 || delta === -1) key = (song.keyIndex + delta + 12) % 12;
    else return false;
    if (key === song.keyIndex) return false;
    lib().updateSong(song.id, { keyIndex: key });
    if (engine().activeToneIndex !== null) engine().playTone(key);
  },
  setlist_add: ({ song }) => { lib().addSong(song); },
  setlist_edit: ({ songId, updates }) => { lib().updateSong(songId, updates); },
  setlist_delete: ({ songId }) => lib().deleteSong(songId),
  setlist_reorder: ({ order }) => lib().reorder(order),
  setlist_select: ({ listId }) => { lib().selectList(listId); },
  setlist_import: ({ songs }) => {
    const added = lib().addSongs(songs);
    toast(added ? `${added} ${added === 1 ? 'música adicionada' : 'músicas adicionadas'}` : 'Nenhuma música encontrada no texto', added ? 'success' : 'error');
  }
};

export const COMMANDS = Object.keys(executors);

/** Atualização otimista no controle remoto, para a tela responder antes do eco do host. */
const optimistic = {
  pad_on: ({ toneIndex }) => ({ activeToneIndex: toneIndex }),
  pad_off: () => ({ activeToneIndex: null }),
  song_activate: ({ songId, silent }) => {
    const song = store.view.songs.find(x => x.id === songId);
    if (!song) return {};
    return silent ? { activeSongId: songId } : { activeSongId: songId, activeToneIndex: song.keyIndex, bpm: song.bpm, timeSig: song.timeSig };
  },
  pad_preset: ({ preset }) => ({ padPreset: preset }),
  drum_kit: ({ kitId }) => ({ drumKit: kitId }),
  bpm: ({ value }) => ({ bpm: value }),
  timesig: ({ value }) => ({ timeSig: value }),
  metro_pan: ({ value }) => ({ metroPan: value }),
  metro_opts: (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
  pad_opts: ({ brightness, fade }) => ({
    ...(brightness !== undefined ? { padBrightness: brightness } : {}),
    ...(fade !== undefined ? { padFade: fade } : {})
  }),
  volume: ({ target, value }) => ({ volumes: { ...store.view.volumes, [target]: value } })
};

export function dispatch(type, payload = {}) {
  if (isLocal()) {
    runCommand(type, payload);
    return;
  }
  const capability = COMMAND_CAPABILITY[type];
  if (capability && !allowed(capability)) {
    toast('Sua função não tem permissão para isso nesta sala.', 'error');
    return;
  }
  if (!send({ type, ...payload })) {
    toast('Sem conexão com a sala.', 'error');
    return;
  }
  if (optimistic[type]) {
    store.view = { ...store.view, ...optimistic[type](payload) };
    emit('view', store.view);
  }
}

/** Executa um comando no motor local (host/solo) e propaga o novo estado. */
export function runCommand(type, payload = {}) {
  const fn = executors[type];
  if (!fn || !engine()) return;
  const changed = fn(payload);
  if (changed !== false) commit();
}

// ---------------------------------------------------------------------------
// Estado: host/solo → telas e sala
// ---------------------------------------------------------------------------

const BROADCAST_INTERVAL_MS = 30;
let lastBroadcast = 0;
let broadcastTimer = null;

export function commit() {
  if (!isLocal() || !engine()) return;
  store.view = buildView();
  emit('view', store.view);
  if (store.role === 'host') scheduleBroadcast();
}

/** Envia o estado à sala no máximo a cada 30 ms (arrastar um fader não inunda a rede). */
function scheduleBroadcast() {
  const wait = BROADCAST_INTERVAL_MS - (Date.now() - lastBroadcast);
  if (wait <= 0) {
    broadcastNow();
  } else if (!broadcastTimer) {
    broadcastTimer = setTimeout(broadcastNow, wait);
  }
}

// A sala guarda o último estado enviado, então a cifra só vai de novo quando muda
let chartSent = '';

export function broadcastNow() {
  clearTimeout(broadcastTimer);
  broadcastTimer = null;
  lastBroadcast = Date.now();
  const { activeChart, ...state } = store.view;
  const signature = `${store.roomCode}|${activeChart ? `${activeChart.songId}|${activeChart.key}|${activeChart.text}` : ''}`;
  if (signature !== chartSent) {
    state.activeChart = activeChart;
    chartSent = signature;
  }
  send({ type: 'host_state_update', state });
}

/** Controle remoto: aplica o estado enviado pelo host. */
export function applyRemoteState(state) {
  if (!state || typeof state !== 'object') return;
  const next = { ...store.view };
  for (const key of Object.keys(next)) {
    if (state[key] !== undefined) next[key] = state[key];
  }
  if (!Array.isArray(next.songs)) next.songs = [];
  if (!Array.isArray(next.lists)) next.lists = [];
  store.view = next;
  emit('view', store.view);
}
