/**
 * PadStudio Setlist & Repertoire Manager
 */

class PadStudioSetlistManager {
  constructor() {
    this.songs = this.loadSongs();
    this.activeSongId = null;
    this.onListChanged = null;
  }

  loadSongs() {
    try {
      const saved = localStorage.getItem('padstudio_setlist');
      if (saved) return JSON.parse(saved);
    } catch (e) {}

    return [
      { id: '1', title: '01. A Casa é Sua', keyIndex: 7, bpm: 130, timeSig: '4/4', preset: 'warm_pad' },
      { id: '2', title: '02. Ousado Amor', keyIndex: 8, bpm: 68, timeSig: '6/8', preset: 'pad_shimmer' },
      { id: '3', title: '03. Lindo És', keyIndex: 0, bpm: 72, timeSig: '4/4', preset: 'worship' },
      { id: '4', title: '04. Ruja o Leão', keyIndex: 2, bpm: 140, timeSig: '4/4', preset: 'abba_pad' }
    ];
  }

  saveSongs() {
    try {
      localStorage.setItem('padstudio_setlist', JSON.stringify(this.songs));
      if (this.onListChanged) this.onListChanged(this.songs);
    } catch (e) {}
  }

  addSong(title = 'Nova Música', keyIndex = 0, bpm = 120, timeSig = '4/4', preset = 'warm_pad') {
    const newSong = {
      id: Date.now().toString(),
      title,
      keyIndex: parseInt(keyIndex),
      bpm: parseInt(bpm),
      timeSig,
      preset
    };
    this.songs.push(newSong);
    this.saveSongs();
    return newSong;
  }

  updateSong(id, updates) {
    const idx = this.songs.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.songs[idx] = { ...this.songs[idx], ...updates };
      this.saveSongs();
    }
  }

  deleteSong(id) {
    this.songs = this.songs.filter(s => s.id !== id);
    this.saveSongs();
  }

  getSong(id) {
    return this.songs.find(s => s.id === id) || null;
  }
}

window.PadStudioSetlistManager = PadStudioSetlistManager;

