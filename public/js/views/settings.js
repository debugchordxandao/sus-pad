import { store, on, savePrefs } from '../store.js';
import { $, openModal, closeModal, toast } from '../ui.js';
import { enableMidi, disableMidi, midiSupported, midiDevices } from '../midi.js';
import { SusPadAudioEngine } from '../audio-engine.js';

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
    renderMidiStatus();
    renderOffline();
    openModal($('modal-settings'));
  });
  $('btn-close-settings').addEventListener('click', () => closeModal($('modal-settings')));
  $('settings-midi').addEventListener('change', (e) => setMidi(e.target.checked));
  $('btn-download-all').addEventListener('click', downloadAll);
  on('midi', renderMidiStatus);

  // Reativa o MIDI ao abrir o app, se estava ligado
  if (store.prefs.midi && midiSupported()) enableMidi().catch(() => {});
}
