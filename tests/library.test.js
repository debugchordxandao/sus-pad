const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'js', file));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('normalizeSong limpa e limita tudo que vem de fora', async () => {
  const { normalizeSong } = await load('library.js');
  const s = normalizeSong({ title: '  <b>x</b>\n'.repeat(30), keyIndex: 99, bpm: 'abc', timeSig: '7/8', preset: 'hack', notes: 5 });
  assert.equal(s.title.length <= 80, true);
  assert.equal(s.keyIndex, 11);
  assert.equal(s.bpm, 120);
  assert.equal(s.timeSig, '4/4');
  assert.equal(s.preset, 'shimmer_2');
  assert.equal(s.notes, '5');
  assert.equal(normalizeSong({ title: '' }).title, 'Nova música');
});

test('migra o repertório antigo (array) para a biblioteca nova', async () => {
  const { Library } = await load('library.js');
  const storage = memoryStorage({ padstudio_setlist: JSON.stringify([{ id: 'a', title: 'Antiga', keyIndex: 2 }]) });
  const lib = new Library(storage);
  assert.equal(lib.lists.length, 1);
  assert.equal(lib.songs[0].title, 'Antiga');
});

test('vários repertórios: criar, trocar, renomear e excluir (sempre sobra um)', async () => {
  const { Library } = await load('library.js');
  const lib = new Library(memoryStorage());
  const first = lib.list.id;
  const sunday = lib.addList('Domingo');
  assert.equal(lib.list.id, sunday.id);
  assert.equal(lib.songs.length, 0);
  lib.addSong({ title: 'Nova' });
  lib.renameList(sunday.id, 'Domingo manhã');
  assert.equal(lib.list.name, 'Domingo manhã');
  lib.selectList(first);
  assert.equal(lib.songs.length, 4);
  assert.equal(lib.deleteList(sunday.id), true);
  assert.equal(lib.deleteList(first), false, 'não pode excluir o último');
});

test('reordenar ignora ids desconhecidos e não perde músicas', async () => {
  const { Library } = await load('library.js');
  const lib = new Library(memoryStorage());
  const ids = lib.songs.map(s => s.id);
  lib.reorder([ids[3], 'inexistente', ids[0]]);
  assert.deepEqual(lib.songs.map(s => s.id), [ids[3], ids[0], ids[1], ids[2]]);
});

test('próxima música segue a ordem e para no fim', async () => {
  const { Library } = await load('library.js');
  const lib = new Library(memoryStorage());
  assert.equal(lib.nextSong().id, lib.songs[0].id, 'sem música ativa, começa da primeira');
  lib.activeSongId = lib.songs[2].id;
  assert.equal(lib.nextSong().id, lib.songs[3].id);
  lib.activeSongId = lib.songs[3].id;
  assert.equal(lib.nextSong(), null);
});

test('salva no armazenamento e marca a data da alteração', async () => {
  const { Library, STORAGE_KEY } = await load('library.js');
  const storage = memoryStorage();
  const lib = new Library(storage);
  lib.updateSong(lib.songs[0].id, { bpm: 77 });
  const saved = JSON.parse(storage.data[STORAGE_KEY]);
  assert.equal(saved.lists[0].songs[0].bpm, 77);
  assert.ok(saved.updatedAt > 0);
});

test('cifra: guarda o texto e o tom, limpa a colagem e sobrevive a edições parciais', async () => {
  const { normalizeSong, Library } = await load('library.js');
  const song = normalizeSong({ title: 'X', keyIndex: 7, chart: 'G\tD  \r\nEm C', chartKey: 7 });
  assert.equal(song.chart, 'G    D\nEm C');
  assert.equal(song.chartKey, 7);
  assert.equal(normalizeSong({ title: 'Y', keyIndex: 4 }).chart, '');
  assert.equal(normalizeSong({ title: 'Y', keyIndex: 4, chart: 'C' }).chartKey, 4); // sem tom informado, vale o da música

  const lib = new Library(memoryStorage());
  const added = lib.addSong({ title: 'Z', keyIndex: 0, chart: 'C  G', chartKey: 0 });
  lib.updateSong(added.id, { title: 'Z2', keyIndex: 2 }); // edição que não manda a cifra não a apaga
  const saved = lib.getSong(added.id);
  assert.equal(saved.chart, 'C  G');
  assert.equal(saved.chartKey, 0);
  assert.equal(saved.keyIndex, 2);
});
