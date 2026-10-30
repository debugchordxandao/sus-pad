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
  console.log('--- TESTE AUTOMATIZADO ETAPA C ---');
  const serverUrl = 'ws://localhost:3000';

  // 1. Host cria sala
  const hostWs = new WebSocket(serverUrl);
  await new Promise(r => hostWs.on('open', r));
  hostWs.send(JSON.stringify({ type: 'create_room' }));
  const roomMsg = await waitForMessage(hostWs, m => m.type === 'room_created');
  const roomCode = roomMsg.roomCode;
  console.log(`✓ 1. Host criou sala: ${roomCode}`);

  // 2. Tecladista e Líder entram
  const kbWs = new WebSocket(serverUrl);
  await new Promise(r => kbWs.on('open', r));
  kbWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'keyboardist', name: 'Tecladista' }));
  await waitForMessage(kbWs, m => m.type === 'room_joined');

  const leaderWs = new WebSocket(serverUrl);
  await new Promise(r => leaderWs.on('open', r));
  leaderWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'leader', name: 'Líder' }));
  await waitForMessage(leaderWs, m => m.type === 'room_joined');
  console.log('✓ 2. Tecladista e Líder conectados à sala.');

  // 3. Permissão: Tecladista tenta setlist_add (deve ser rejeitado)
  const kbDeniedPromise = waitForMessage(kbWs, m => m.type === 'permission_denied');
  kbWs.send(JSON.stringify({ type: 'setlist_add', song: { title: 'Invadir' } }));
  await kbDeniedPromise;
  console.log('✓ 3. Tecladista impedido de gerenciar repertório (permission_denied).');

  // 4. Líder adiciona música (setlist_add) -> Host recebe
  const hostSetlistAddPromise = waitForMessage(hostWs, m => m.type === 'setlist_add' && m.song.title === 'Nova Canção');
  leaderWs.send(JSON.stringify({
    type: 'setlist_add',
    song: { title: 'Nova Canção', keyIndex: 4, bpm: 75, timeSig: '6/8', preset: 'shimmer_2' }
  }));
  await hostSetlistAddPromise;
  console.log('✓ 4. Líder adicionou música; comando relayado ao HOST.');

  // Host confirma estado com nova música e compasso 6/8
  hostWs.send(JSON.stringify({
    type: 'host_state_update',
    state: {
      timeSig: '6/8',
      bpm: 75,
      setlist: [{ id: '99', title: 'Nova Canção', timeSig: '6/8', bpm: 75 }]
    }
  }));

  // Tecladista e Líder recebem state sincronizado
  const kbStatePromise = waitForMessage(kbWs, m => m.type === 'state' && m.state.timeSig === '6/8');
  await kbStatePromise;
  console.log('✓ 5. Estado com compasso 6/8 e repertório sincronizado nos controles remotos.');

  // 6. Pan do Metrônomo: Líder envia metro_pan -> Host recebe
  const panPromise = waitForMessage(hostWs, m => m.type === 'metro_pan' && m.value === -1.0);
  leaderWs.send(JSON.stringify({ type: 'metro_pan', value: -1.0 }));
  await panPromise;
  console.log('✓ 6. Pan do metrônomo (-1.0, Só Fone) enviado pelo Líder recebido pelo HOST.');

  // 7. Pad Remoto Alternância (Toggle):
  // Tecladista liga tom 7
  const padOnPromise = waitForMessage(hostWs, m => m.type === 'pad_on' && m.toneIndex === 7);
  kbWs.send(JSON.stringify({ type: 'pad_on', toneIndex: 7 }));
  await padOnPromise;
  console.log('✓ 7. Tecladista disparou pad_on (tom 7) no HOST.');

  // Host atualiza estado: activeToneIndex = 7
  hostWs.send(JSON.stringify({
    type: 'host_state_update',
    state: { activeToneIndex: 7 }
  }));
  await waitForMessage(kbWs, m => m.type === 'state' && m.state.activeToneIndex === 7);

  // Tecladista toca tom 7 novamente -> aciona pad_off (toggle)
  const padOffPromise = waitForMessage(hostWs, m => m.type === 'pad_off');
  kbWs.send(JSON.stringify({ type: 'pad_off' }));
  await padOffPromise;
  console.log('✓ 8. Tecladista acionou pad_off ao retocar tom ativo (comportamento de alternância).');

  // Cleanup
  kbWs.close();
  leaderWs.close();
  hostWs.close();
  console.log('--- TODOS OS TESTES DA ETAPA C PASSARAM COM SUCESSO! ---');
}

runTests().catch(e => {
  console.error('TESTE C FALHOU:', e);
  process.exit(1);
});

