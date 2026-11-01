const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'chords.js'));

const CIFRA = `Tom: G
[Intro] G  D/F#  Em  C

[Primeira Parte]
G              D/F#
Grande é o Senhor
Em             C
E digno de louvor

Am7(b5)  D7(#9)  |  G  x2
Amor, alegria e paz
e|---0---3---|
`;

test('reconhece acordes e rejeita palavras comuns', async () => {
  const { isChordLine, parseChord } = await load();
  for (const ok of ['G', 'F#m7', 'Bb/D', 'Am7(b5)', 'C7M', 'Gsus4', 'D4(9)', 'A#°', 'Cadd9', 'Em/G']) {
    assert.ok(parseChord(ok), ok);
  }
  for (const no of ['Amor', 'Alegria', 'Bom', 'Fa', 'Sol', 'e|---0---|']) {
    assert.equal(parseChord(no), null, no);
  }
  assert.ok(isChordLine('G   D/F#   Em   C'));
  assert.ok(isChordLine('[Intro] G D C'));
  assert.ok(isChordLine('(G)  [Em]  | C x2'));
  assert.ok(!isChordLine('A casa é sua'));
  assert.ok(!isChordLine('E assim'));
  assert.ok(!isChordLine('[Refrão]'));
});

test('transpõe só as linhas de acordes e mantém o alinhamento', async () => {
  const { transposeChart } = await load();
  const up2 = transposeChart(CIFRA, 2, false).split('\n');
  assert.equal(up2[0], 'Tom: A'); // o cabeçalho acompanha
  assert.equal(up2[1], '[Intro] A  E/G#  F#m D');
  assert.equal(up2[4], 'A              E/G#');
  assert.equal(up2[5], 'Grande é o Senhor');
  assert.equal(up2[6], 'F#m' + ' '.repeat(12) + 'D');
  assert.equal(up2[9], 'Bm7(b5)  E7(#9)  |  A  x2');
  assert.equal(up2[10], 'Amor, alegria e paz');
  assert.equal(up2[11], 'e|---0---3---|');
  assert.equal(up2[4].indexOf('E/G#'), 'G              D/F#'.indexOf('D/F#')); // acorde na mesma coluna
});

test('usa bemóis em tons como Bb e F, e sustenidos nos outros', async () => {
  const { transposeChart } = await load();
  assert.equal(transposeChart('G  D/F#  Em  C', 3, true), 'Bb F/A   Gm  Eb');
  assert.equal(transposeChart('G  D/F#  Em  C', 1, false), 'G# D#/G  Fm  C#');
});

test('transpor para cima e voltar devolve o texto original', async () => {
  const { transposeChart } = await load();
  const there = transposeChart(CIFRA, 5, false);
  assert.notEqual(there, CIFRA);
  assert.equal(transposeChart(there, 7, false), CIFRA);
});

test('descobre o tom da cifra', async () => {
  const { detectKey } = await load();
  assert.deepEqual(detectKey(CIFRA), { key: 7, minor: false });
  assert.deepEqual(detectKey('Am  F  C  G'), { key: 9, minor: true });
  assert.deepEqual(detectKey('Tom: F#m\nEm  A'), { key: 6, minor: true });
  assert.equal(detectKey('só letra, sem acordes'), null);
});

test('chartForKey segue o tom da música e escolhe bemóis em tons de bemol', async () => {
  const { chartForKey } = await load();
  assert.equal(chartForKey('G  C  D', 7, 7), 'G  C  D');
  assert.equal(chartForKey('G  C  D', 7, 10), 'Bb Eb F');
  assert.equal(chartForKey('Am  F  C  G', 9, 2), 'Dm  Bb F  C');
});

test('limpa texto colado', async () => {
  const { cleanChart, MAX_CHART } = await load();
  assert.equal(cleanChart('G\t\tD  \r\n\r\n\r\n\r\nEm C'), 'G        D\n\nEm C');
  assert.equal(cleanChart('x'.repeat(MAX_CHART + 50)).length, MAX_CHART);
});

test('classifica as linhas para a tela', async () => {
  const { classifyLines } = await load();
  const types = classifyLines(CIFRA).map(l => l.type);
  assert.deepEqual(types.slice(0, 8), ['chords', 'chords', 'blank', 'section', 'chords', 'lyrics', 'chords', 'lyrics']);
});

test('nome do tom segue a cifra: bemol em tons de bemol', async () => {
  const { keyName } = await load();
  assert.equal(keyName(8), 'Ab');
  assert.equal(keyName(7), 'G');
  assert.equal(keyName(6), 'F#');
  assert.equal(keyName(2, true), 'D'); // Ré menor usa o bemol de Sib na armadura, mas o nome do tom é D
});

test('cifra com acordes na mesma linha da letra vira acordes em cima', async () => {
  const { cleanChart } = await load();
  assert.equal(cleanChart('[G]Grande é o [D/F#]Senhor'), 'G' + ' '.repeat(10) + 'D/F#\nGrande é o Senhor');
  assert.equal(cleanChart('[Intro]\n[Em] [C]'), '[Intro]\nEm C');
  assert.equal(cleanChart(cleanChart('[G]Oi [C]você')), cleanChart('[G]Oi [C]você')); // repetir não muda
});

test('cifra simplificada tira 7, 9, sus e baixo, e mantém o alinhamento', async () => {
  const { simplifyChart } = await load();
  const out = simplifyChart('G7M  Am7(9)  D/F#  Csus4  Bdim\nLetra');
  assert.equal(out, 'G    Am      D     C      Bm\nLetra');
  // cada acorde continua na mesma coluna de antes
  for (const [chord, was] of [['Am', 'Am7(9)'], ['D', 'D/F#'], ['C', 'Csus4'], ['Bm', 'Bdim']]) {
    assert.equal(out.indexOf(chord), 'G7M  Am7(9)  D/F#  Csus4  Bdim'.indexOf(was));
  }
});

test('capo mostra as formas e sugere o capo que abre os acordes', async () => {
  const { renderChart, suggestCapo } = await load();
  // Ab (tom 8): com capo 4 as formas são em F... com capo 1 as formas são em G
  assert.equal(renderChart('Ab  Db  Eb  Fm', 8, 8, { capo: 1 }), 'G   C   D   Em');
  assert.equal(renderChart('Tom: Ab\nAb  Db', 8, 8, { capo: 1 }), 'Tom: Ab\nG   C');
  assert.equal(suggestCapo('Ab  Db  Eb  Fm', 8, 8), 1);
  assert.equal(suggestCapo('G  C  D  Em', 7, 7), 0);
  assert.equal(renderChart('G  C  D', 7, 9, { capo: 2 }), 'G  C  D'); // A com capo 2 = formas em G
});
