/**
 * Repertório em texto: ler uma lista colada (ex.: mensagem do WhatsApp) e gerar o texto para compartilhar.
 * Código puro, testado em tests/setlist-text.test.js.
 *
 * Exemplos aceitos:
 *   1. Grande É o Senhor (D)
 *   2) Bondade de Deus - G - 72 bpm
 *   • Santo Espírito [Tom: E]
 *   Ousado Amor – G#m · 68 BPM · 6/8
 *      ↳ Começa só teclado          (linha recuada = anotação da música de cima)
 */

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SOLFEGE = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function toKeyIndex(root, accidental) {
  let base;
  if (/^[A-G]$/.test(root)) base = LETTER[root];
  else base = SOLFEGE[strip(root).toLowerCase()];
  if (base === undefined) return null;
  if (accidental === '#' || accidental === '♯') base += 1;
  if (accidental === 'b' || accidental === '♭') base -= 1;
  return (base + 12) % 12;
}

const ACC = '(#|♯|b|♭)?';
const SOLF = '(D[óo]|R[ée]|Mi|F[áa]|Sol|L[áa]|Si)';
// Tom entre parênteses/colchetes: (D), [Tom: G#m], (Ré)
const KEY_BRACKETS = new RegExp(`[(\\[]\\s*(?:tom\\s*[:\\-]?\\s*)?(?:([A-G])${ACC}|${SOLF}${ACC})\\s*(?:m|menor)?\\s*[)\\]]`, 'i');
// "Tom: G" / "tom G#"
const KEY_LABEL = new RegExp(`\\btom\\s*[:\\-]?\\s*(?:([A-G])${ACC}|${SOLF}${ACC})(?:m|menor)?(?![A-Za-z0-9])`, 'i');
// Depois de um separador: "Título - G", "Título – G#m · 72 BPM"
const KEY_SEPARATOR = new RegExp(`\\s[-–—|]\\s*(?:([A-G])${ACC}|${SOLF}${ACC})(?:m|menor)?\\s*(?=$|[·•|,\\-–—])`);

function findKey(line) {
  for (const re of [KEY_BRACKETS, KEY_LABEL, KEY_SEPARATOR]) {
    const m = line.match(re);
    if (!m) continue;
    // Letras (A–G) só valem em maiúscula, para não confundir com palavras como "a"
    if (m[1] && !/^[A-G]$/.test(m[1])) continue;
    const key = m[1] ? toKeyIndex(m[1], m[2]) : toKeyIndex(m[3], m[4]);
    if (key !== null) return { key, match: m[0] };
  }
  return null;
}

const NUMBERING = /^\s*(?:\d{1,3}\s*[.)\-–—:º°]?|[-–—•*·►>●○✓]+)\s+/u;
// Emojis (sem apagar ♭ ♮ ♯, que ficam no mesmo bloco Unicode)
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{266C}\u{2670}-\u{27BF}]|\u{FE0F}|\u{200D}/gu;
const NOTE_LINE = /^\s{2,}(?:↳|obs\.?:?|nota:?)?\s*|^\s*(?:↳|obs\.?:|nota:)\s*/i;

export function parseSetlistText(text) {
  const songs = [];
  let name = '';
  const lines = String(text || '').replace(/\r/g, '').split('\n');

  for (const raw of lines) {
    if (!raw.trim()) continue;

    // Anotação da música anterior (linha recuada, "↳" ou "obs:")
    if (songs.length && NOTE_LINE.test(raw) && !NUMBERING.test(raw.trimStart() + ' ')) {
      const note = raw.replace(NOTE_LINE, '').replace(EMOJI, '').trim();
      if (note) {
        const prev = songs[songs.length - 1];
        prev.notes = [prev.notes, note].filter(Boolean).join(' · ').slice(0, 140);
      }
      continue;
    }

    let line = raw.replace(EMOJI, ' ').replace(/\s+/g, ' ').trim();

    // *Título do repertório* (negrito do WhatsApp) antes da primeira música
    const bold = line.match(/^\*([^*]+)\*$/);
    if (bold && !songs.length) { name = bold[1].trim().slice(0, 40); continue; }
    if (!songs.length && /^repert[óo]rio\b/i.test(line) && !NUMBERING.test(line + ' ')) {
      name = line.replace(/^repert[óo]rio\s*[:\-–—]?\s*/i, '').trim().slice(0, 40) || name;
      continue;
    }

    line = line.replace(NUMBERING, '').replace(/[*_~]/g, '');

    const song = { title: '', keyIndex: 0 };
    const key = findKey(line);
    if (key) { song.keyIndex = key.key; line = line.replace(key.match, ' '); }

    const bpm = line.match(/(\d{2,3})\s*bpm\b/i);
    if (bpm) { song.bpm = parseInt(bpm[1], 10); line = line.replace(bpm[0], ' '); }

    const sig = line.match(/\b(4\/4|3\/4|6\/8|2\/4)\b/);
    if (sig) { song.timeSig = sig[1]; line = line.replace(sig[0], ' '); }

    song.title = line.replace(/\s*[-–—|·•,:]+\s*$/g, '').replace(/^\s*[-–—|·•,:]+\s*/g, '').replace(/\s{2,}/g, ' ').trim();
    song.title = song.title.replace(/\s*[-–—|·•]\s*$/, '').trim();
    if (song.title.length >= 2) songs.push(song);
  }
  return { name, songs };
}

export function formatSetlistText(listName, songs, labels) {
  const lines = [`*${listName}*`];
  songs.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title} — ${labels[s.keyIndex]} · ${s.bpm} BPM · ${s.timeSig}`);
    if (s.notes) lines.push(`   ↳ ${s.notes}`);
  });
  return lines.join('\n');
}
