/**
 * Tela de cifra: mostra a cifra da música ativa no tom da música e acompanha as mudanças
 * (próxima música, ±½ tom) em todos os aparelhos da sala.
 */

import { store, on, savePrefs } from '../store.js';
import { dispatch } from '../actions.js';
import { $, el, labels, openModal, closeModal } from '../ui.js';
import { classifyLines, chartForKey, detectKey, keyName } from '../chords.js';

const MIN_SIZE = 11;
const MAX_SIZE = 30;

let shown = '';

function current() {
  const chart = store.view.activeChart;
  const song = store.view.songs.find(s => s.id === store.view.activeSongId);
  return chart && song && chart.songId === song.id ? { chart, song } : null;
}

function render() {
  const cur = current();
  $('btn-song-chart').classList.toggle('hidden', !cur);
  const modal = $('modal-chart');
  if (modal.classList.contains('hidden')) return;
  if (!cur) { closeModal(modal); return; }

  const { chart, song } = cur;
  const size = store.prefs.chartSize;
  const signature = `${song.id}|${song.keyIndex}|${chart.key}|${chart.text.length}|${size}`;
  const minor = !!detectKey(chart.text)?.minor;
  const solfege = store.prefs.notation !== 'cifra';
  const names = solfege ? labels() : null;
  const name = (i) => (names ? names[i] : keyName(i, minor)) + (minor ? 'm' : '');
  $('chart-title').textContent = song.title;
  $('chart-key').textContent = song.keyIndex === chart.key
    ? `Tom ${name(song.keyIndex)}`
    : `Tom ${name(song.keyIndex)} · original ${name(chart.key)}`;
  if (signature === shown) return;

  const body = $('chart-body');
  const sameSong = shown.startsWith(`${song.id}|`);
  const top = body.scrollTop;
  body.style.setProperty('--chart-size', `${size}px`);
  body.replaceChildren(...classifyLines(chartForKey(chart.text, chart.key, song.keyIndex))
    .map(line => el('div', { class: `cl cl-${line.type}`, text: line.text })));
  body.scrollTop = sameSong ? top : 0; // trocar o tom não volta ao topo; outra música, sim
  shown = signature;
}

function resize(delta) {
  savePrefs({ chartSize: Math.min(MAX_SIZE, Math.max(MIN_SIZE, store.prefs.chartSize + delta)) });
}

export function initChart() {
  $('btn-song-chart').addEventListener('click', () => {
    shown = '';
    openModal($('modal-chart'));
    render();
  });
  $('btn-close-chart').addEventListener('click', () => closeModal($('modal-chart')));
  $('btn-chart-down').addEventListener('click', () => dispatch('transpose', { delta: -1 }));
  $('btn-chart-up').addEventListener('click', () => dispatch('transpose', { delta: 1 }));
  $('btn-chart-smaller').addEventListener('click', () => resize(-1));
  $('btn-chart-bigger').addEventListener('click', () => resize(1));

  on('view', render);
  on('prefs', render);
  render();
}
