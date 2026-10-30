const WebSocket = require('ws');

async function runTests() {
  console.log('--- TESTE AUTOMATIZADO ETAPA A ---');
  const serverUrl = 'ws://localhost:3000';

  // 1. Host cria sala
  const hostWs = new WebSocket(serverUrl);
  let roomCode = null;
  let hostToken = null;

  await new Promise((resolve) => {
    hostWs.on('open', () => {
      hostWs.send(JSON.stringify({ type: 'create_room' }));
    });
    hostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        hostToken = msg.hostToken;
        console.log(`✓ 1. Host criou sala com sucesso: Código=${roomCode}, Token=${hostToken ? 'OK' : 'FALHA'}`);
        resolve();
      }
    });
  });

  if (!roomCode || !hostToken) {
    throw new Error('Falha ao criar sala com token!');
  }

  // 2. Tentar join_room com papel 'host' (DEVE SER REJEITADO)
  const fakeHostWs = new WebSocket(serverUrl);
  await new Promise((resolve) => {
    fakeHostWs.on('open', () => {
      fakeHostWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'host' }));
    });
    fakeHostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'error' && msg.message.includes('Papel inválido')) {
        console.log('✓ 2. Tentativa de invadir como "host" via join_room foi rejeitada com sucesso!');
        fakeHostWs.close();
        resolve();
      }
    });
  });

  // 3. Tecladista entra e tenta comando proibido (metro)
  const kbWs = new WebSocket(serverUrl);
  await new Promise((resolve) => {
    kbWs.on('open', () => {
      kbWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'keyboardist', name: 'Tecladista Teste' }));
    });
    kbWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_joined') {
        console.log('✓ 3. Tecladista entrou na sala.');
        // Tenta comando proibido (metro)
        kbWs.send(JSON.stringify({ type: 'metro', action: 'start' }));
      }
      if (msg.type === 'permission_denied') {
        console.log('✓ 4. Tecladista foi impedido de ligar metrônomo (permission_denied retornado).');
        resolve();
      }
    });
  });

  // 4. Líder entra e tenta enviar host_state_update (DEVE SER REJEITADO)
  const leaderWs = new WebSocket(serverUrl);
  await new Promise((resolve) => {
    leaderWs.on('open', () => {
      leaderWs.send(JSON.stringify({ type: 'join_room', roomCode, role: 'leader', name: 'Líder Teste' }));
    });
    leaderWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_joined') {
        console.log('✓ 5. Líder entrou na sala.');
        leaderWs.send(JSON.stringify({ type: 'host_state_update', state: { bpm: 200 } }));
      }
      if (msg.type === 'permission_denied') {
        console.log('✓ 6. Líder impedido de falsificar host_state_update (permission_denied retornado).');
        resolve();
      }
    });
  });

  // 5. Líder envia comando permitido (bpm: 140) -> Host deve receber
  await new Promise((resolve) => {
    hostWs.once('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'bpm' && msg.value === 140) {
        console.log('✓ 7. Comando de BPM do Líder relayado com sucesso para o HOST.');
        resolve();
      }
    });
    leaderWs.send(JSON.stringify({ type: 'bpm', value: 140 }));
  });

  // 6. Host fecha socket (simulando queda) -> Tecladista deve receber host_disconnected
  await new Promise((resolve) => {
    kbWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'host_disconnected') {
        console.log('✓ 8. Notificação host_disconnected recebida pelos clientes.');
        resolve();
      }
    });
    hostWs.close();
  });

  // 7. Host reconecta na mesma sala com o hostToken
  const newHostWs = new WebSocket(serverUrl);
  await new Promise((resolve) => {
    newHostWs.on('open', () => {
      newHostWs.send(JSON.stringify({
        type: 'reconnect_host',
        roomCode,
        hostToken
      }));
    });
    newHostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_reconnected') {
        console.log('✓ 9. Host reassumiu a mesma sala com sucesso usando hostToken.');
        resolve();
      }
    });
  });

  // Cleanup
  kbWs.close();
  leaderWs.close();
  newHostWs.close();
  console.log('--- TODOS OS TESTES DA ETAPA A PASSARAM COM SUCESSO! ---');
}

runTests().catch((e) => {
  console.error('TESTE FALHOU:', e);
  process.exit(1);
});

