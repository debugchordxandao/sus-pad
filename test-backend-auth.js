const WebSocket = require('ws');

async function testBackend() {
  console.log('--- TESTE AUTOMATIZADO BACKEND & AUTENTICAÇÃO ---');
  const baseUrl = 'http://localhost:3000';
  const serverWs = 'ws://localhost:3000';

  // 1. Registro de Usuário / Banda
  const testEmail = `banda_${Date.now()}@teste.com`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: 'senhaSegura123',
      name: 'Ministério Louvor Teste',
      bandName: 'Banda Rocha Viva'
    })
  });

  const regData = await regRes.json();
  if (regRes.status !== 201 || !regData.token) {
    throw new Error('Falha no registro: ' + JSON.stringify(regData));
  }
  console.log(`✓ 1. Registro com hash bcrypt e geração de JWT: Usuário=${regData.user.name}, Token=${regData.token ? 'OK' : 'FALHA'}`);
  const authToken = regData.token;

  // 2. Tentar registrar mesmo e-mail (deve retornar 409)
  const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'senhaSegura123' })
  });
  if (dupRes.status !== 409) {
    throw new Error('Falha: Deveria rejeitar e-mail duplicado');
  }
  console.log('✓ 2. Prevenção de e-mail duplicado validada (409 Conflict).');

  // 3. Login com senha
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'senhaSegura123' })
  });
  const loginData = await loginRes.json();
  if (loginRes.status !== 200 || !loginData.token) {
    throw new Error('Falha no login: ' + JSON.stringify(loginData));
  }
  console.log('✓ 3. Login com validação de senha e emissão de JWT bem-sucedido.');

  // 4. Perfil /me com JWT
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const meData = await meRes.json();
  if (meRes.status !== 200 || meData.user.email !== testEmail) {
    throw new Error('Falha no /api/auth/me');
  }
  console.log(`✓ 4. Endpoint protegido /api/auth/me retornou perfil da banda: ${meData.user.bandName}.`);

  // 5. Host cria sala protegida por PIN via WebSocket
  const hostWs = new WebSocket(serverWs);
  let roomCode = null;
  await new Promise((resolve) => hostWs.on('open', resolve));

  const roomCreatedPromise = new Promise((resolve) => {
    hostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        resolve(msg);
      }
    });
  });

  hostWs.send(JSON.stringify({
    type: 'create_room',
    roomPin: '5544',
    leaderPin: '9988'
  }));

  const roomMsg = await roomCreatedPromise;
  console.log(`✓ 5. Sala criada com proteção: Código=${roomCode}, hasRoomPin=${roomMsg.hasRoomPin}, hasLeaderPin=${roomMsg.hasLeaderPin}`);

  // 6. Controle tenta entrar com PIN errado (deve ser rejeitado)
  const fakeWs = new WebSocket(serverWs);
  await new Promise((resolve) => fakeWs.on('open', resolve));
  const pinFailPromise = new Promise((resolve) => {
    fakeWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'error' && msg.message.includes('PIN')) {
        resolve(msg);
      }
    });
  });
  fakeWs.send(JSON.stringify({
    type: 'join_room',
    roomCode,
    role: 'keyboardist',
    pin: '0000'
  }));
  await pinFailPromise;
  console.log('✓ 6. Tentativa com PIN errado foi barrada pelo servidor.');
  fakeWs.close();

  // 7. Controle entra com PIN correto
  const validWs = new WebSocket(serverWs);
  await new Promise((resolve) => validWs.on('open', resolve));
  const joinSuccessPromise = new Promise((resolve) => {
    validWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_joined') resolve(msg);
    });
  });
  validWs.send(JSON.stringify({
    type: 'join_room',
    roomCode,
    role: 'keyboardist',
    pin: '5544'
  }));
  await joinSuccessPromise;
  console.log('✓ 7. Tecladista autenticado com PIN correto e conectado à sala.');

  // 8. Líder tenta entrar com PIN da sala mas sem o PIN do Líder (deve ser rejeitado)
  const fakeLeaderWs = new WebSocket(serverWs);
  await new Promise((resolve) => fakeLeaderWs.on('open', resolve));
  const leaderFailPromise = new Promise((resolve) => {
    fakeLeaderWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'error' && msg.message.includes('PIN')) {
        resolve(msg);
      }
    });
  });
  fakeLeaderWs.send(JSON.stringify({
    type: 'join_room',
    roomCode,
    role: 'leader',
    pin: '5544' // PIN da sala, mas líder exige '9988'
  }));
  await leaderFailPromise;
  console.log('✓ 8. Tentativa de assumir Líder sem o PIN de Líder foi bloqueada.');
  fakeLeaderWs.close();

  // 9. Líder entra com PIN exclusivo de líder ('9988')
  const validLeaderWs = new WebSocket(serverWs);
  await new Promise((resolve) => validLeaderWs.on('open', resolve));
  const leaderSuccessPromise = new Promise((resolve) => {
    validLeaderWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_joined') resolve(msg);
    });
  });
  validLeaderWs.send(JSON.stringify({
    type: 'join_room',
    roomCode,
    role: 'leader',
    pin: '9988'
  }));
  await leaderSuccessPromise;
  console.log('✓ 9. Líder autenticado com sucesso via PIN exclusivo.');

  // Cleanup
  validWs.close();
  validLeaderWs.close();
  hostWs.close();
  console.log('--- TODOS OS TESTES DE BACKEND E AUTENTICAÇÃO PASSARAM COM SUCESSO! ---');
}

testBackend().catch((e) => {
  console.error('TESTE FALHOU:', e);
  process.exit(1);
});

