/**
 * Biblioteca de repertórios (vários repertórios, cada um com suas músicas).
 * Código puro, sem DOM: roda no navegador e nos testes do Node.
 * Tudo que entra passa por normalizeSong/normalizeLibrary, inclusive dados vindos
 * de outros aparelhos ou do servidor.
 */

import { PRESET_IDS, DEFAULT_PRESET, TIME_SIGNATURES } from './catalog.js';
import { cleanChart } from './chords.js';

export const STORAGE_KEY = 'padstudio_library';
const LEGACY_KEY = 'padstudio_setlist';
export const MAX_SONGS = 300;
export const MAX_LISTS = 50;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function normalizeSong(input, base = {}) {
  const src = { ...base, ...(input && typeof input === 'object' ? input : {}) };
  const keyIndex = clampInt(src.keyIndex, 0, 11, 0);
  return {
    id: cleanText(src.id, 40) || newId(),
    title: cleanText(src.title, 80) || 'Nova música',
    keyIndex,
    bpm: clampInt(src.bpm, 30, 300, 120),
    timeSig: TIME_SIGNATURES.includes(src.timeSig) ? src.timeSig : '4/4',
    preset: PRESET_IDS.includes(src.preset) ? src.preset : DEFAULT_PRESET,
    notes: cleanText(src.notes, 140),
    // Cifra colada (texto) e o tom em que ela foi escrita; a tela transpõe para o tom da música
    chart: cleanChart(src.chart),
    chartKey: clampInt(src.chartKey, 0, 11, keyIndex)
  };
}

function normalizeSongs(songs) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(songs) ? songs.slice(0, MAX_SONGS) : []) {
    const song = normalizeSong(raw);
    if (seen.has(song.id)) song.id = newId();
    seen.add(song.id);
    out.push(song);
  }
  return out;
}

export function normalizeList(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    id: cleanText(src.id, 40) || newId(),
    name: cleanText(src.name, 40) || 'Repertório',
    songs: normalizeSongs(src.songs)
  };
}

export const DEFAULT_SONGS = [];

/** Aceita o formato antigo (array de músicas) e o novo ({ lists, activeListId }). */
export function normalizeLibrary(raw) {
  let lists;
  let activeListId;
  let updatedAt = 0;
  if (Array.isArray(raw)) {
    lists = [normalizeList({ name: 'Repertório', songs: raw })];
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.lists)) {
    lists = raw.lists.slice(0, MAX_LISTS).map(normalizeList);
    activeListId = raw.activeListId;
    updatedAt = Number(raw.updatedAt) || 0;
  }
  if (!lists || lists.length === 0) {
    lists = [normalizeList({ name: 'Repertório', songs: DEFAULT_SONGS })];
  }
  const ids = new Set();
  lists.forEach(l => { if (ids.has(l.id)) l.id = newId(); ids.add(l.id); });
  if (!ids.has(activeListId)) activeListId = lists[0].id;
  return { version: 2, lists, activeListId, updatedAt };
}

export class Library {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.listeners = new Set();
    this.activeSongId = null;
    this.data = this.load();
  }

  load() {
    try {
      const saved = this.storage?.getItem(STORAGE_KEY);
      if (saved) {
        const lib = normalizeLibrary(JSON.parse(saved));
        this.cleanLegacyDefaults(lib);
        return lib;
      }
      const legacy = this.storage?.getItem(LEGACY_KEY);
      if (legacy) {
        const lib = normalizeLibrary(JSON.parse(legacy));
        this.cleanLegacyDefaults(lib);
        return lib;
      }
    } catch (e) { /* armazenamento indisponível ou corrompido */ }
    return normalizeLibrary(null);
  }

  cleanLegacyDefaults(lib) {
    if (!lib?.lists) return;
    const legacyTitles = new Set(['A Casa é Sua', 'Ousado Amor', 'Lindo És', 'Ruja o Leão']);
    let modified = false;
    for (const l of lib.lists) {
      if (Array.isArray(l.songs)) {
        const initialLen = l.songs.length;
        l.songs = l.songs.filter(s => !legacyTitles.has(s.title));
        if (l.songs.length !== initialLen) modified = true;
      }
    }
    if (modified) {
      try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(lib)); } catch (e) {}
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save() {
    this.data.updatedAt = Date.now();
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { /* sem espaço */ }
    this.listeners.forEach(fn => fn(this.data));
  }

  toJSON() { return this.data; }

  /** Substitui tudo pelo que veio do servidor (sem marcar como alteração local). */
  replace(raw) {
    this.data = normalizeLibrary(raw);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    this.listeners.forEach(fn => fn(this.data));
  }

  // Repertórios
  get lists() { return this.data.lists; }
  get list() { return this.data.lists.find(l => l.id === this.data.activeListId) || this.data.lists[0]; }
  get songs() { return this.list.songs; }

  selectList(id) {
    if (!this.data.lists.some(l => l.id === id) || id === this.data.activeListId) return false;
    this.data.activeListId = id;
    this.activeSongId = null;
    this.save();
    return true;
  }

  addList(name) {
    if (this.data.lists.length >= MAX_LISTS) return null;
    const list = normalizeList({ name, songs: [] });
    this.data.lists.push(list);
    this.data.activeListId = list.id;
    this.activeSongId = null;
    this.save();
    return list;
  }

  renameList(id, name) {
    const list = this.data.lists.find(l => l.id === id);
    if (!list) return;
    list.name = normalizeList({ name }).name;
    this.save();
  }

  deleteList(id) {
    if (this.data.lists.length <= 1) return false;
    this.data.lists = this.data.lists.filter(l => l.id !== id);
    if (this.data.activeListId === id) {
      this.data.activeListId = this.data.lists[0].id;
      this.activeSongId = null;
    }
    this.save();
    return true;
  }

  // Músicas do repertório ativo
  getSong(id) { return this.songs.find(s => s.id === id) || null; }

  addSong(song) {
    if (this.songs.length >= MAX_SONGS) return null;
    const created = normalizeSong({ ...song, id: undefined });
    this.songs.push(created);
    this.save();
    return created;
  }

  /** Adiciona várias músicas de uma vez (importação). Devolve quantas entraram. */
  addSongs(songs) {
    if (!Array.isArray(songs)) return 0;
    const room = MAX_SONGS - this.songs.length;
    const created = songs.slice(0, Math.max(0, room)).map(s => normalizeSong({ ...s, id: undefined }));
    if (!created.length) return 0;
    this.songs.push(...created);
    this.save();
    return created.length;
  }

  updateSong(id, updates) {
    const idx = this.songs.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this.songs[idx] = normalizeSong({ ...updates, id }, this.songs[idx]);
    this.save();
    return this.songs[idx];
  }

  deleteSong(id) {
    const before = this.songs.length;
    this.list.songs = this.songs.filter(s => s.id !== id);
    if (this.activeSongId === id) this.activeSongId = null;
    if (this.songs.length !== before) this.save();
  }

  /** Reordena pelo array de ids; ids desconhecidos são ignorados e os que faltam vão para o fim. */
  reorder(ids) {
    if (!Array.isArray(ids)) return;
    const byId = new Map(this.songs.map(s => [s.id, s]));
    const ordered = [];
    for (const id of ids) {
      const song = byId.get(id);
      if (song) { ordered.push(song); byId.delete(id); }
    }
    this.list.songs = [...ordered, ...byId.values()];
    this.save();
  }

  nextSong() {
    const idx = this.songs.findIndex(s => s.id === this.activeSongId);
    return this.songs[idx + 1] || (idx === -1 ? this.songs[0] : null) || null;
  }
}
