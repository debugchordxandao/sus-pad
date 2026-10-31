import { store, on } from '../store.js';
import { dispatch } from '../actions.js';
import { $, setRangeValue } from '../ui.js';

const CHANNELS = [
  { target: 'pad', fader: 'fader-pad', label: 'val-pad' },
  { target: 'drums', fader: 'fader-drums', label: 'val-drums' },
  { target: 'metro', fader: 'fader-metro', label: 'val-metro' },
  { target: 'master', fader: 'fader-master', label: 'val-master' }
];

const formatFade = (s) => `${Number(s).toFixed(1).replace('.', ',')} s`;

function render() {
  for (const ch of CHANNELS) {
    const value = store.view.volumes?.[ch.target] ?? 0;
    setRangeValue($(ch.fader), value);
    $(ch.label).textContent = `${value}%`;
  }
  setRangeValue($('pad-brightness'), store.view.padBrightness);
  $('val-brightness').textContent = `${store.view.padBrightness}%`;
  setRangeValue($('pad-fade'), store.view.padFade);
  $('val-fade').textContent = formatFade(store.view.padFade);
}

export function initMixer() {
  for (const ch of CHANNELS) {
    $(ch.fader).addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      $(ch.label).textContent = `${value}%`;
      dispatch('volume', { target: ch.target, value });
    });
  }
  $('pad-brightness').addEventListener('input', (e) => {
    const brightness = parseInt(e.target.value, 10);
    $('val-brightness').textContent = `${brightness}%`;
    dispatch('pad_opts', { brightness });
  });
  $('pad-fade').addEventListener('input', (e) => {
    const fade = parseFloat(e.target.value);
    $('val-fade').textContent = formatFade(fade);
    dispatch('pad_opts', { fade });
  });

  on('view', render);
  render();
}
