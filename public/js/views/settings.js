import { store, on, savePrefs, isLocal } from '../store.js';
import { commit } from '../actions.js';
import { $, openModal, closeModal, toast } from '../ui.js';
import { enableMidi, disableMidi, midiSupported, midiDevices } from '../midi.js';
import { SusPadAudioEngine } from '../audio-engine.js';
import { exportBackup, readBackup } from '../share.js';

function renderMidiStatus(devices = midiDevices()) {
  const status = $('midi-status');
  if (!midiSupported()) {
    status.textContent = 'Não suportado neste navegador';
    $('settings-midi').disabled = true;
    return;
  }
  if (!store.prefs.midi) status.textContent = '';
  else status.textContent = devices.length ? devices.join(', ') : 'Nenhum aparelho conectado';
}

async function setMidi(enabled) {
  savePrefs({ midi: enabled });
  if (!enabled) { disableMidi(); renderMidiStatus([]); return; }
  try {
    renderMidiStatus(await enableMidi());
  } catch (e) {
    savePrefs({ midi: false });
    $('settings-midi').checked = false;
    toast(e.message || 'Não foi possível acessar o MIDI.', 'error');
    renderMidiStatus([]);
  }
}

async function renderOffline() {
  const status = await SusPadAudioEngine.offlineStatus();
  const btn = $('btn-download-all');
  if (!status.supported) {
    $('offline-status').textContent = 'Disponível só em HTTPS';
    btn.disabled = true;
    return;
  }
  const complete = status.cached >= status.total;
  $('offline-status').textContent = complete ? 'Todos os sons salvos' : `${status.cached} de ${status.total} sons salvos`;
  btn.textContent = complete ? 'Sons salvos neste aparelho' : 'Baixar todos os sons';
  btn.disabled = complete;
}

async function downloadAll() {
  const btn = $('btn-download-all');
  btn.disabled = true;
  try {
    const result = await SusPadAudioEngine.downloadAll((done, total) => {
      btn.textContent = `Baixando… ${Math.round((done / total) * 100)}%`;
    });
    toast(result.failed ? `${result.failed} sons não baixaram. Tente de novo.` : 'Pronto: o app toca sem internet.', result.failed ? 'error' : 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
  renderOffline();
}

export function initSettings() {
  $('btn-settings').addEventListener('click', () => {
    $('settings-midi').checked = !!store.prefs.midi;
    $('settings-backup-group').classList.toggle('hidden', !isLocal());
    renderMidiStatus();
    renderOffline();
    openModal($('modal-settings'));
  });
  $('btn-close-settings').addEventListener('click', () => closeModal($('modal-settings')));
  $('settings-midi').addEventListener('change', (e) => setMidi(e.target.checked));
  $('btn-download-all').addEventListener('click', downloadAll);
  on('midi', renderMidiStatus);

  // Backup: só o host/solo tem a biblioteca completa
  $('btn-backup-export').addEventListener('click', exportBackup);
  $('btn-backup-import').addEventListener('click', () => $('backup-file').click());
  $('backup-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const library = await readBackup(file);
      const count = library.lists.reduce((n, l) => n + (Array.isArray(l.songs) ? l.songs.length : 0), 0);
      if (!window.confirm(`Restaurar ${count} músicas e substituir o repertório atual?`)) return;
      store.library.restore(library);
      commit();
      toast('Backup restaurado', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Reativa o MIDI ao abrir o app, se estava ligado
  if (store.prefs.midi && midiSupported()) enableMidi().catch(() => {});
}
