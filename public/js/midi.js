/**
 * Teclado ou pedal MIDI (Web MIDI: Chrome e Edge no Windows, Mac e Android).
 *
 * - Qualquer nota toca o pad do mesmo tom (todas as oitavas); a mesma nota de novo para o pad
 * - Pedal de sustain (CC 64): próxima música do repertório
 * - Pedal de sostenuto/soft (CC 66/67) ou Program Change: parar o pad
 */

import { store, emit, allowed } from './store.js';
import { dispatch } from './actions.js';

let access = null;
let pedalDown = false;

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export function midiDevices() {
  if (!access) return [];
  return [...access.inputs.values()].filter(i => i.state === 'connected').map(i => i.name || 'Aparelho MIDI');
}

function handleMessage(event) {
  const [status, data1 = 0, data2 = 0] = event.data;
  const kind = status & 0xf0;

  if (kind === 0x90 && data2 > 0) {
    if (!allowed('pads')) return;
    const tone = data1 % 12;
    if (store.view.activeToneIndex === tone) dispatch('pad_off');
    else dispatch('pad_on', { toneIndex: tone });
  } else if (kind === 0xb0 && data1 === 64) {
    // Dispara só na descida do pedal
    const down = data2 >= 64;
    if (down && !pedalDown && allowed('setlist')) dispatch('song_next');
    pedalDown = down;
  } else if ((kind === 0xb0 && (data1 === 66 || data1 === 67) && data2 >= 64) || kind === 0xc0) {
    if (allowed('pads')) dispatch('pad_off');
  }
}

function attachInputs() {
  if (!access) return;
  for (const input of access.inputs.values()) input.onmidimessage = handleMessage;
  emit('midi', midiDevices());
}

export async function enableMidi() {
  if (!midiSupported()) throw new Error('Este navegador não suporta MIDI. Use o Chrome ou o Edge.');
  if (!access) {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = attachInputs;
  }
  attachInputs();
  return midiDevices();
}

export function disableMidi() {
  if (!access) return;
  for (const input of access.inputs.values()) input.onmidimessage = null;
  emit('midi', []);
}
