/**
 * Permissões por função — espelho de public/js/permissions.js.
 * O teste tests/permissions.test.js falha se as duas tabelas divergirem.
 */

const ROLES = ['keyboardist', 'drummer', 'leader'];
const CAPABILITIES = ['pads', 'drums', 'metro', 'setlist', 'mixer', 'panic'];

const COMMAND_CAPABILITY = {
  pad_on: 'pads',
  pad_off: 'pads',
  pad_preset: 'pads',
  drum_hit: 'drums',
  drum_kit: 'drums',
  metro: 'metro',
  bpm: 'metro',
  timesig: 'metro',
  metro_pan: 'metro',
  metro_opts: 'metro',
  volume: 'mixer',
  panic: 'panic',
  song_activate: 'setlist',
  song_next: 'setlist',
  transpose: 'setlist',
  setlist_add: 'setlist',
  setlist_edit: 'setlist',
  setlist_delete: 'setlist',
  setlist_reorder: 'setlist',
  setlist_select: 'setlist'
};

function defaultPermissions() {
  const perms = {};
  for (const role of ROLES) {
    perms[role] = {};
    for (const cap of CAPABILITIES) perms[role][cap] = true;
  }
  return perms;
}

function normalizePermissions(raw) {
  const perms = defaultPermissions();
  if (!raw || typeof raw !== 'object') return perms;
  for (const role of ROLES) {
    const value = raw[role];
    if (value === false) {
      for (const cap of CAPABILITIES) perms[role][cap] = false;
    } else if (value && typeof value === 'object') {
      for (const cap of CAPABILITIES) {
        if (typeof value[cap] === 'boolean') perms[role][cap] = value[cap];
      }
    }
  }
  return perms;
}

/** Um controle remoto pode enviar este comando ao host? */
function isCommandAllowed(role, type, permissions) {
  if (role === 'host') return true;
  const cap = COMMAND_CAPABILITY[type];
  if (!cap || !ROLES.includes(role)) return false;
  return permissions?.[role]?.[cap] !== false;
}

module.exports = { ROLES, CAPABILITIES, COMMAND_CAPABILITY, defaultPermissions, normalizePermissions, isCommandAllowed };
