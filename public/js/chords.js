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

function transposeLine(line, semitones, flats) {
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
    const next = found.prefix + formatChord(found.chord, semitones, flats) + found.suffix;
    parts[i] = next;
    // Mantém as colunas: o que o acorde ganha em tamanho sai do espaço seguinte (e vice-versa)
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

/** Transpõe todos os acordes do texto. `flats` escolhe bemóis (Bb) ou sustenidos (A#). */
export function transposeChart(text, semitones, flats = false) {
  const shift = ((semitones % 12) + 12) % 12;
  if (!shift) return String(text || '');
  return String(text || '').split('\n').map(line => (isChordLine(line) ? transposeLine(line, shift, flats) : line)).join('\n');
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

/** Limpa o texto colado: tabs, espaços invisíveis, linhas em branco demais. */
export function cleanChart(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\u00a0\u2007\u202f\u200b\ufeff]/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n').map(l => l.replace(/\s+$/, '')).join('\n')
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
