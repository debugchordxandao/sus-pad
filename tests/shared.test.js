const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const load = (file) => import(path.join(root, 'public', 'js', file));

test('permissões do app e do servidor são idênticas', async () => {
  const front = await load('permissions.js');
  const back = require('../server/permissions');
  assert.deepEqual(front.COMMAND_CAPABILITY, back.COMMAND_CAPABILITY);
  assert.deepEqual(front.ROLES.map(r => r.id), back.ROLES);
  assert.deepEqual(front.CAPABILITIES.map(c => c.id), back.CAPABILITIES);
  assert.deepEqual(front.defaultPermissions(), back.defaultPermissions());
  const legacy = { leader: true, drummer: false };
  assert.deepEqual(front.normalizePermissions(legacy), back.normalizePermissions(legacy));
});

test('todo comando do app tem uma permissão no servidor', async () => {
  const src = fs.readFileSync(path.join(root, 'public', 'js', 'actions.js'), 'utf8');
  const block = src.slice(src.indexOf('const executors = {'), src.indexOf('export const COMMANDS'));
  const commands = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]);
  const { COMMAND_CAPABILITY } = require('../server/permissions');
  assert.ok(commands.length > 15);
  for (const cmd of commands) assert.ok(COMMAND_CAPABILITY[cmd], `comando sem permissão: ${cmd}`);
});

test('todos os arquivos de áudio do catálogo existem', { skip: !fs.existsSync(path.join(root, 'audio', 'pads')) && 'pasta audio/ ausente' }, async () => {
  const { allAudioUrls } = await load('catalog.js');
  const missing = allAudioUrls().filter(u => !fs.existsSync(path.join(root, u)));
  assert.deepEqual(missing, []);
});

test('service worker lista todos os módulos do app', async () => {
  const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const modules = walk(path.join(root, 'public', 'js')).filter(f => f.endsWith('.js')).map(f => '/' + path.relative(path.join(root, 'public'), f).split(path.sep).join('/'));
  for (const m of modules) assert.ok(sw.includes(`'${m}'`), `sw.js não guarda ${m} para uso offline`);
});
