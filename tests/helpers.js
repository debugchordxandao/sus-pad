/**
 * Sobe o servidor real numa porta livre, com banco temporário, para os testes.
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padstudio-test-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch (e) { /* ainda subindo */ }
    if (child.exitCode !== null) throw new Error(`Servidor saiu:\n${output}`);
    await new Promise(r => setTimeout(r, 100));
  }

  return {
    base,
    wsUrl: `ws://127.0.0.1:${port}`,
    output: () => output,
    alive: () => child.exitCode === null,
    async stop() {
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

/** Cliente WebSocket com fila de mensagens e espera por tipo. */
async function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex(w => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  return {
    ws,
    send: (data) => ws.send(typeof data === 'string' ? data : JSON.stringify(data)),
    next(type, timeout = 2000) {
      const match = (m) => (typeof type === 'function' ? type(m) : m.type === type);
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => {
          const k = waiters.indexOf(w);
          if (k >= 0) { waiters.splice(k, 1); reject(new Error(`Timeout esperando ${typeof type === 'string' ? type : 'mensagem'}`)); }
        }, timeout);
      });
    },
    close: () => ws.close()
  };
}

module.exports = { startServer, client };
