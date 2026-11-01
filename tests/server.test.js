const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

async function createRoom(opts = {}) {
  const host = await client(srv.wsUrl);
  host.send({ type: 'create_room', ...opts });
  const created = await host.next('room_created');
  return { host, created };
}

async function join(code, role = 'leader', pin) {
  const c = await client(srv.wsUrl);
  c.send({ type: 'join_room', roomCode: code, role, pin });
  return c;
}

test('health e headers de segurança', async () => {
  const r = await fetch(`${srv.base}/health`);
  assert.equal(r.status, 200);
  const page = await fetch(`${srv.base}/index.html`);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-powered-by'), null);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
});

test('cria sala com código de 4 caracteres, token forte e permissões padrão', async () => {
  const { host, created } = await createRoom();
  assert.match(created.roomCode, /^[2-9A-HJ-NP-Z]{4}$/);
  assert.ok(created.hostToken.length >= 30, 'token do host curto demais');
  assert.equal(created.permissions.drummer.panic, true);
  host.close();
});

test('controle remoto entra, comanda o host e recebe o estado', async () => {
  const { host, created } = await createRoom();
  const remote = await join(created.roomCode, 'keyboardist');
  const joined = await remote.next('room_joined');
  assert.equal(joined.role, 'keyboardist');

  remote.send({ type: 'pad_on', toneIndex: 7 });
  const cmd = await host.next('pad_on');
  assert.equal(cmd.toneIndex, 7);
  assert.equal(cmd.fromRole, 'keyboardist');

  host.send({ type: 'host_state_update', state: { activeToneIndex: 7, bpm: 90 } });
  const state = await remote.next('state');
  assert.equal(state.state.activeToneIndex, 7);
  host.close(); remote.close();
});

test('estado grande do host (repertório com 200 músicas) sincroniza', async () => {
  const { host, created } = await createRoom();
  const remote = await join(created.roomCode);
  await remote.next('room_joined');
  const songs = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, title: `Música número ${i} com um nome comprido`, keyIndex: i % 12, bpm: 100, timeSig: '4/4', preset: 'worship', notes: 'Entra só no refrão, depois volta.' }));
  host.send({ type: 'host_state_update', state: { songs } });
  const state = await remote.next('state');
  assert.equal(state.state.songs.length, 200);
  host.close(); remote.close();
});

test('controle remoto não consegue se passar por host', async () => {
  const { host, created } = await createRoom();
  const remote = await join(created.roomCode);
  await remote.next('room_joined');
  remote.send({ type: 'host_state_update', state: { bpm: 200 } });
  assert.equal((await remote.next('permission_denied')).action, 'host_state_update');
  remote.send({ type: 'set_permissions', permissions: {} });
  assert.equal((await remote.next('permission_denied')).action, 'set_permissions');
  const bad = await join(created.roomCode, 'host');
  assert.match((await bad.next('error')).message, /Papel inválido/);
  host.close(); remote.close(); bad.close();
});

test('permissões por função: host desliga e o servidor bloqueia', async () => {
  const { host, created } = await createRoom();
  const drummer = await join(created.roomCode, 'drummer');
  await drummer.next('room_joined');

  host.send({ type: 'set_permissions', permissions: { drummer: { panic: false, pads: false } } });
  const update = await drummer.next('permissions');
  assert.equal(update.permissions.drummer.panic, false);
  assert.equal(update.permissions.drummer.drums, true, 'o resto continua liberado');

  drummer.send({ type: 'panic' });
  assert.equal((await drummer.next('permission_denied')).action, 'panic');
  drummer.send({ type: 'drum_hit', padIndex: 0, velocity: 1 });
  assert.equal((await host.next('drum_hit')).padIndex, 0);
  host.close(); drummer.close();
});

test('sala com PIN: pede o PIN, recusa o errado, aceita o certo', async () => {
  const { host, created } = await createRoom({ roomPin: '4321' });
  const a = await join(created.roomCode, 'drummer');
  assert.match((await a.next('error')).message, /pede um PIN/);
  const b = await join(created.roomCode, 'drummer', '0000');
  assert.match((await b.next('error')).message, /incorreto/);
  const c = await join(created.roomCode, 'drummer', '4321');
  assert.equal((await c.next('room_joined')).roomCode, created.roomCode);
  host.close(); a.close(); b.close(); c.close();
});

test('host reconecta com o token; token errado não revela se a sala existe', async () => {
  const { host, created } = await createRoom();
  host.close();
  const again = await client(srv.wsUrl);
  again.send({ type: 'reconnect_host', roomCode: created.roomCode, hostToken: created.hostToken });
  assert.equal((await again.next('room_reconnected')).roomCode, created.roomCode);

  const wrong = await client(srv.wsUrl);
  wrong.send({ type: 'reconnect_host', roomCode: created.roomCode, hostToken: 'x' });
  const errWrong = await wrong.next('error');
  wrong.send({ type: 'reconnect_host', roomCode: 'ZZZZ', hostToken: 'x' });
  const errMissing = await wrong.next('error');
  assert.equal(errWrong.message.replace(created.roomCode, ''), errMissing.message.replace('ZZZZ', ''));
  again.close(); wrong.close();
});

test('mensagens malformadas não derrubam o servidor', async () => {
  const c = await client(srv.wsUrl);
  c.send('{isso não é json');
  await c.next('error');
  for (const msg of [
    { type: 'join_room', roomCode: { x: 1 }, role: 'leader' },
    { type: 'pad_on', toneIndex: 99 },
    { type: 'setlist_reorder', order: 'abc' },
    { type: 'transpose', delta: 5 },
    { type: 'x'.repeat(200) },
    [1, 2, 3]
  ]) {
    c.send(msg);
    await c.next('error');
  }
  assert.ok(srv.alive());
  assert.equal((await fetch(`${srv.base}/health`)).status, 200);
  c.close();
});

test('QR Code: preto no branco e com limite de tamanho', async () => {
  const ok = await (await fetch(`${srv.base}/api/qr?text=${encodeURIComponent('http://192.168.0.2:3000/?room=AB12')}`)).json();
  assert.match(ok.qr, /^data:image\/png;base64,/);
  const big = await fetch(`${srv.base}/api/qr?text=${'a'.repeat(600)}`);
  assert.equal(big.status, 400);
});

test('conta: cadastro, login e biblioteca de repertórios na nuvem', async () => {
  const email = `banda${Date.now()}@teste.com`;
  const reg = await fetch(`${srv.base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'senha123', name: 'Banda', bandName: 'Banda Teste' })
  });
  assert.equal(reg.status, 201);
  const { token } = await reg.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  assert.equal((await (await fetch(`${srv.base}/api/auth/library`, { headers: auth })).json()).library, null);
  const library = { version: 2, activeListId: 'a', updatedAt: 123, lists: [{ id: 'a', name: 'Domingo', songs: [{ id: '1', title: 'Teste' }] }] };
  const put = await fetch(`${srv.base}/api/auth/library`, { method: 'PUT', headers: auth, body: JSON.stringify({ library }) });
  assert.equal(put.status, 200);
  const got = (await (await fetch(`${srv.base}/api/auth/library`, { headers: auth })).json()).library;
  assert.equal(got.lists[0].name, 'Domingo');
  assert.equal(got.updatedAt, 123);

  const bad = await fetch(`${srv.base}/api/auth/library`, { method: 'PUT', headers: auth, body: JSON.stringify({ library: { lists: 'x' } }) });
  assert.equal(bad.status, 400);
  const noAuth = await fetch(`${srv.base}/api/auth/library`);
  assert.equal(noAuth.status, 401);

  const wrongPass = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'errada' })
  });
  assert.equal(wrongPass.status, 401);
});

test('ferramenta de calibração não existe em produção', async () => {
  const prod = await startServer({ NODE_ENV: 'production' });
  try {
    assert.equal((await fetch(`${prod.base}/dev/loop-test`)).status, 404);
    assert.equal((await fetch(`${prod.base}/loop-test.html`)).status, 404);
  } finally {
    await prod.stop();
  }
});

test('sinais chegam a todos os aparelhos da sala e respeitam a permissão', async () => {
  const { host, created } = await createRoom();
  const leader = await client(srv.wsUrl);
  leader.send({ type: 'join_room', roomCode: created.roomCode, role: 'leader', name: 'Ana' });
  await leader.next('room_joined');
  const drummer = await join(created.roomCode, 'drummer');
  await drummer.next('room_joined');

  leader.send({ type: 'cue', text: 'Última vez' });
  for (const c of [host, leader, drummer]) {
    const cue = await c.next('cue');
    assert.equal(cue.text, 'Última vez');
    assert.equal(cue.from, 'Ana');
  }

  host.send({ type: 'set_permissions', permissions: { drummer: { cues: false } } });
  await drummer.next('permissions');
  drummer.send({ type: 'cue', text: 'Fim' });
  assert.equal((await drummer.next('permission_denied')).action, 'cue');
  host.close(); leader.close(); drummer.close();
});

test('pong traz a hora do servidor (click visual sincronizado)', async () => {
  const c = await client(srv.wsUrl);
  const before = Date.now();
  c.send({ type: 'ping', clientTime: 123 });
  const pong = await c.next('pong');
  assert.equal(pong.clientTime, 123);
  assert.ok(pong.serverTime >= before - 1000 && pong.serverTime <= Date.now() + 1000);
  c.close();
});

test('controle remoto consegue colar um repertório grande (> 4 KB)', async () => {
  const { host, created } = await createRoom();
  const remote = await join(created.roomCode);
  await remote.next('room_joined');
  const songs = Array.from({ length: 80 }, (_, i) => ({ title: `Música colada número ${i}`, keyIndex: i % 12, bpm: 90, timeSig: '4/4', preset: 'worship', notes: '' }));
  remote.send({ type: 'setlist_import', songs });
  const cmd = await host.next('setlist_import');
  assert.equal(cmd.songs.length, 80);
  host.close(); remote.close();
});

test('rota HTTP de PIN tem limite de tentativas', async () => {
  // Servidor próprio: o bloqueio dura 10 min e atrapalharia os outros testes
  const own = await startServer();
  try {
    const host = await client(own.wsUrl);
    host.send({ type: 'create_room', roomPin: '9999' });
    const created = await host.next('room_created');
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const r = await fetch(`${own.base}/api/rooms/validate-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: created.roomCode, role: 'drummer', pin: String(i) })
      });
      statuses.push(r.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [403, 403, 403, 403, 403]);
    assert.equal(statuses[6], 429);
    // O mesmo IP também fica bloqueado para entrar pela sala via WebSocket
    const c = await client(own.wsUrl);
    c.send({ type: 'join_room', roomCode: created.roomCode, role: 'drummer', pin: '9999' });
    assert.match((await c.next('error')).message, /Muitas tentativas/);
    host.close(); c.close();
  } finally {
    await own.stop();
  }
});

// Por último: bloqueia este IP para buscas de sala
test('códigos de sala inexistentes são bloqueados depois de 10 tentativas', async () => {
  const c = await client(srv.wsUrl);
  const messages = [];
  for (let i = 0; i < 11; i++) {
    c.send({ type: 'join_room', roomCode: `Q${String(i).padStart(3, '0')}`.slice(0, 4), role: 'leader' });
    messages.push((await c.next('error')).message);
  }
  assert.match(messages[0], /não encontrada/);
  assert.match(messages[10], /Muitas tentativas/);
  c.close();
});

test('entrar com o Google: sem configuração não aparece; com configuração cria a conta e entra', async () => {
  const http = require('node:http');
  // Servidor falso no lugar do tokeninfo do Google
  const fake = http.createServer((req, res) => {
    const id = new URL(req.url, 'http://x').searchParams.get('id_token');
    const base = { iss: 'accounts.google.com', aud: 'app-de-teste.apps.googleusercontent.com', exp: String(Math.floor(Date.now() / 1000) + 600), email_verified: 'true' };
    const answers = {
      'token-valido-com-mais-de-vinte-caracteres': { ...base, email: 'Musico@Gmail.com', name: 'Músico Teste', picture: 'https://lh3.googleusercontent.com/a/foto123' },
      'token-de-outro-app-com-mais-de-vinte-car': { ...base, aud: 'outro-app', email: 'x@gmail.com' },
      'token-com-foto-de-site-estranho-vinte-car': { ...base, email: 'z@gmail.com', picture: 'https://site-estranho.com/foto.png' },
      'token-sem-email-verificado-mais-de-vinte': { ...base, email: 'y@gmail.com', email_verified: 'false' }
    };
    const body = answers[id];
    res.writeHead(body ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { error: 'invalid_token' }));
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const plain = await startServer();
  const google = await startServer({ GOOGLE_CLIENT_ID: 'app-de-teste.apps.googleusercontent.com', GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${fake.address().port}/tokeninfo` });
  try {
    const post = (srv, credential) => fetch(`${srv.base}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
    assert.equal((await (await fetch(`${plain.base}/api/auth/config`)).json()).googleClientId, null);
    assert.equal((await post(plain, 'token-valido-com-mais-de-vinte-caracteres')).status, 503);

    assert.equal((await (await fetch(`${google.base}/api/auth/config`)).json()).googleClientId, 'app-de-teste.apps.googleusercontent.com');
    const ok = await post(google, 'token-valido-com-mais-de-vinte-caracteres');
    assert.equal(ok.status, 200);
    const { token, user } = await ok.json();
    assert.equal(user.email, 'musico@gmail.com');
    assert.equal(user.name, 'Músico Teste');
    assert.equal(user.picture, 'https://lh3.googleusercontent.com/a/foto123');
    assert.equal((await post(google, 'token-com-foto-de-site-estranho-vinte-car').then(r => r.json())).user.picture, null); // foto só do domínio do Google
    const me = await fetch(`${google.base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.picture, 'https://lh3.googleusercontent.com/a/foto123');
    // segunda vez: mesma conta, sem duplicar
    assert.equal((await (await post(google, 'token-valido-com-mais-de-vinte-caracteres')).json()).user.id, user.id);

    assert.equal((await post(google, 'token-de-outro-app-com-mais-de-vinte-car')).status, 401);
    assert.equal((await post(google, 'token-sem-email-verificado-mais-de-vinte')).status, 401);
    assert.equal((await post(google, 'token-que-o-google-nao-conhece-mesmo')).status, 401);
    assert.equal((await post(google, 'curto')).status, 400);
  } finally {
    await plain.stop();
    await google.stop();
    fake.close();
  }
});

test('compartilhar repertório por link: cria código, devolve a cópia e recusa códigos inválidos', async () => {
  const list = { name: 'Culto', songs: [{ id: 'a', title: 'Lindo És', keyIndex: 3, chart: 'C  G' }] };
  const created = await fetch(`${srv.base}/api/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list }) });
  assert.equal(created.status, 200);
  const { code } = await created.json();
  assert.match(code, /^[A-Z2-9]{8}$/);
  const got = await (await fetch(`${srv.base}/api/share/${code.toLowerCase()}`)).json();
  assert.equal(got.list.name, 'Culto');
  assert.equal(got.list.songs[0].chart, 'C  G');
  assert.equal((await fetch(`${srv.base}/api/share/AAAAAAAA`)).status, 404);
  assert.equal((await fetch(`${srv.base}/api/share/x`)).status, 404);
  const bad = await fetch(`${srv.base}/api/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list: { songs: [] } }) });
  assert.equal(bad.status, 400);
});
