import { store, on, isLocal, allowed } from '../store.js';
import { dispatch, commit } from '../actions.js';
import { $, el, labels, fillSelect, openModal, closeModal, confirmButton, toast } from '../ui.js';
import { PAD_PRESETS, TIME_SIGNATURES } from '../catalog.js';
import { normalizeSong } from '../library.js';
import { parseSetlistText, formatSetlistText } from '../setlist-text.js';
import { detectKey } from '../chords.js';
import { createShareLink } from '../share.js';

const NEW_LIST = '__new';
const EDIT_LIST = '__edit';
const IMPORT_LIST = '__import';
const SHARE_LIST = '__share';

let editing = false;
let dragging = false;
let listSignature = '';
let selectSignature = '';

const activeSong = () => store.view.songs.find(s => s.id === store.view.activeSongId) || null;

function nextSong() {
  const songs = store.view.songs;
  const idx = songs.findIndex(s => s.id === store.view.activeSongId);
  return songs[idx + 1] || (idx === -1 ? songs[0] : null) || null;
}

export function activateNext() {
  if (!nextSong()) { toast('Fim do repertório'); return; }
  dispatch('song_next');
}

// ---------------------------------------------------------------------------
// Lista de músicas
// ---------------------------------------------------------------------------

function songMeta(song) {
  return `${labels()[song.keyIndex]} · ${song.bpm} BPM · ${song.timeSig}`;
}

function renderList(force = false) {
  if (dragging) return;
  // Só redesenha quando algo da lista mudou: um redesenho no meio de um toque perderia o clique
  const signature = JSON.stringify([store.view.songs, store.view.activeSongId, labels(), editing, allowed('setlist')]);
  if (!force && signature === listSignature) return;
  listSignature = signature;
  const list = $('songs-list');
  list.classList.toggle('editing', editing);
  const activeId = store.view.activeSongId;
  list.replaceChildren(...store.view.songs.map(song => {
    const isActive = song.id === activeId;
    const meta = el('button', { class: 'song-meta', type: 'button', onclick: () => !editing && openSongEditor(song) }, [
      el('strong', { text: song.title }),
      el('span', { text: songMeta(song) })
    ]);
    const play = el('button', {
      class: 'song-play-btn', type: 'button', text: isActive ? 'Tocando' : 'Ativar',
      onclick: () => dispatch('song_activate', { songId: song.id })
    });
    const handle = el('span', { class: 'song-handle', 'aria-label': 'Arrastar para reordenar', role: 'button' });
    const row = el('div', { class: `setlist-item${isActive ? ' active-song' : ''}`, dataset: { id: song.id } }, [meta, play, handle]);
    handle.addEventListener('pointerdown', (e) => startDrag(e, row));
    return row;
  }));
  $('btn-setlist-edit').classList.toggle('hidden', store.view.songs.length < 2 || !allowed('setlist'));
  $('btn-setlist-edit').textContent = editing ? 'OK' : 'Editar';
}

/** Arrastar pela alça para reordenar (mouse e toque). */
function startDrag(e, row) {
  e.preventDefault();
  const list = $('songs-list');
  const scroller = document.querySelector('.main-stage');
  const before = [...list.children].map(r => r.dataset.id).join();
  dragging = true;
  row.classList.add('dragging');
  e.target.setPointerCapture?.(e.pointerId);

  const move = (ev) => {
    const y = ev.clientY;
    const others = [...list.children].filter(r => r !== row);
    const target = others.find(r => {
      const rect = r.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (target) list.insertBefore(row, target);
    else list.appendChild(row);
    const box = scroller.getBoundingClientRect();
    if (y < box.top + 60) scroller.scrollTop -= 12;
    else if (y > box.bottom - 120) scroller.scrollTop += 12;
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    row.classList.remove('dragging');
    dragging = false;
    const order = [...list.children].map(r => r.dataset.id);
    if (order.join() !== before) dispatch('setlist_reorder', { order });
    else renderList(true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// Repertórios
// ---------------------------------------------------------------------------

function renderListSelect() {
  const select = $('setlist-select');
  const signature = JSON.stringify([store.view.lists, store.view.activeListId, isLocal()]);
  if (signature === selectSignature) return;
  selectSignature = signature;
  const options = store.view.lists.map(l => new Option(l.name, l.id));
  const children = [...options];
  const group = document.createElement('optgroup');
  group.label = '──────';
  if (isLocal()) group.append(new Option('Novo repertório…', NEW_LIST), new Option('Renomear ou excluir…', EDIT_LIST));
  group.append(new Option('Colar lista…', IMPORT_LIST), new Option('Compartilhar…', SHARE_LIST));
  children.push(group);
  select.replaceChildren(...children);
  select.value = store.view.activeListId;
}

let listMode = 'new';

function openListSheet(mode) {
  listMode = mode;
  const current = store.library.list;
  $('list-sheet-title').textContent = mode === 'new' ? 'Novo repertório' : 'Repertório';
  $('list-name').value = mode === 'new' ? '' : current.name;
  $('btn-list-delete').classList.toggle('hidden', mode === 'new' || store.library.lists.length < 2);
  openModal($('modal-list'));
  setTimeout(() => $('list-name').focus(), 60);
}

function initLists() {
  $('setlist-select').addEventListener('change', (e) => {
    const value = e.target.value;
    if ([NEW_LIST, EDIT_LIST, IMPORT_LIST, SHARE_LIST].includes(value)) {
      e.target.value = store.view.activeListId;
      if (value === IMPORT_LIST) openImportSheet();
      else if (value === SHARE_LIST) shareList();
      else openListSheet(value === NEW_LIST ? 'new' : 'edit');
      return;
    }
    dispatch('setlist_select', { listId: value });
  });

  $('form-list').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('list-name').value.trim() || 'Repertório';
    if (listMode === 'new') store.library.addList(name);
    else store.library.renameList(store.library.list.id, name);
    commit();
    closeModal($('modal-list'));
  });
  $('btn-close-list').addEventListener('click', () => closeModal($('modal-list')));
  confirmButton($('btn-list-delete'), 'Excluir repertório', 'Toque de novo para excluir', () => {
    store.library.deleteList(store.library.list.id);
    commit();
    closeModal($('modal-list'));
  });
}

// ---------------------------------------------------------------------------
// Colar lista (WhatsApp) e compartilhar
// ---------------------------------------------------------------------------

function currentListName() {
  return store.view.lists.find(l => l.id === store.view.activeListId)?.name || 'Repertório';
}

function previewImport() {
  const { name, songs } = parseSetlistText($('import-text').value);
  $('import-preview').textContent = songs.length
    ? `${songs.length} ${songs.length === 1 ? 'música' : 'músicas'}: ${songs.slice(0, 3).map(s => `${s.title} (${labels()[s.keyIndex]})`).join(', ')}${songs.length > 3 ? '…' : ''}`
    : '';
  $('import-new-row').classList.toggle('hidden', !isLocal());
  if (name && !$('import-new').dataset.touched) $('import-new').checked = true;
  $('btn-import-submit').disabled = songs.length === 0;
  return { name, songs };
}

function openImportSheet() {
  $('import-text').value = '';
  $('import-new').checked = false;
  delete $('import-new').dataset.touched;
  previewImport();
  openModal($('modal-import'));
  setTimeout(() => $('import-text').focus(), 60);
}

async function shareList() {
  // Quem tem as músicas completas (host/solo) compartilha por link; o link leva as cifras junto
  if (isLocal()) {
    try {
      const list = store.library.list;
      if (list.songs.length) {
        const link = await createShareLink({ name: list.name, songs: list.songs });
        if (navigator.share) {
          try { await navigator.share({ title: list.name, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        await navigator.clipboard.writeText(link);
        toast('Link copiado. Quem abrir recebe o repertório.', 'success');
        return;
      }
    } catch (e) { /* sem rede ou sem permissão: cai no texto */ }
  }
  const text = formatSetlistText(currentListName(), store.view.songs, labels());
  try {
    if (navigator.share) {
      await navigator.share({ title: currentListName(), text });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Repertório copiado. É só colar no grupo da banda.', 'success');
  } catch (e) {
    toast('Não foi possível copiar neste navegador.', 'error');
  }
}

function initImport() {
  $('import-text').addEventListener('input', previewImport);
  $('import-new').addEventListener('change', () => { $('import-new').dataset.touched = '1'; });
  $('btn-close-import').addEventListener('click', () => closeModal($('modal-import')));
  $('form-import').addEventListener('submit', (e) => {
    e.preventDefault();
    const { name, songs } = previewImport();
    if (!songs.length) return;
    if (isLocal() && $('import-new').checked) {
      store.library.addList(name || 'Repertório importado');
      commit();
    }
    dispatch('setlist_import', { songs: songs.map(s => { const { id, ...rest } = normalizeSong(s); return rest; }) });
    closeModal($('modal-import'));
  });
}

// ---------------------------------------------------------------------------
// Editor de música
// ---------------------------------------------------------------------------

let editingSongId = null;
let resetDelete = () => {};
let keyTouched = false;
let chartKeyTouched = false;

/** Mostra o tom detectado na cifra colada e ajusta os campos que o usuário ainda não mexeu. */
function onChartInput() {
  const text = $('song-chart').value;
  const found = text.trim() ? detectKey(text) : null;
  $('song-chart-key-row').classList.toggle('hidden', !text.trim());
  $('song-chart-hint').textContent = !text.trim() ? ''
    : found ? `Tom detectado na cifra: ${labels()[found.key]}${found.minor ? ' menor' : ''}. A cifra acompanha o tom da música.`
      : 'Não achei acordes. Confira se colou a cifra com os acordes.';
  if (!found) return;
  if (!chartKeyTouched) $('song-chart-key').value = String(found.key);
  if (!editingSongId && !keyTouched) $('song-key').value = String(found.key);
}

export function openSongEditor(song) {
  editingSongId = song ? song.id : null;
  resetDelete();
  $('song-sheet-title').textContent = song ? 'Editar música' : 'Nova música';
  $('song-title').value = song ? song.title : '';
  fillSelect($('song-key'), labels().map((name, i) => ({ id: String(i), name })), String(song ? song.keyIndex : (store.view.activeToneIndex ?? 0)));
  $('song-bpm').value = song ? song.bpm : store.view.bpm;
  $('song-timesig').value = song ? song.timeSig : store.view.timeSig;
  $('song-preset').value = song ? song.preset : store.view.padPreset;
  $('song-notes').value = song ? song.notes || '' : '';
  $('song-fade').value = String(song ? song.fade || 0 : 0);

  // A cifra fica no host/solo; os controles remotos só a veem (tela Cifra)
  const local = isLocal();
  const stored = song && local ? store.library.getSong(song.id) : null;
  $('song-chart-group').classList.toggle('hidden', !local);
  fillSelect($('song-chart-key'), labels().map((name, i) => ({ id: String(i), name })), String(stored?.chart ? stored.chartKey : (song ? song.keyIndex : (store.view.activeToneIndex ?? 0))));
  $('song-chart').value = stored?.chart || '';
  keyTouched = false;
  chartKeyTouched = !!stored?.chart;
  onChartInput();
  if (stored?.chart) $('song-chart-hint').textContent = '';
  $('btn-song-delete').classList.toggle('hidden', !song);
  openModal($('modal-song'));
  if (!song) setTimeout(() => $('song-title').focus(), 60);
}

function initEditor() {
  fillSelect($('song-timesig'), TIME_SIGNATURES.map(t => ({ id: t, name: t })));
  fillSelect($('song-preset'), PAD_PRESETS);
  fillSelect($('song-fade'), [['0', 'Padrão'], ['1', '1 s'], ['2', '2 s'], ['3', '3 s'], ['4', '4 s'], ['6', '6 s']].map(([id, name]) => ({ id, name })));

  $('form-song').addEventListener('submit', (e) => {
    e.preventDefault();
    const { id, ...data } = normalizeSong({
      title: $('song-title').value,
      keyIndex: $('song-key').value,
      bpm: $('song-bpm').value,
      timeSig: $('song-timesig').value,
      preset: $('song-preset').value,
      notes: $('song-notes').value,
      fade: $('song-fade').value,
      chart: $('song-chart').value,
      chartKey: $('song-chart-key').value
    });
    if (!isLocal()) { delete data.chart; delete data.chartKey; } // o texto da cifra só muda no host
    if (editingSongId) dispatch('setlist_edit', { songId: editingSongId, updates: data });
    else dispatch('setlist_add', { song: data });
    closeModal($('modal-song'));
  });

  resetDelete = confirmButton($('btn-song-delete'), 'Excluir música', 'Toque de novo para excluir', () => {
    if (editingSongId) dispatch('setlist_delete', { songId: editingSongId });
    closeModal($('modal-song'));
  });

  $('song-chart').addEventListener('input', onChartInput);
  $('song-key').addEventListener('change', () => { keyTouched = true; });
  $('song-chart-key').addEventListener('change', () => { chartKeyTouched = true; });
  $('btn-close-song').addEventListener('click', () => closeModal($('modal-song')));
  $('btn-add-song').addEventListener('click', () => openSongEditor(null));
  $('btn-setlist-edit').addEventListener('click', () => { editing = !editing; renderList(true); });
}

// ---------------------------------------------------------------------------
// Barra da música atual (visível em todas as abas)
// ---------------------------------------------------------------------------

function renderStrip() {
  const song = activeSong();
  const strip = $('song-strip');
  strip.classList.toggle('hidden', !song);
  if (!song) return;
  $('song-strip-title').textContent = song.title;
  $('song-strip-meta').textContent = songMeta(song);
  $('song-strip-notes').textContent = song.notes || '';
  const next = nextSong();
  $('btn-song-next').disabled = !next;
  $('btn-song-next').title = next ? `Próxima: ${next.title}` : 'Fim do repertório';
}

export function initSetlist() {
  initLists();
  initEditor();
  initImport();
  $('btn-transpose-down').addEventListener('click', () => dispatch('transpose', { delta: -1 }));
  $('btn-transpose-up').addEventListener('click', () => dispatch('transpose', { delta: 1 }));
  $('btn-song-next').addEventListener('click', activateNext);

  const render = () => { renderListSelect(); renderList(); renderStrip(); };
  on('view', render);
  on('prefs', render);
  on('permissions', render);
  render();
}
