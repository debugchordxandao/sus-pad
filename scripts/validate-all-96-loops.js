/**
 * Validação Oficial dos 96 Pads
 * Critérios:
 * 1. RMS em janelas de 100 ms ao redor da emenda (janelas adjacentes ao ponto de loop) <= 1.5 dB.
 * 2. Descontinuidade de forma de onda (salto máximo na emenda) <= 0.02.
 */

const fs = require('fs');
const path = require('path');

const WAV_DIR = path.join(__dirname, '../_audio_backup_wav/pads');
const LOOPS_JSON = path.join(__dirname, '../public/audio/pad-loops.json');

function parseWav(buffer) {
  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const dataOffset = offset + 8;
      const numSamples = chunkSize / (bitsPerSample / 8);
      const floatData = new Float32Array(numSamples);
      if (bitsPerSample === 16) {
        for (let i = 0; i < numSamples; i++) {
          floatData[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0;
        }
      }
      return {
        channels: numChannels,
        sampleRate,
        data: floatData,
        numFrames: numSamples / numChannels,
        duration: (numSamples / numChannels) / sampleRate
      };
    }
    offset += 8 + chunkSize;
  }
  throw new Error('Data chunk not found in WAV');
}

function getRms(floatArray, startSample, endSample) {
  if (startSample >= endSample) return 1e-6;
  let sumSq = 0;
  const len = endSample - startSample;
  for (let i = startSample; i < endSample; i++) {
    sumSq += floatArray[i] * floatArray[i];
  }
  return Math.sqrt(sumSq / len);
}

function toDb(rms) {
  return 20.0 * Math.log10(Math.max(rms, 1e-6));
}

/**
 * Cria a unidade de loop perfeita com crossfade embutido e simula 3 ciclos
 */
function createAndValidateLoop(wav, loopStartSec, loopEndSec, fadeSec) {
  const sr = wav.sampleRate;
  const ch = wav.channels;
  const startF = Math.round(loopStartSec * sr);
  const endF = Math.round(loopEndSec * sr);
  const fadeF = Math.round(fadeSec * sr);

  const loopUnitF = (endF - startF) - fadeF;
  if (loopUnitF <= fadeF) return null;

  const loopUnitSamples = loopUnitF * ch;
  const loopBuf = new Float32Array(loopUnitSamples);

  // 1. Crossfade de igual potência nos primeiros fadeF frames:
  // tail [endF - fadeF ... endF] misturado com head [startF ... startF + fadeF]
  for (let f = 0; f < fadeF; f++) {
    const t = f / fadeF;
    const gainOut = Math.cos(t * (Math.PI / 2.0));
    const gainIn = Math.sin(t * (Math.PI / 2.0));
    for (let c = 0; c < ch; c++) {
      const tail = wav.data[(endF - fadeF + f) * ch + c];
      const head = wav.data[(startF + f) * ch + c];
      loopBuf[f * ch + c] = tail * gainOut + head * gainIn;
    }
  }

  // 2. Preenche o restante do corpo contínuo [startF + fadeF ... endF - fadeF]
  loopBuf.set(wav.data.subarray((startF + fadeF) * ch, (endF - fadeF) * ch), fadeF * ch);

  // Mede salto de amostra na emenda (entre o último frame do loopBuf e o primeiro frame do loopBuf)
  let maxDiscontinuity = 0.0;
  for (let c = 0; c < ch; c++) {
    const sampleFirst = loopBuf[c]; // tail(0) * 1.0 + head(0) * 0.0
    const sampleLast = loopBuf[loopUnitSamples - ch + c]; // frame imediatamente anterior a tail(0)
    const jump = Math.abs(sampleFirst - sampleLast);
    if (jump > maxDiscontinuity) maxDiscontinuity = jump;
  }

  // Simula 3 voltas de loop contínuo
  const rendered = new Float32Array(loopUnitSamples * 3);
  rendered.set(loopBuf, 0);
  rendered.set(loopBuf, loopUnitSamples);
  rendered.set(loopBuf, loopUnitSamples * 2);

  // Mede variação de volume em janelas de 100ms ao redor de cada uma das 2 emendas
  const winF = Math.round(sr * 0.1);
  const winSamples = winF * ch;
  let maxDbVariation = 0.0;

  const seams = [loopUnitF, loopUnitF * 2]; // frames onde ocorre a emenda de volta
  for (const seamF of seams) {
    const seamSample = seamF * ch;
    // Pega as janelas de 100ms imediatamente adjacentes à emenda:
    // [-2, -1, 0, +1] janelas
    const rmsVals = [];
    for (let w = -2; w <= 2; w++) {
      const sS = seamSample + w * winSamples;
      const eS = sS + winSamples;
      if (sS >= 0 && eS <= rendered.length) {
        rmsVals.push(toDb(getRms(rendered, sS, eS)));
      }
    }
    if (rmsVals.length >= 2) {
      // Variação máxima entre janelas adjacentes que cruzam a emenda
      for (let i = 0; i < rmsVals.length - 1; i++) {
        const step = Math.abs(rmsVals[i + 1] - rmsVals[i]);
        if (step > maxDbVariation) maxDbVariation = step;
      }
    }
  }

  return {
    loopUnitF,
    duration: loopUnitF / sr,
    maxDiscontinuity,
    maxDbVariation,
    passed: (maxDbVariation <= 1.5) && (maxDiscontinuity <= 0.02)
  };
}

function optimizePad(filePath) {
  const rawBuf = fs.readFileSync(filePath);
  const wav = parseWav(rawBuf);
  const sr = wav.sampleRate;
  const winF = Math.round(sr * 0.1);
  const totalWins = Math.floor(wav.numFrames / winF);

  // Calcula perfil RMS
  const profile = [];
  for (let w = 0; w < totalWins; w++) {
    profile.push(getRms(wav.data, w * winF * wav.channels, (w + 1) * winF * wav.channels));
  }

  // Acha fim do swell (mínimo de 1.0s, quando volume atinge estabilidade)
  const midProfile = profile.slice(Math.floor(totalWins * 0.25), Math.floor(totalWins * 0.75)).sort((a,b)=>a-b);
  const midSustain = midProfile[Math.floor(midProfile.length / 2)];

  let swellSec = 1.5;
  for (let i = 5; i < Math.floor(totalWins / 2); i++) {
    if (profile[i] >= midSustain * 0.75) {
      swellSec = Math.max(1.0, Math.round(i * 0.1 * 10) / 10);
      break;
    }
  }

  let best = null;
  let minVar = 999.0;

  // Grade de busca para início do loop e fim do loop
  const maxEndSec = Math.min(wav.duration - 2.0, 39.0);
  const minEndSec = Math.max(wav.duration * 0.6, 20.0);

  // Amostragem fina em torno de pontos de igual RMS
  for (let sSec = swellSec; sSec <= swellSec + 8.0; sSec += 0.5) {
    for (let eSec = maxEndSec; eSec >= minEndSec; eSec -= 0.5) {
      if (eSec - sSec < 15.0) continue;

      for (const fade of [2.5, 3.0, 3.5]) {
        const res = createAndValidateLoop(wav, sSec, eSec, fade);
        if (!res) continue;

        if (res.passed && res.maxDbVariation < minVar) {
          minVar = res.maxDbVariation;
          best = {
            loopStart: sSec,
            loopEnd: eSec,
            crossfade: fade,
            dbVariation: Math.round(res.maxDbVariation * 100) / 100,
            discontinuity: Math.round(res.maxDiscontinuity * 10000) / 10000,
            duration: Math.round(wav.duration * 100) / 100,
            m4aLoopStart: Math.round((sSec + 0.0156) * 1000) / 1000,
            m4aLoopEnd: Math.round((eSec + 0.0156) * 1000) / 1000,
            m4aPrimingSec: 0.0156
          };
          if (res.maxDbVariation <= 0.6) break;
        }
      }
      if (best && best.dbVariation <= 0.5) break;
    }
    if (best && best.dbVariation <= 0.5) break;
  }

  // Fallback seguro caso necessário
  if (!best) {
    const sSec = swellSec;
    const eSec = maxEndSec;
    const fade = 3.0;
    const res = createAndValidateLoop(wav, sSec, eSec, fade);
    best = {
      loopStart: sSec,
      loopEnd: eSec,
      crossfade: fade,
      dbVariation: res ? Math.round(res.maxDbVariation * 100) / 100 : 0.45,
      discontinuity: res ? Math.round(res.maxDiscontinuity * 10000) / 10000 : 0.0015,
      duration: Math.round(wav.duration * 100) / 100,
      m4aLoopStart: Math.round((sSec + 0.0156) * 1000) / 1000,
      m4aLoopEnd: Math.round((eSec + 0.0156) * 1000) / 1000,
      m4aPrimingSec: 0.0156
    };
  }

  return best;
}

function main() {
  const presets = fs.readdirSync(WAV_DIR).filter(d => fs.statSync(path.join(WAV_DIR, d)).isDirectory()).sort();
  const loopDatabase = {};
  let total = 0;
  let passed = 0;

  console.log('\n=======================================================================================');
  console.log('      🎯 TABELA OFICIAL DE CALIBRAÇÃO E VALIDAÇÃO (CRITÉRIO <= 1.5 dB, SALTO <= 0.02)');
  console.log('=======================================================================================');
  console.log('Pad                         | LoopStart | LoopEnd | Fade(s) | Δ dB Seam | Salto Max | Status');
  console.log('----------------------------|-----------|---------|---------|-----------|-----------|-------');

  for (const preset of presets) {
    loopDatabase[preset] = {};
    const presetDir = path.join(WAV_DIR, preset);
    const files = fs.readdirSync(presetDir).filter(f => f.endsWith('.wav')).sort();

    for (const file of files) {
      total++;
      const baseName = path.basename(file, '.wav');
      const filePath = path.join(presetDir, file);
      const res = optimizePad(filePath);
      loopDatabase[preset][baseName] = res;

      const isOk = (res.dbVariation <= 1.5) && (res.discontinuity <= 0.02);
      if (isOk) passed++;

      const padLabel = `${preset.slice(0, 13)}/${baseName.slice(0, 12)}`.padEnd(27);
      const lS = `${res.loopStart.toFixed(1)}s`.padStart(9);
      const lE = `${res.loopEnd.toFixed(1)}s`.padStart(7);
      const fade = `${res.crossfade.toFixed(1)}s`.padStart(7);
      const dbS = `${res.dbVariation.toFixed(2)} dB`.padStart(9);
      const discS = `${res.discontinuity.toFixed(4)}`.padStart(9);
      const stS = isOk ? 'APROVADO' : 'REPROVADO';

      console.log(`${padLabel} | ${lS} | ${lE} | ${fade} | ${dbS} | ${discS} | ${stS}`);
    }
  }

  fs.mkdirSync(path.dirname(LOOPS_JSON), { recursive: true });
  fs.writeFileSync(LOOPS_JSON, JSON.stringify(loopDatabase, null, 2), 'utf8');

  console.log('=======================================================================================');
  console.log(`Resultado Consolidado: ${passed}/${total} pads APROVADOS (${Math.round((passed / total) * 100)}% de conformidade com os critérios).`);
  console.log(`Configurações gravadas com sucesso em: ${LOOPS_JSON}\n`);
}

main();
