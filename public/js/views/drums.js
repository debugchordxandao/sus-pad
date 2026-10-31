import { store, on, allowed } from '../store.js';
import { dispatch } from '../actions.js';
import { $, el, fillSelect } from '../ui.js';
import { DRUM_KITS, DRUM_KEYS, getKit } from '../catalog.js';

let renderedKit = null;

function flash(index) {
  const pad = $('drums-grid').querySelector(`[data-pad-index="${index}"]`);
  if (!pad) return;
  pad.classList.remove('hit');
  void pad.offsetWidth; // reinicia a animação em toques rápidos
  pad.classList.add('hit');
  setTimeout(() => pad.classList.remove('hit'), 120);
}

export function hitDrum(index) {
  dispatch('drum_hit', { padIndex: index, velocity: 1 });
  if (store.role !== 'host' && store.role !== 'solo') flash(index); // no host o flash vem do executor
}

function render() {
  const kitId = store.view.drumKit;
  const select = $('drum-kit-select');
  if (select.value !== kitId) select.value = kitId;
  if (renderedKit === kitId) return;
  renderedKit = kitId;
  $('drums-grid').replaceChildren(...getKit(kitId).pads.map((p, i) => {
    const btn = el('button', {
      class: 'drum-pad',
      dataset: { padIndex: i },
      onpointerdown: (e) => { e.preventDefault(); hitDrum(i); }
    }, [
      el('span', { class: 'drum-key', text: DRUM_KEYS[i] }),
      el('span', { class: 'drum-title', text: p.name })
    ]);
    btn.style.setProperty('--accent', p.color);
    return btn;
  }));
}

export function initDrums() {
  fillSelect($('drum-kit-select'), DRUM_KITS, store.view.drumKit);
  $('drum-kit-select').addEventListener('change', (e) => dispatch('drum_kit', { kitId: e.target.value }));

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (!document.getElementById('screen-main-stage').classList.contains('active')) return;
    if (!allowed('drums')) return;
    const index = DRUM_KEYS.indexOf(e.key.toUpperCase());
    if (index !== -1) hitDrum(index);
  });

  on('view', render);
  on('drum-hit', flash);
  render();
}
