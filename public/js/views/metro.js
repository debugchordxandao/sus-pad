import { store, on } from '../store.js';
import { dispatch } from '../actions.js';
import { $, el, fillSelect, setRangeValue } from '../ui.js';
import { CLICK_SOUNDS, TIME_SIGNATURES } from '../catalog.js';

export const MIN_BPM = 30;
export const MAX_BPM = 300;

export function setBpm(bpm) {
  const value = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
  if (value !== store.view.bpm) dispatch('bpm', { value });
}

export function toggleMetro() {
  dispatch('metro', { action: store.view.metroPlaying ? 'stop' : 'start' });
}

// Tap tempo: média dos últimos toques; zera depois de 2,5 s parado
const taps = [];
export function tap() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(60000 / avg);
  }
}

/** Botão que repete enquanto está pressionado (acelera depois de meio segundo). */
function holdRepeat(button, fn) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fn();
    let delay = 400;
    const loop = () => { fn(); delay = Math.max(50, delay * 0.8); timer = setTimeout(loop, delay); };
    timer = setTimeout(loop, delay);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => button.addEventListener(ev, stop));
}

const PLAY_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20"/></svg>';
const PAUSE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

let renderedBeats = 0;
let wasPlaying = null;

function render() {
  const v = store.view;
  $('metro-full-bpm').textContent = v.bpm;
  $('tempo-number').textContent = v.bpm;

  const beats = parseInt(v.timeSig, 10) || 4;
  if (beats !== renderedBeats) {
    renderedBeats = beats;
    $('beat-dots').replaceChildren(...Array.from({ length: beats }, (_, i) => el('div', { class: 'beat-dot', dataset: { beat: i } })));
  }

  if (wasPlaying !== v.metroPlaying) {
    wasPlaying = v.metroPlaying;
    $('btn-metro-play').innerHTML = v.metroPlaying ? PAUSE_ICON : PLAY_ICON;
    $('btn-metro-play').setAttribute('aria-label', v.metroPlaying ? 'Parar click' : 'Iniciar click');
    if (!v.metroPlaying) $('beat-dots').querySelectorAll('.beat-dot').forEach(d => d.classList.remove('flash', 'flash-accent'));
  }
  $('btn-metro-play').classList.toggle('playing', v.metroPlaying);
  $('btn-metro-full-play').classList.toggle('playing', v.metroPlaying);
  $('btn-metro-full-play').textContent = v.metroPlaying ? 'Parar' : (v.countIn ? 'Contar' : 'Iniciar');

  if ($('metro-time-sig').value !== v.timeSig) $('metro-time-sig').value = v.timeSig;
  if ($('metro-click-sound').value !== v.clickSound) $('metro-click-sound').value = v.clickSound;
  $('metro-count-in').checked = !!v.countIn;
  $('metro-subdivide').checked = !!v.subdivide;

  setRangeValue($('metro-pan'), v.metroPan);
  $('pan-current-label').textContent = v.metroPan < -0.2 ? 'Esquerda' : v.metroPan > 0.2 ? 'Direita' : 'Centro';
}

function flashBeat({ beat, accent }) {
  const dots = $('beat-dots').querySelectorAll('.beat-dot');
  dots.forEach(d => d.classList.remove('flash', 'flash-accent'));
  const dot = dots[beat];
  if (!dot) return;
  dot.classList.add(accent ? 'flash-accent' : 'flash');
  setTimeout(() => dot.classList.remove('flash', 'flash-accent'), 110);
}

export function initMetro() {
  fillSelect($('metro-time-sig'), TIME_SIGNATURES.map(t => ({ id: t, name: t })), store.view.timeSig);
  fillSelect($('metro-click-sound'), CLICK_SOUNDS, store.view.clickSound);

  $('btn-metro-play').addEventListener('click', toggleMetro);
  $('btn-metro-full-play').addEventListener('click', toggleMetro);
  $('btn-metro-tap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
  $('btn-metro-full-tap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
  holdRepeat($('bpm-minus-1'), () => setBpm(store.view.bpm - 1));
  holdRepeat($('bpm-plus-1'), () => setBpm(store.view.bpm + 1));
  holdRepeat($('metro-bpm-minus'), () => setBpm(store.view.bpm - 1));
  holdRepeat($('metro-bpm-plus'), () => setBpm(store.view.bpm + 1));

  $('metro-time-sig').addEventListener('change', (e) => dispatch('timesig', { value: e.target.value }));
  $('metro-click-sound').addEventListener('change', (e) => dispatch('metro_opts', { clickSound: e.target.value }));
  $('metro-count-in').addEventListener('change', (e) => dispatch('metro_opts', { countIn: e.target.checked }));
  $('metro-subdivide').addEventListener('change', (e) => dispatch('metro_opts', { subdivide: e.target.checked }));
  $('metro-pan').addEventListener('input', (e) => dispatch('metro_pan', { value: parseFloat(e.target.value) }));

  on('view', render);
  on('beat', flashBeat);
  render();
}
