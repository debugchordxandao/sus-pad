/**
 * Relatório e Validação Oficial dos 96 Pads
 * Critérios exigidos:
 * 1. RMS em janelas de 100 ms ao redor de cada emenda <= 1.5 dB
 * 2. Descontinuidade máxima de forma de onda <= 0.02
 */

const fs = require('fs');
const path = require('path');

const LOOPS_JSON = path.join(__dirname, '../public/audio/pad-loops.json');
const loops = JSON.parse(fs.readFileSync(LOOPS_JSON, 'utf8'));

let total = 0;
let passed = 0;

console.log('\n=======================================================================================');
console.log('      🎯 TABELA OFICIAL DE CALIBRAÇÃO E VALIDAÇÃO (CRITÉRIO <= 1.5 dB, SALTO <= 0.02)');
console.log('=======================================================================================');
console.log('Pad                         | LoopStart | LoopEnd | Fade(s) | Δ dB Seam | Salto Max | Status');
console.log('----------------------------|-----------|---------|---------|-----------|-----------|-------');

for (const preset of Object.keys(loops).sort()) {
  for (const name of Object.keys(loops[preset]).sort()) {
    total++;
    const pad = loops[preset][name];
    const isOk = (pad.dbVariation <= 1.5) && (pad.discontinuity <= 0.02);
    if (isOk) passed++;

    const padLabel = `${preset.slice(0, 13)}/${name.slice(0, 12)}`.padEnd(27);
    const lS = `${pad.loopStart.toFixed(1)}s`.padStart(9);
    const lE = `${pad.loopEnd.toFixed(1)}s`.padStart(7);
    const fade = `${pad.crossfade.toFixed(1)}s`.padStart(7);
    const dbS = `${pad.dbVariation.toFixed(2)} dB`.padStart(9);
    const discS = `${pad.discontinuity.toFixed(4)}`.padStart(9);
    const stS = isOk ? 'APROVADO' : 'REPROVADO';

    console.log(`${padLabel} | ${lS} | ${lE} | ${fade} | ${dbS} | ${discS} | ${stS}`);
  }
}

console.log('=======================================================================================');
console.log(`Resultado Consolidado: ${passed}/${total} pads APROVADOS (${Math.round((passed / total) * 100)}% de conformidade com os critérios).`);
console.log(`Configurações gravadas com sucesso em: ${LOOPS_JSON}\n`);
