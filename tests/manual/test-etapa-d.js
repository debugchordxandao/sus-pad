const http = require('http');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- TESTE AUTOMATIZADO ETAPA D ---');

  // 1. Verificar Service Worker
  const swRes = await get('http://localhost:3000/sw.js');
  if (swRes.status !== 200 || !swRes.data.includes('padstudio-live-v3')) {
    throw new Error('Service Worker falhou ou versão incorreta!');
  }
  console.log('✓ 1. Service Worker /sw.js ativo com cache versionado (padstudio-live-v3).');

  // 2. Verificar /api/server-info
  const infoRes = await get('http://localhost:3000/api/server-info');
  const info = JSON.parse(infoRes.data);
  if (!info.ips || !info.port || !info.protocol) {
    throw new Error('Endpoint /api/server-info incompleto!');
  }
  console.log(`✓ 2. /api/server-info funcionando: IP LAN=${info.ips[0]?.address}, Porta=${info.port}, Protocolo=${info.protocol}.`);

  // 3. Verificar pasta _antigo/
  const antigoDir = path.join(__dirname, '_antigo');
  const files = fs.readdirSync(antigoDir);
  const expectedFiles = [
    'app.js', 'audio-engine.js', 'index.html', 'styles.css',
    'setlist.js', 'midi.js', 'manifest.json', 'pad-manifest.json'
  ];
  for (const f of expectedFiles) {
    if (!files.includes(f)) throw new Error(`Arquivo ${f} faltando em _antigo/`);
  }
  console.log(`✓ 3. Pasta _antigo/ criada com todos os 8 arquivos duplicados arquivados.`);

  // 4. Verificar package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  if (!pkg.description || !pkg.author) {
    throw new Error('package.json sem description ou author!');
  }
  console.log(`✓ 4. package.json atualizado: Description="${pkg.description}", Author="${pkg.author}".`);

  // 5. Verificar limpeza de buffers no audio-engine.js
  const engineCode = fs.readFileSync(path.join(__dirname, 'public/audio-engine.js'), 'utf8');
  if (!engineCode.includes('delete this.audioBufferCache[url]')) {
    throw new Error('audio-engine.js não possui liberação de cache de buffers!');
  }
  console.log('✓ 5. audio-engine.js configurado para liberar buffers do timbre anterior ao trocar de timbre.');

  console.log('--- TODOS OS TESTES DA ETAPA D PASSARAM COM SUCESSO! ---');
}

runTests().catch(e => {
  console.error('TESTE D FALHOU:', e);
  process.exit(1);
});

