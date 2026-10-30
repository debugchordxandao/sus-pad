const WebSocket = require('ws');

function waitForMessage(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timeout waiting for message matching predicate`));
    }, timeoutMs);

    function onMsg(raw) {
      try {
        const msg = JSON.parse(raw);
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(msg);
        }
      } catch (e) {}
    }

    ws.on('message', onMsg);
  });
}

async function runTests() {
  console.log('--- TESTE AUTOMATIZADO ETAPA B ---');
  const serverUrl = 'ws://localhost:3000';

  // 1. Host cria sala
  const hostWs = new WebSocket(serverUrl);
  let roomCode = null;

  await new Promise((resolve) => hostWs.on('open', resolve));
  hostWs.send(JSON.stringify({ type: 'create_room' }));
  const roomCreated = await waitForMessage(hostWs, m => m.type === 'room_created');
  roomCode = roomCreated.roomCode;
  console.log(`✓ 1. Host criou sala: ${roomCode}`);

  // 2. Tecladista entra
  const kbWs = new WebSocket(serverUrl);
  await new Promise((resolve) => kbWs.on('open', resolve));
  kbWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'keyboardist', name: 'Teclado' }));
  await waitForMessage(kbWs, m => m.type === 'room_joined');
  console.log('✓ 2. Tecladista entrou na sala.');

  // 3. Baterista entra
  const drumWs = new WebSocket(serverUrl);
  await new Promise((resolve) => drumWs.on('open', resolve));
  drumWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'drummer', name: 'Bateria' }));
  await waitForMessage(drumWs, m => m.type === 'room_joined');
  console.log('✓ 3. Baterista entrou na sala.');

  // 4. Líder entra
  const leaderWs = new WebSocket(serverUrl);
  await new Promise((resolve) => leaderWs.on('open', resolve));
  leaderWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'leader', name: 'Líder' }));
  await waitForMessage(leaderWs, m => m.type === 'room_joined');
  console.log('✓ 4. Líder entrou na sala.');

  // 5. Teste do Botão PÂNICO: Líder envia panic -> Host recebe
  const panicPromise = waitForMessage(hostWs, m => m.type === 'panic');
  leaderWs.send(JSON.stringify({ type: 'panic' }));
  await panicPromise;
  console.log('✓ 5. Comando PÂNICO enviado pelo Líder recebido pelo HOST.');

  // 6. Teste de Permissão de Volume:
  // Tecladista ajusta volume do PAD (Permitido)
  const kbVolPromise = waitForMessage(hostWs, m => m.type === 'volume' && m.target === 'pad' && m.value === 75);
  kbWs.send(JSON.stringify({ type: 'volume', target: 'pad', value: 75 }));
  await kbVolPromise;
  console.log('✓ 6. Tecladista ajustou volume do PAD com sucesso (recebido no HOST).');

  // Tecladista tenta ajustar volume da BATERIA (Proibido -> permission_denied)
  const kbDeniedPromise = waitForMessage(kbWs, m => m.type === 'permission_denied');
  kbWs.send(JSON.stringify({ type: 'volume', target: 'drums', value: 50 }));
  await kbDeniedPromise;
  console.log('✓ 7. Tecladista impedido de alterar volume da bateria (permission_denied recebido).');

  // Baterista ajusta volume da BATERIA (Permitido)
  const drumVolPromise = waitForMessage(hostWs, m => m.type === 'volume' && m.target === 'drums' && m.value === 95);
  drumWs.send(JSON.stringify({ type: 'volume', target: 'drums', value: 95 }));
  await drumVolPromise;
  console.log('✓ 8. Baterista ajustou volume da BATERIA com sucesso (recebido no HOST).');

  // Baterista tenta alterar volume do PAD (Proibido -> permission_denied)
  const drumDeniedPromise = waitForMessage(drumWs, m => m.type === 'permission_denied');
  drumWs.send(JSON.stringify({ type: 'volume', target: 'pad', value: 50 }));
  await drumDeniedPromise;
  console.log('✓ 9. Baterista impedido de alterar volume do pad (permission_denied recebido).');

  // Líder ajusta volume MASTER (Permitido)
  const masterVolPromise = waitForMessage(hostWs, m => m.type === 'volume' && m.target === 'master' && m.value === 88);
  leaderWs.send(JSON.stringify({ type: 'volume', target: 'master', value: 88 }));
  await masterVolPromise;
  console.log('✓ 10. Líder alterou volume MASTER com sucesso (recebido no HOST).');

  // 7. Ping / Pong e Medição de Latência com Members Update
  const pingPromise = waitForMessage(hostWs, m => m.type === 'members_update' && m.members.some(mem => mem.name === 'Teclado' && mem.latency === 15));
  kbWs.send(JSON.stringify({ type: 'ping', clientTime: 12345, measuredLatency: 15 }));
  await pingPromise;
  console.log('✓ 11. Latência do Tecladista (15 ms) sincronizada em members_update para todos.');

  // Cleanup
  kbWs.close();
  drumWs.close();
  leaderWs.close();
  hostWs.close();
  console.log('--- TODOS OS TESTES DA ETAPA B PASSARAM COM SUCESSO! ---');
}

runTests().catch((e) => {
  console.error('TESTE B FALHOU:', e);
  process.exit(1);
});
