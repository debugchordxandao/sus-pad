/**
 * PadStudio Setlist & Repertoire Manager
 * Todas as entradas passam por normalizeSong() — inclusive edições vindas de aparelhos remotos.
 */

const SETLIST_STORAGE_KEY = 'padstudio_setlist';
const VALID_TIME_SIGS = ['4/4', '3/4', '6/8', '2/4'];
const VALID_PRESETS = ['shimmer_2', 'warm_pad', 'worship', 'pad_shimmer', 'abba_pad', 'dark_pad', 'pad_reverse', 'pad_synth'];

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSong(input, base = {}) {
  const src = { ...base, ...(input || {}) };
  const title = String(src.title ?? '').trim().slice(0, 80) || 'Nova música';
  return {
    id: String(src.id || base.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    title,
    keyIndex: clampInt(src.keyIndex, 0, 11, 0),
    bpm: clampInt(src.bpm, 30, 320, 120),
    timeSig: VALID_TIME_SIGS.includes(src.timeSig) ? src.timeSig : '4/4',
    preset: VALID_PRESETS.includes(src.preset) ? src.preset : 'shimmer_2'
  };
}

class PadStudioSetlistManager {
  constructor() {
    this.songs = this.loadSongs();
    this.activeSongId = null;
    this.onListChanged = null;
  }

  loadSongs() {
    try {
      const saved = localStorage.getItem(SETLIST_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(s => normalizeSong(s));
      }
    } catch (e) { /* armazenamento indisponível: usa o repertório padrão */ }

    return [
      { id: '1', title: 'A Casa é Sua', keyIndex: 7, bpm: 130, timeSig: '4/4', preset: 'warm_pad' },
      { id: '2', title: 'Ousado Amor', keyIndex: 8, bpm: 68, timeSig: '6/8', preset: 'pad_shimmer' },
      { id: '3', title: 'Lindo És', keyIndex: 0, bpm: 72, timeSig: '4/4', preset: 'worship' },
      { id: '4', title: 'Ruja o Leão', keyIndex: 2, bpm: 140, timeSig: '4/4', preset: 'abba_pad' }
    ];
  }

  /** Substitui a lista inteira (ex.: estado recebido do host) sem persistir. */
  replaceAll(songs) {
    if (!Array.isArray(songs)) return;
    this.songs = songs.map(s => normalizeSong(s));
  }

  saveSongs() {
    try {
      localStorage.setItem(SETLIST_STORAGE_KEY, JSON.stringify(this.songs));
    } catch (e) { /* modo privado / sem espaço */ }
    if (this.onListChanged) this.onListChanged(this.songs);
  }

  addSong(song) {
    const newSong = normalizeSong({ ...song, id: undefined });
    this.songs.push(newSong);
    this.saveSongs();
    return newSong;
  }

  updateSong(id, updates) {
    const idx = this.songs.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this.songs[idx] = normalizeSong({ ...updates, id }, this.songs[idx]);
    this.saveSongs();
    return this.songs[idx];
  }

  deleteSong(id) {
    this.songs = this.songs.filter(s => s.id !== id);
    if (this.activeSongId === id) this.activeSongId = null;
    this.saveSongs();
  }

  getSong(id) {
    return this.songs.find(s => s.id === id) || null;
  }
}

window.PadStudioSetlistManager = PadStudioSetlistManager;
window.normalizeSong = normalizeSong;
