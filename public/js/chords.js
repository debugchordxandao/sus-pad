/**
 * Cifras: reconhecer acordes num texto colado (ex.: do Cifra Club) e transpor para outro tom.
 * Código puro, sem DOM: roda no navegador e nos testes do Node (tests/chords.test.js).
 *
 * Só as linhas formadas por acordes são alteradas; letras, [Seções] e tablaturas ficam como estão.
 * Ao trocar "Em" por "F#m" o espaço seguinte encolhe um caractere, e os acordes continuam
 * alinhados com a sílaba da letra.
 */

export const MAX_CHART = 8000;

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Tons maiores que se escrevem com bemóis (F, Bb, Eb, Ab, Db)
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1]);

const ACC = '[#b♯♭]?';
// Depois da nota: m, maj, 7, 9, sus4, add9, dim, º, (b5)... Letras de palavras comuns ("Amor", "Alegria") não passam.
const QUALITY = '(?:maj|min|dim|aug|sus|add|m|M|º|°|ø|\\+|-|\\d+|[#b♯♭]\\d+|\\([^)\\s]*\\))*';
const CHORD = new RegExp(`^([A-G])(${ACC})(${QUALITY})(?:/([A-G])(${ACC}))?$`);

function rootIndex(letter, acc) {
  let n = LETTER[letter];
  if (acc === '#' || acc === '♯') n += 1;
  if (acc === 'b' || acc === '♭') n -= 1;
  return (n + 12) % 12;
}

/** Lê um acorde ("F#m7/C#"). Devolve null se o texto não for um acorde. */
export function parseChord(token) {
  const m = CHORD.exec(token);
  if (!m) return null;
  return {
    root: rootIndex(m[1], m[2]),
    quality: m[3],
    bass: m[4] ? rootIndex(m[4], m[5]) : null
  };
}

/** Escreve o acorde com a nota nova (nome com # ou b). */
export function formatChord(chord, semitones, flats) {
  const names = flats ? FLAT : SHARP;
  const root = names[(chord.root + semitones + 120) % 12];
  const bass = chord.bass === null ? '' : `/${names[(chord.bass + semitones + 120) % 12]}`;
  return `${root}${chord.quality}${bass}`;
}

/** Nome do tom como na cifra: "Ab" em tons de bemol, "G#" nos outros. */
export function keyName(keyIndex, minor = false) {
  return (flatsFor(keyIndex, minor) ? FLAT : SHARP)[keyIndex];
}

/** Tons com bemol (F, Sib, Mib...) escrevem F, Bb, Eb; os demais usam sustenidos. */
export function flatsFor(keyIndex, minor = false) {
  return FLAT_MAJORS.has(minor ? (keyIndex + 3) % 12 : keyIndex);
}

const FILLER = [
  /^[|\-–—/\\.~%*()>:]+$/,
  /^\(?(?:x\d+|\d+x)\)?$/i,
  /^n\.?c\.?$/i
];
const isFiller = (t) => FILLER.some(re => re.test(t));
// "[Intro]" ou "Refrão:" no começo da linha de acordes
const isLabel = (t) => /^\[[^\]]*\]$/.test(t) || /^[A-Za-zÀ-ú]+:$/.test(t);

/** Tenta ler o token como acorde, aceitando parênteses ou colchetes em volta: (G) [Em]. */
function chordInToken(token) {
  const direct = parseChord(token);
  if (direct) return { prefix: '', chord: direct, suffix: '' };
  const lead = token.match(/^[([]+/)?.[0] ?? '';
  let body = token.slice(lead.length);
  let trail = '';
  while (body && /[)\],.:;!]$/.test(body)) {
    trail = body.slice(-1) + trail;
    body = body.slice(0, -1);
    const chord = parseChord(body);
    if (chord) return { prefix: lead, chord, suffix: trail };
  }
  const chord = parseChord(body);
  return chord ? { prefix: lead, chord, suffix: trail } : null;
}

/** Linha de acordes: todos os "pedaços" são acordes (ou separadores como | e x2) e há pelo menos um acorde. */
export function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length > 1 && isLabel(tokens[0])) tokens.shift();
  let chords = 0;
  for (const t of tokens) {
    if (chordInToken(t)) chords += 1;
    else if (!isFiller(t)) return false;
  }
  return chords > 0;
}

const isSection = (line) => /^\s*\[[^\]]+\]\s*$/.test(line) || /^\s*[A-Za-zÀ-ú ]{2,24}:\s*$/.test(line);

/** Separa o texto em linhas já classificadas, para a tela pintar acordes e letras de formas diferentes. */
export function classifyLines(text) {
  return String(text || '').split('\n').map(line => {
    if (!line.trim()) return { text: '', type: 'blank' };
    if (isChordLine(line)) return { text: line, type: 'chords' };
    if (isSection(line)) return { text: line.trim(), type: 'section' };
    return { text: line, type: 'lyrics' };
  });
}

/** Aplica `fn(chord)` a cada acorde da linha e mantém as colunas alinhadas com a letra. */
function mapChordLine(line, fn) {
  const parts = line.match(/\s+|\S+/g) || [];
  let first = true;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\s/.test(part)) continue;
    const wasFirst = first;
    first = false;
    if (wasFirst && isLabel(part) && parts.length > 1) continue;
    const found = chordInToken(part);
    if (!found) continue;
    const next = found.prefix + fn(found.chord) + found.suffix;
    parts[i] = next;
    // O que o acorde ganha em tamanho sai do espaço seguinte (e vice-versa)
    const diff = next.length - part.length;
    const gap = parts[i + 1];
    if (diff && gap && /^\s+$/.test(gap)) {
      parts[i + 1] = diff > 0
        ? gap.slice(0, Math.max(1, gap.length - diff))
        : gap + ' '.repeat(-diff);
    }
  }
  return parts.join('');
}

function mapChords(text, fn) {
  return String(text || '').split('\n').map(line => (isChordLine(line) ? mapChordLine(line, fn) : line)).join('\n');
}

/** Transpõe todos os acordes do texto. `flats` escolhe bemóis (Bb) ou sustenidos (A#). */
export function transposeChart(text, semitones, flats = false) {
  const shift = ((semitones % 12) + 12) % 12;
  if (!shift) return String(text || '');
  return mapChords(text, chord => formatChord(chord, shift, flats));
}

/** Tom da cifra: "Tom: G" no cabeçalho ou, se não houver, o primeiro acorde. */
export function detectKey(text) {
  const src = String(text || '');
  const header = src.match(/\bTom\s*:\s*([A-G])([#b♯♭]?)(m(?!aj)|\b|(?![A-Za-z]))/i);
  if (header && /^[A-G]$/.test(header[1])) {
    return { key: rootIndex(header[1], header[2]), minor: header[3].toLowerCase().startsWith('m') };
  }
  for (const line of src.split('\n')) {
    if (!isChordLine(line)) continue;
    const token = line.trim().split(/\s+/).find(t => chordInToken(t));
    const found = chordInToken(token);
    return { key: found.chord.root, minor: /^(m(?!aj)|min)/.test(found.chord.quality) };
  }
  return null;
}

const isMinor = (chord) => /^(m(?!aj)|min|dim)/.test(chord.quality);

/** Cifra simplificada: só tríades (G, Am), sem 7, 9, sus nem baixo invertido. */
export function simplifyChart(text, flats = false) {
  return mapChords(text, chord => formatChord({ root: chord.root, quality: isMinor(chord) ? 'm' : '', bass: null }, 0, flats));
}

function chordsOf(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (/^\s*tom\s*:/i.test(line) || !isChordLine(line)) continue;
    for (const token of line.trim().split(/\s+/)) {
      const found = chordInToken(token);
      if (found) out.push(found.chord);
    }
  }
  return out;
}

// Formas "de corda solta" mais fáceis: C D E G A, Am Em Dm
const OPEN_MAJOR = new Set([0, 2, 4, 7, 9]);
const OPEN_MINOR = new Set([9, 4, 2]);

/** Qual capotraste deixa a maioria dos acordes em formas abertas (0 = sem capo). */
export function suggestCapo(text, chartKey, songKey, simple = false) {
  const shown = chartForKey(text, chartKey, songKey);
  const chords = chordsOf(simple ? simplifyChart(shown) : shown);
  if (!chords.length) return 0;
  let best = 0;
  let bestScore = -1;
  for (let capo = 0; capo <= 7; capo += 1) {
    const score = chords.reduce((n, c) => {
      const root = (c.root - capo + 120) % 12;
      return n + ((isMinor(c) ? OPEN_MINOR : OPEN_MAJOR).has(root) ? 1 : 0);
    }, 0);
    if (score > bestScore) { best = capo; bestScore = score; }
  }
  return best;
}

/** Cifra pronta para tocar: no tom da música, opcionalmente simplificada e com as formas do capo. */
export function renderChart(text, chartKey, songKey, { capo = 0, simple = false } = {}) {
  const minor = !!detectKey(text)?.minor;
  const flats = flatsFor(songKey, minor);
  let out = chartForKey(text, chartKey, songKey);
  if (simple) out = simplifyChart(out, flats);
  if (capo) {
    const shapes = transposeChart(out, -capo, flatsFor((songKey - capo + 120) % 12, minor));
    // O cabeçalho "Tom: G" continua mostrando o tom real da música
    const real = out.split('\n');
    out = shapes.split('\n').map((line, i) => (/^\s*tom\s*:/i.test(real[i]) ? real[i] : line)).join('\n');
  }
  return out;
}

/** "[G]Grande é o [D]Senhor" vira a linha de acordes em cima da letra. */
function convertInline(line) {
  const parts = line.split(/(\[[^\]\s]+\])/);
  if (!parts.some(p => /^\[[^\]\s]+\]$/.test(p) && parseChord(p.slice(1, -1)))) return [line];
  let lyric = '';
  let chords = '';
  for (const part of parts) {
    const m = /^\[([^\]\s]+)\]$/.exec(part);
    if (m && parseChord(m[1])) {
      let col = lyric.length;
      if (chords && chords.length >= col) col = chords.length + 1;
      chords = chords.padEnd(col, ' ') + m[1];
    } else {
      lyric += part;
    }
  }
  return lyric.trim() ? [chords, lyric.replace(/\s+$/, '')] : [chords];
}

/** Limpa o texto colado: tabs, espaços invisíveis, linhas em branco demais. */
export function cleanChart(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\u00a0\u2007\u202f\u200b\ufeff]/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n').map(l => l.replace(/\s+$/, '')).flatMap(convertInline).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHART);
}

/** Cifra pronta para mostrar no tom da música. */
export function chartForKey(text, chartKey, songKey) {
  const shift = ((songKey - chartKey) % 12 + 12) % 12;
  const detected = detectKey(text);
  return transposeChart(text, shift, flatsFor(songKey, !!detected?.minor));
}
