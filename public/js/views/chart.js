/**
 * Aba Cifra: mostra a cifra da música ativa no tom da música e acompanha as mudanças
 * (próxima música, ±½ tom) em todos os aparelhos da sala.
 * No host/solo, a mesma aba tem o campo para colar a cifra (do Cifra Club, por exemplo).
 */

import { store, on, savePrefs, isLocal } from '../store.js';
import { dispatch } from '../actions.js';
import { $, el, labels, toast } from '../ui.js';
import { classifyLines, chartForKey, detectKey, keyName, cleanChart, isChordLine } from '../chords.js';

const MIN_SIZE = 11;
const MAX_SIZE = 30;

let shown = '';
let editing = false;
let titleTouched = false;

const activeSong = () => store.view.songs.find(s => s.id === store.view.activeSongId) || null;

function current() {
  const chart = store.view.activeChart;
  const song = activeSong();
  return chart && song && chart.songId === song.id ? { chart, song } : null;
}

/** Título provável no começo do texto colado ("Grande é o Senhor - Cifra Club"). */
export function guessTitle(text) {
  const first = String(text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  if (!first || first.length > 80 || isChordLine(first) || /^tom\s*:/i.test(first) || /^\[/.test(first)) return '';
  return first.replace(/\s+[-–|]\s*cifra\s*club.*$/i, '').trim();
}

function keyLabel(index, minor) {
  return store.prefs.notation === 'cifra' ? keyName(index, minor) + (minor ? 'm' : '') : labels()[index] + (minor ? 'm' : '');
}

function render() {
  const cur = current();
  const song = activeSong();
  const local = isLocal();
  const editorVisible = local && (editing || !cur);

  $('btn-song-chart').classList.toggle('hidden', !cur);
  $('btn-chart-edit').classList.toggle('hidden', !local || !song || editorVisible);
  $('btn-chart-edit').textContent = 'Editar cifra';
  $('chart-editor').classList.toggle('hidden', !editorVisible);
  $('chart-new-title-row').classList.toggle('hidden', !!song);
  $('btn-chart-cancel').classList.toggle('hidden', !cur);
  $('chart-body').classList.toggle('hidden', !cur || editorVisible);
  document.querySelector('#tab-chart .chart-size').classList.toggle('hidden', !cur || editorVisible);
  $('chart-empty').textContent = local || cur ? '' : (song ? 'Esta música não tem cifra.' : 'Nenhuma música ativa.');
  $('chart-title').textContent = song ? song.title : '';

  if (!cur) { $('chart-key').textContent = ''; shown = ''; return; }
  const { chart } = cur;
  const minor = !!detectKey(chart.text)?.minor;
  $('chart-key').textContent = song.keyIndex === chart.key
    ? keyLabel(song.keyIndex, minor)
    : `${keyLabel(song.keyIndex, minor)} · original ${keyLabel(chart.key, minor)}`;

  const size = store.prefs.chartSize;
  const signature = `${song.id}|${song.keyIndex}|${chart.key}|${chart.text.length}|${size}`;
  if (signature === shown) return;
  const body = $('chart-body');
  const top = body.scrollTop;
  const sameSong = shown.startsWith(`${song.id}|`);
  body.style.setProperty('--chart-size', `${size}px`);
  body.replaceChildren(...classifyLines(chartForKey(chart.text, chart.key, song.keyIndex))
    .map(line => el('div', { class: `cl cl-${line.type}`, text: line.text })));
  body.scrollTop = sameSong ? top : 0; // trocar o tom não volta ao topo; outra música, sim
  shown = signature;
}

function onInput() {
  const text = $('chart-input').value;
  const found = text.trim() ? detectKey(text) : null;
  $('chart-hint').textContent = !text.trim() ? ''
    : found ? `Tom detectado: ${keyLabel(found.key, found.minor)}. A cifra acompanha o tom da música.`
      : 'Não achei acordes. Confira se colou a cifra com os acordes.';
  if (!activeSong() && !titleTouched) $('chart-new-title').value = guessTitle(text);
}

function startEdit() {
  const song = activeSong();
  const saved = song ? store.library.getSong(song.id) : null;
  $('chart-input').value = saved?.chart || '';
  $('chart-hint').textContent = '';
  editing = true;
  render();
  setTimeout(() => $('chart-input').focus(), 60);
}

function save(e) {
  e.preventDefault();
  let text = cleanChart($('chart-input').value);
  const guess = guessTitle(text);
  if (guess) text = cleanChart(text.split('\n').slice(1).join('\n')); // a 1ª linha era o título, não faz parte da cifra
  const found = detectKey(text);
  const song = activeSong();
  if (song) {
    dispatch('setlist_edit', { songId: song.id, updates: { chart: text, chartKey: found ? found.key : song.keyIndex } });
    toast(text ? 'Cifra salva' : 'Cifra removida', 'success');
  } else {
    if (!text) { toast('Cole a cifra primeiro.', 'error'); return; }
    const key = found ? found.key : 0;
    dispatch('setlist_add', {
      song: {
        title: $('chart-new-title').value.trim() || guess || 'Nova música',
        keyIndex: key, chartKey: key, chart: text,
        bpm: store.view.bpm, timeSig: store.view.timeSig, preset: store.view.padPreset
      }
    });
    const created = store.view.songs[store.view.songs.length - 1];
    if (created) dispatch('song_activate', { songId: created.id, silent: true }); // só mostra, sem tocar o pad
    toast('Música e cifra adicionadas', 'success');
  }
  editing = false;
  titleTouched = false;
  $('chart-input').value = '';
  $('chart-new-title').value = '';
  shown = '';
  render();
}

function resize(delta) {
  savePrefs({ chartSize: Math.min(MAX_SIZE, Math.max(MIN_SIZE, store.prefs.chartSize + delta)) });
}

export function initChart() {
  $('btn-song-chart').addEventListener('click', () => $('nav-seg-chart').click());
  $('btn-chart-edit').addEventListener('click', startEdit);
  $('btn-chart-cancel').addEventListener('click', () => { editing = false; render(); });
  $('chart-editor').addEventListener('submit', save);
  $('chart-input').addEventListener('input', onInput);
  $('chart-new-title').addEventListener('input', () => { titleTouched = true; });
  $('btn-chart-smaller').addEventListener('click', () => resize(-1));
  $('btn-chart-bigger').addEventListener('click', () => resize(1));

  on('view', render);
  on('prefs', render);
  on('permissions', render);
  render();
}
