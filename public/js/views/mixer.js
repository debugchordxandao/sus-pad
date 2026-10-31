import { store, on } from '../store.js';
import { dispatch } from '../actions.js';
import { $, setRangeValue } from '../ui.js';

const CHANNELS = [
  { target: 'pad', fader: 'fader-pad', label: 'val-pad' },
  { target: 'drums', fader: 'fader-drums', label: 'val-drums' },
  { target: 'metro', fader: 'fader-metro', label: 'val-metro' },
  { target: 'master', fader: 'fader-master', label: 'val-master' }
];

function render() {
  for (const ch of CHANNELS) {
    const value = store.view.volumes?.[ch.target] ?? 0;
    setRangeValue($(ch.fader), value);
    $(ch.label).textContent = `${value}%`;
  }
}

export function initMixer() {
  for (const ch of CHANNELS) {
    $(ch.fader).addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      $(ch.label).textContent = `${value}%`;
      dispatch('volume', { target: ch.target, value });
    });
  }
  on('view', render);
  render();
}
