const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'js', file));

const WHATSAPP = `*Culto de Domingo 31/10* 🙌
1. Grande É o Senhor (D)
2) Bondade de Deus - G - 72 bpm
• Santo Espírito [Tom: E]
   obs: refrão 2x
4 - Ousado Amor – G#m · 68 BPM · 6/8
5. A Casa é Sua - Bb
6. Lindo És (Ré)
7. Deus de Promessas tom: F#
Ruja o Leão
🔥 Me Atraiu - A`;

test('lê a lista do WhatsApp: numeração, tom, BPM, compasso, anotações e emojis', async () => {
  const { parseSetlistText } = await load('setlist-text.js');
  const { name, songs } = parseSetlistText(WHATSAPP);
  assert.equal(name, 'Culto de Domingo 31/10');
  assert.deepEqual(songs.map(s => s.title), [
    'Grande É o Senhor', 'Bondade de Deus', 'Santo Espírito', 'Ousado Amor', 'A Casa é Sua',
    'Lindo És', 'Deus de Promessas', 'Ruja o Leão', 'Me Atraiu'
  ]);
  assert.deepEqual(songs.map(s => s.keyIndex), [2, 7, 4, 8, 10, 2, 6, 0, 9]);
  assert.equal(songs[1].bpm, 72);
  assert.equal(songs[3].timeSig, '6/8');
  assert.equal(songs[2].notes, 'refrão 2x');
});

test('não confunde a palavra "A" com o tom Lá', async () => {
  const { parseSetlistText } = await load('setlist-text.js');
  const { songs } = parseSetlistText('A Casa é Sua\na benção (ao vivo)');
  assert.deepEqual(songs.map(s => [s.title, s.keyIndex]), [['A Casa é Sua', 0], ['a benção (ao vivo)', 0]]);
});

test('compartilhar e colar de volta dá o mesmo repertório (inclusive ♯ e ♭)', async () => {
  const { parseSetlistText, formatSetlistText } = await load('setlist-text.js');
  const { noteLabels } = await load('catalog.js');
  const original = [
    { title: 'Ousado Amor', keyIndex: 8, bpm: 68, timeSig: '6/8', notes: 'Começa só teclado' },
    { title: 'Lindo És', keyIndex: 10, bpm: 72, timeSig: '4/4', notes: '' }
  ];
  for (const accidental of ['sharp', 'flat']) {
    const text = formatSetlistText('Domingo', original, noteLabels('cifra', accidental));
    const back = parseSetlistText(text);
    assert.equal(back.name, 'Domingo');
    assert.deepEqual(back.songs.map(s => [s.title, s.keyIndex, s.bpm, s.timeSig, s.notes || '']),
      original.map(s => [s.title, s.keyIndex, s.bpm, s.timeSig, s.notes]));
  }
});

test('biblioteca importa várias músicas de uma vez respeitando o limite', async () => {
  const { Library, MAX_SONGS } = await load('library.js');
  const lib = new Library({ getItem: () => null, setItem: () => {} });
  assert.equal(lib.addSongs([{ title: 'Uma' }, { title: 'Duas' }]), 2);
  assert.equal(lib.songs.length, 2);
  const many = Array.from({ length: MAX_SONGS }, (_, i) => ({ title: `M${i}` }));
  assert.equal(lib.addSongs(many), MAX_SONGS - 2);
  assert.equal(lib.songs.length, MAX_SONGS);
});
