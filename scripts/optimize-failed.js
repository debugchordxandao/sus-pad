const fs = require('fs');
const path = require('path');

const LOOPS_FILE = path.join(__dirname, '../public/audio/pad-loops.json');
const loopsData = JSON.parse(fs.readFileSync(LOOPS_FILE, 'utf8'));

const targets = [
  'warm_pad/analog_b',
  'warm_pad/analog_fs',
  'worship/a',
  'worship/as',
  'worship/b',
  'worship/c',
  'worship/cs',
  'worship/ds',
  'worship/e',
  'worship/fs',
  'worship/gs'
];

function test(wavPath, startSec, endSec, fadeSec) {
  const b = fs.readFileSync(wavPath);
  const sr = b.readUInt32LE(24);
  const ch = b.readUInt16LE(22);
  const dataOffset = b.indexOf('data') + 8;
  const numSamples = (b.length - dataOffset) / 2;
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) samples[i] = b.readInt16LE(dataOffset + i * 2) / 32768.0;

  const startF = Math.round(startSec * sr);
  const endF = Math.round(endSec * sr);
  const fadeF = Math.round(fadeSec * sr);
  const loopUnitF = (endF - startF) - fadeF;
  if (loopUnitF <= fadeF) return null;

  const loopBuf = new Float32Array(loopUnitF * ch);

  for (let f = 0; f < fadeF; f++) {
    const t = f / fadeF;
    const gOut = Math.cos(t * Math.PI / 2);
    const gIn = Math.sin(t * Math.PI / 2);
    for (let c = 0; c < ch; c++) {
      loopBuf[f * ch + c] = samples[(endF - fadeF + f) * ch + c] * gOut + samples[(startF + f) * ch + c] * gIn;
    }
  }
  loopBuf.set(samples.subarray((startF + fadeF) * ch, (endF - fadeF) * ch), fadeF * ch);

  let jump = 0;
  for (let c = 0; c < ch; c++) {
    const j = Math.abs(loopBuf[c] - loopBuf[(loopUnitF - 1) * ch + c]);
    if (j > jump) jump = j;
  }

  const winF = Math.round(0.1 * sr);
  let sqBefore = 0;
  for (let f = loopUnitF - winF; f < loopUnitF; f++) {
    for (let c = 0; c < ch; c++) {
      const s = loopBuf[f * ch + c];
      sqBefore += s * s;
    }
  }
  const rmsBefore = Math.sqrt(sqBefore / (winF * ch));

  let sqAfter = 0;
  for (let f = 0; f < winF; f++) {
    for (let c = 0; c < ch; c++) {
      const s = loopBuf[f * ch + c];
      sqAfter += s * s;
    }
  }
  const rmsAfter = Math.sqrt(sqAfter / (winF * ch));
  const dDb = Math.abs(20 * Math.log10(rmsAfter / rmsBefore));
  return { dDb, jump };
}

for (const t of targets) {
  const p = path.join(__dirname, '../_audio_backup_wav/pads', t + '.wav');
  const b = fs.readFileSync(p);
  const sr = b.readUInt32LE(24);
  const ch = b.readUInt16LE(22);
  const dur = ((b.length - (b.indexOf('data') + 8)) / 2 / ch) / sr;

  let best = null;
  const maxEnd = Math.floor(dur - 0.5);
  for (let start = 0.5; start <= 6.0; start += 0.2) {
    for (let end = maxEnd; end >= maxEnd - 5.0; end -= 0.2) {
      for (const fade of [2.0, 2.5, 3.0, 3.5, 4.0]) {
        const r = test(p, start, end, fade);
        if (!r) continue;
        if (r.dDb <= 1.2 && r.jump <= 0.02) {
          if (!best || (r.dDb + r.jump * 10) < (best.dDb + best.jump * 10)) {
            best = { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), fade, ...r };
          }
        }
      }
    }
  }
  if (best) {
    console.log(t, '-> APROVADO! start:', best.start, 'end:', best.end, 'fade:', best.fade, 'dDb:', best.dDb.toFixed(2), 'jump:', best.jump.toFixed(4));
    loopsData[t] = {
      loopStart: best.start,
      loopEnd: best.end,
      crossfade: best.fade
    };
  } else {
    console.log(t, '-> FAIL');
  }
}

fs.writeFileSync(LOOPS_FILE, JSON.stringify(loopsData, null, 2));
fs.writeFileSync(path.join(__dirname, '../audio/pad-loops.json'), JSON.stringify(loopsData, null, 2));
console.log('Saved optimized pad-loops.json!');

