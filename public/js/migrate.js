/**
 * Migração dos nomes antigos (PadStudio) para os novos (Sus Pad).
 * Importado primeiro em main.js, antes de qualquer módulo ler o armazenamento,
 * para ninguém perder repertório, login, sala salva nem os sons baixados.
 */

const KEYS = [
  ['padstudio_prefs', 'suspad_prefs'],
  ['padstudio_library', 'suspad_library'],
  ['padstudio_auth_token', 'suspad_auth_token'],
  ['padstudio_host_session', 'suspad_host_session']
];
const SESSION_KEYS = [
  ['padstudio_room_code', 'suspad_room_code'],
  ['padstudio_role', 'suspad_role']
];

function move(storage, pairs) {
  try {
    for (const [oldKey, newKey] of pairs) {
      const value = storage.getItem(oldKey);
      if (value === null) continue;
      if (storage.getItem(newKey) === null) storage.setItem(newKey, value);
      storage.removeItem(oldKey);
    }
  } catch (e) { /* armazenamento indisponível */ }
}

move(globalThis.localStorage ?? { getItem: () => null }, KEYS);
move(globalThis.sessionStorage ?? { getItem: () => null }, SESSION_KEYS);

// Sons já baixados: copia do cache antigo para o novo e apaga o antigo (uma vez só)
async function moveAudioCache() {
  try {
    if (!globalThis.caches) return;
    const names = await caches.keys();
    const old = names.filter(n => n.startsWith('padstudio-audio-'));
    for (const oldName of old) {
      const newName = oldName.replace('padstudio-', 'suspad-');
      const from = await caches.open(oldName);
      const to = await caches.open(newName);
      for (const request of await from.keys()) {
        if (!(await to.match(request))) await to.put(request, await from.match(request));
      }
      await caches.delete(oldName);
    }
  } catch (e) { /* sem cache: os sons baixam de novo quando precisar */ }
}
moveAudioCache();
