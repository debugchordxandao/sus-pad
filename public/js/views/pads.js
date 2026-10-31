import { store, on, savePrefs } from '../store.js';
import { dispatch } from '../actions.js';
import { $, el, labels, fillSelect } from '../ui.js';
import { PAD_PRESETS } from '../catalog.js';

/** Liga ou desliga um tom (usado pelos pads, pelo MIDI e pelo teclado). */
export function toggleTone(index) {
  if (store.view.activeToneIndex === index) dispatch('pad_off');
  else dispatch('pad_on', { toneIndex: index });
}

let renderedLabels = '';

function renderGrid() {
  const names = labels();
  const key = names.join();
  const grid = $('tones-grid');
  if (key !== renderedLabels) {
    renderedLabels = key;
    grid.replaceChildren(...names.map((name, i) => el('button', {
      class: 'tone-button',
      dataset: { index: i },
      'aria-label': `Tom ${name}`,
      onpointerdown: (e) => { e.preventDefault(); toggleTone(i); }
    }, [el('span', { class: 'tone-note', text: name })])));
  }
  const active = store.view.activeToneIndex;
  grid.querySelectorAll('.tone-button').forEach((btn, i) => {
    btn.classList.toggle('playing', i === active);
    btn.setAttribute('aria-pressed', i === active);
  });
}

function renderDock() {
  const active = store.view.activeToneIndex;
  const hasTone = active !== null && active !== undefined;
  document.querySelector('.floating-bar').classList.toggle('has-tone', hasTone);
  $('active-tone-name').textContent = hasTone ? labels()[active] : '';
  $('pad-pulse').classList.toggle('active', hasTone);
}

function renderPreset() {
  const select = $('pad-preset-select');
  if (select.value !== store.view.padPreset) select.value = store.view.padPreset;
  $('pad-loading').classList.toggle('hidden', !store.view.padLoading);
}

function renderNotation() {
  const { notation, accidental } = store.prefs;
  $('btn-notation-cifra').classList.toggle('active', notation === 'cifra');
  $('btn-notation-solfejo').classList.toggle('active', notation === 'solfejo');
  $('btn-accidental-sharp').classList.toggle('active', accidental === 'sharp');
  $('btn-accidental-flat').classList.toggle('active', accidental === 'flat');
}

export function initPads() {
  fillSelect($('pad-preset-select'), PAD_PRESETS, store.view.padPreset);
  $('pad-preset-select').addEventListener('change', (e) => dispatch('pad_preset', { preset: e.target.value }));
  $('btn-pad-stop').addEventListener('click', () => dispatch('pad_off'));

  $('btn-notation-cifra').addEventListener('click', () => savePrefs({ notation: 'cifra' }));
  $('btn-notation-solfejo').addEventListener('click', () => savePrefs({ notation: 'solfejo' }));
  $('btn-accidental-sharp').addEventListener('click', () => savePrefs({ accidental: 'sharp' }));
  $('btn-accidental-flat').addEventListener('click', () => savePrefs({ accidental: 'flat' }));

  const render = () => { renderGrid(); renderDock(); renderPreset(); };
  on('view', render);
  on('prefs', () => { renderNotation(); render(); });
  renderNotation();
  render();
}
