/**
 * Aba Cifra: mostra a cifra da música ativa no tom da música e acompanha as mudanças
 * (próxima música, ±½ tom) em todos os aparelhos da sala.
 * No host/solo, a mesma aba tem o campo para colar a cifra (do Cifra Club, por exemplo).
 * Capo, cifra simplificada, rolagem automática e modo palco valem só para este aparelho.
 */

import { store, on, savePrefs, isLocal } from '../store.js';
import { dispatch } from '../actions.js';
import { $, el, labels, toast, fillSelect } from '../ui.js';
import { classifyLines, renderChart, detectKey, keyName, cleanChart, isChordLine, suggestCapo } from '../chords.js';

const MIN_SIZE = 11;
const MAX_SIZE = 30;
const MAX_CAPO = 9;
const MAX_SPEED = 8;

let shown = '';
let editing = false;
let titleTouched = false;
let stage = false;
let capoSong = null;
let capo = 0;

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

// ---------------------------------------------------------------------------
// Rolagem automática
// ---------------------------------------------------------------------------

let scrolling = false;
let raf = 0;
let pos = 0;
let lastTick = 0;

/** Quem rola de fato (a própria cifra ou a página, conforme o tamanho da tela). */
function scroller() {
  let node = $('chart-body');
  while (node && node !== document.documentElement) {
    if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return document.scrollingElement;
}

const pixelsPerSecond = () => 6 + store.prefs.chartSpeed * 7;

function tick(now) {
  if (!scrolling) return;
  const box = scroller();
  pos += ((now - lastTick) / 1000) * pixelsPerSecond();
  lastTick = now;
  box.scrollTop = pos;
  if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) { stopScroll(); return; }
  raf = requestAnimationFrame(tick);
}

function startScroll() {
  scrolling = true;
  pos = scroller().scrollTop;
  lastTick = performance.now();
  raf = requestAnimationFrame(tick);
  renderTools();
}

function stopScroll() {
  if (!scrolling) return;
  scrolling = false;
  cancelAnimationFrame(raf);
  renderTools();
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

function renderTools() {
  const cur = current();
  const local = isLocal();
  const editorVisible = local && (editing || !cur);
  $('chart-tools').classList.toggle('hidden', !cur || editorVisible);
  if (!cur) return;

  const { chart, song } = cur;
  const simple = store.prefs.chartSimple;
  $('chart-capo-label').textContent = capo ? `Capo ${capo}` : 'Sem capo';
  $('btn-chart-simple').setAttribute('aria-pressed', String(simple));
  $('btn-chart-scroll').setAttribute('aria-pressed', String(scrolling));
  $('btn-chart-scroll').textContent = scrolling ? 'Parar' : 'Rolar';
  $('chart-speed').classList.toggle('hidden', !scrolling);
  $('chart-speed-label').textContent = String(store.prefs.chartSpeed);
  $('btn-chart-stage').textContent = stage ? 'Sair do palco' : 'Palco';

  const minor = !!detectKey(chart.text)?.minor;
  const optionsSig = `${minor}|${store.prefs.notation}|${store.prefs.accidental}`;
  const pick = $('chart-key-select');
  if (pick.dataset.sig !== optionsSig) { // só refaz a lista quando muda; assim não fecha o seletor aberto
    fillSelect(pick, Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: keyLabel(i, minor) })));
    pick.dataset.sig = optionsSig;
  }
  pick.value = String(song.keyIndex);
  $('btn-chart-original').classList.toggle('hidden', song.keyIndex === chart.key);
  $('btn-chart-original').textContent = `Tom original (${keyLabel(chart.key, minor)})`;

  const suggested = suggestCapo(chart.text, chart.key, song.keyIndex, simple);
  const hint = $('btn-capo-hint');
  hint.classList.toggle('hidden', !suggested || suggested === capo);
  hint.textContent = `Sugestão: capo ${suggested}`;
  hint.dataset.capo = String(suggested);
}

function render() {
  const cur = current();
  const song = activeSong();
  const local = isLocal();
  const editorVisible = local && (editing || !cur);

  if ((song?.id ?? null) !== capoSong) { capoSong = song?.id ?? null; capo = 0; stopScroll(); } // cada música começa sem capo
  if (!cur && stage) setStage(false);

  $('btn-song-chart').classList.toggle('hidden', !cur);
  $('btn-chart-edit').classList.toggle('hidden', !local || !song || editorVisible);
  $('btn-chart-edit').textContent = 'Editar cifra';
  $('chart-editor').classList.toggle('hidden', !editorVisible);
  $('chart-new-title-row').classList.toggle('hidden', !!song);
  $('btn-chart-cancel').classList.toggle('hidden', !cur);
  $('btn-chart-clipboard').classList.toggle('hidden', !navigator.clipboard?.readText);
  $('chart-body').classList.toggle('hidden', !cur || editorVisible);
  document.querySelector('#tab-chart .chart-size').classList.toggle('hidden', !cur || editorVisible);
  $('chart-empty').textContent = local || cur ? '' : (song ? 'Esta música não tem cifra.' : 'Nenhuma música ativa.');
  $('chart-title').textContent = song ? song.title : '';
  $('chart-notes').textContent = song?.notes || '';
  $('chart-notes').classList.toggle('hidden', !song?.notes || editorVisible);
  if (editorVisible) stopScroll();

  if (!cur) { $('chart-key').textContent = ''; shown = ''; renderTools(); return; }
  const { chart } = cur;
  const simple = store.prefs.chartSimple;
  const minor = !!detectKey(chart.text)?.minor;
  $('chart-key').textContent = [
    song.keyIndex === chart.key ? keyLabel(song.keyIndex, minor) : `${keyLabel(song.keyIndex, minor)} · original ${keyLabel(chart.key, minor)}`,
    capo ? `capo ${capo}` : ''
  ].filter(Boolean).join(' · ');

  const size = store.prefs.chartSize;
  const signature = `${song.id}|${song.keyIndex}|${chart.key}|${chart.text.length}|${size}|${capo}|${simple}|${stage}`;
  renderTools();
  if (signature === shown) return;
  const body = $('chart-body');
  const top = body.scrollTop;
  const sameSong = shown.startsWith(`${song.id}|`);
  body.style.setProperty('--chart-size', `${size}px`);
  body.replaceChildren(...classifyLines(renderChart(chart.text, chart.key, song.keyIndex, { capo, simple }))
    .map(line => el('div', { class: `cl cl-${line.type}`, text: line.text })));
  body.scrollTop = sameSong ? top : 0; // trocar o tom não volta ao topo; outra música, sim
  if (!sameSong) stopScroll();
  shown = signature;
}

function setStage(on) {
  stage = on;
  document.body.classList.toggle('chart-stage', on);
  stopScroll();
  shown = '';
  render();
}

// ---------------------------------------------------------------------------
// Colar e salvar (host/solo)
// ---------------------------------------------------------------------------

function onInput() {
  const text = $('chart-input').value;
  const found = text.trim() ? detectKey(text) : null;
  $('chart-hint').textContent = !text.trim() ? ''
    : found ? `Tom detectado: ${keyLabel(found.key, found.minor)}. A cifra acompanha o tom da música.`
      : 'Não achei acordes. Confira se colou a cifra com os acordes.';
  if (!activeSong() && !titleTouched) $('chart-new-title').value = guessTitle(cleanChart(text));
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
  e?.preventDefault();
  let text = cleanChart($('chart-input').value);
  const guess = guessTitle(text);
  if (guess) text = cleanChart(text.split('\n').slice(1).join('\n')); // a 1ª linha era o título, não faz parte da cifra
  const found = detectKey(text);
  const song = activeSong();
  if (song) {
    const hadChart = !!store.library.getSong(song.id)?.chart;
    dispatch('setlist_edit', { songId: song.id, updates: { chart: text, chartKey: found ? found.key : song.keyIndex } });
    if (text && found && !hadChart && found.key !== song.keyIndex) {
      dispatch('transpose', { toneIndex: found.key }); // primeira cifra: a música passa para o tom dela (e o pad junto)
      toast(`Cifra salva. Tom da música ajustado para ${keyLabel(found.key, found.minor)}.`, 'success');
    } else {
      toast(text ? 'Cifra salva' : 'Cifra removida', 'success');
    }
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

/** Lê a área de transferência e salva direto, se o texto tiver acordes. */
async function pasteFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (err) { /* sem permissão */ }
  if (!text || !text.trim()) { toast('Nada para colar. Copie a cifra primeiro, ou cole no campo.', 'error'); return; }
  $('chart-input').value = text;
  onInput();
  if (detectKey(cleanChart(text))) save();
  else toast('Não achei acordes nesse texto. Confira antes de salvar.', 'error');
}

// ---------------------------------------------------------------------------

function setCapo(value) {
  capo = Math.min(MAX_CAPO, Math.max(0, value));
  render();
}

export function initChart() {
  $('btn-song-chart').addEventListener('click', () => $('nav-seg-chart').click());
  $('btn-chart-edit').addEventListener('click', startEdit);
  $('btn-chart-cancel').addEventListener('click', () => { editing = false; render(); });
  $('btn-chart-clipboard').addEventListener('click', pasteFromClipboard);
  $('chart-editor').addEventListener('submit', save);
  $('chart-input').addEventListener('input', onInput);
  $('chart-new-title').addEventListener('input', () => { titleTouched = true; });
  $('chart-key-select').addEventListener('change', (e) => dispatch('transpose', { toneIndex: Number(e.target.value) }));
  $('btn-chart-original').addEventListener('click', () => {
    const cur = current();
    if (cur) dispatch('transpose', { toneIndex: cur.chart.key });
  });
  $('btn-chart-down').addEventListener('click', () => dispatch('transpose', { delta: -1 }));
  $('btn-chart-up').addEventListener('click', () => dispatch('transpose', { delta: 1 }));
  $('btn-chart-smaller').addEventListener('click', () => savePrefs({ chartSize: Math.max(MIN_SIZE, store.prefs.chartSize - 1) }));
  $('btn-chart-bigger').addEventListener('click', () => savePrefs({ chartSize: Math.min(MAX_SIZE, store.prefs.chartSize + 1) }));
  $('btn-capo-down').addEventListener('click', () => setCapo(capo - 1));
  $('btn-capo-up').addEventListener('click', () => setCapo(capo + 1));
  $('btn-capo-hint').addEventListener('click', () => setCapo(Number($('btn-capo-hint').dataset.capo)));
  $('btn-chart-simple').addEventListener('click', () => savePrefs({ chartSimple: !store.prefs.chartSimple }));
  $('btn-chart-scroll').addEventListener('click', () => (scrolling ? stopScroll() : startScroll()));
  $('btn-speed-down').addEventListener('click', () => savePrefs({ chartSpeed: Math.max(1, store.prefs.chartSpeed - 1) }));
  $('btn-speed-up').addEventListener('click', () => savePrefs({ chartSpeed: Math.min(MAX_SPEED, store.prefs.chartSpeed + 1) }));
  $('btn-chart-stage').addEventListener('click', () => setStage(!stage));

  // Tocar ou rolar com o dedo assume o controle: a rolagem automática para
  const body = $('chart-body');
  body.addEventListener('wheel', stopScroll, { passive: true });
  body.addEventListener('touchstart', stopScroll, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage) setStage(false);
  });
  document.querySelectorAll('.nav-segment').forEach(seg => seg.addEventListener('click', () => {
    if (seg.dataset.tab !== 'tab-chart') { stopScroll(); if (stage) setStage(false); }
  }));

  on('view', render);
  on('prefs', render);
  on('permissions', render);
  render();
}
