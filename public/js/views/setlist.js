import { store, on, isLocal, allowed } from '../store.js';
import { dispatch, commit } from '../actions.js';
import { $, el, labels, fillSelect, openModal, closeModal, confirmButton, toast } from '../ui.js';
import { PAD_PRESETS, TIME_SIGNATURES } from '../catalog.js';
import { normalizeSong } from '../library.js';

const NEW_LIST = '__new';
const EDIT_LIST = '__edit';

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
  if (isLocal()) {
    const group = document.createElement('optgroup');
    group.label = '──────';
    group.append(new Option('Novo repertório…', NEW_LIST), new Option('Renomear ou excluir…', EDIT_LIST));
    children.push(group);
  }
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
    if (value === NEW_LIST || value === EDIT_LIST) {
      e.target.value = store.view.activeListId;
      openListSheet(value === NEW_LIST ? 'new' : 'edit');
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
// Editor de música
// ---------------------------------------------------------------------------

let editingSongId = null;
let resetDelete = () => {};

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
  $('btn-song-delete').classList.toggle('hidden', !song);
  openModal($('modal-song'));
  if (!song) setTimeout(() => $('song-title').focus(), 60);
}

function initEditor() {
  fillSelect($('song-timesig'), TIME_SIGNATURES.map(t => ({ id: t, name: t })));
  fillSelect($('song-preset'), PAD_PRESETS);

  $('form-song').addEventListener('submit', (e) => {
    e.preventDefault();
    const { id, ...data } = normalizeSong({
      title: $('song-title').value,
      keyIndex: $('song-key').value,
      bpm: $('song-bpm').value,
      timeSig: $('song-timesig').value,
      preset: $('song-preset').value,
      notes: $('song-notes').value
    });
    if (editingSongId) dispatch('setlist_edit', { songId: editingSongId, updates: data });
    else dispatch('setlist_add', { song: data });
    closeModal($('modal-song'));
  });

  resetDelete = confirmButton($('btn-song-delete'), 'Excluir música', 'Toque de novo para excluir', () => {
    if (editingSongId) dispatch('setlist_delete', { songId: editingSongId });
    closeModal($('modal-song'));
  });

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
  $('btn-transpose-down').addEventListener('click', () => dispatch('transpose', { delta: -1 }));
  $('btn-transpose-up').addEventListener('click', () => dispatch('transpose', { delta: 1 }));
  $('btn-song-next').addEventListener('click', activateNext);

  const render = () => { renderListSelect(); renderList(); renderStrip(); };
  on('view', render);
  on('prefs', render);
  on('permissions', render);
  render();
}
