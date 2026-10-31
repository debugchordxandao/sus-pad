/**
 * Permissões por função. O host liga e desliga cada recurso para cada função.
 * O servidor aplica a mesma tabela (server/permissions.js) — um teste garante que as duas são iguais.
 */

export const ROLES = [
  { id: 'keyboardist', name: 'Tecladista' },
  { id: 'drummer', name: 'Baterista' },
  { id: 'leader', name: 'Líder' }
];

export const CAPABILITIES = [
  { id: 'pads', name: 'Pads' },
  { id: 'drums', name: 'Bateria' },
  { id: 'metro', name: 'Click' },
  { id: 'setlist', name: 'Músicas' },
  { id: 'mixer', name: 'Mixer' },
  { id: 'cues', name: 'Sinais' },
  { id: 'panic', name: 'Pânico' }
];

/** Qual recurso cada comando enviado ao host exige. */
export const COMMAND_CAPABILITY = {
  pad_on: 'pads',
  pad_off: 'pads',
  pad_preset: 'pads',
  pad_opts: 'pads',
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
  setlist_select: 'setlist',
  setlist_import: 'setlist',
  cue: 'cues'
};

/** Padrão: tudo liberado (como o app funcionava antes). */
export function defaultPermissions() {
  const perms = {};
  for (const role of ROLES) {
    perms[role.id] = {};
    for (const cap of CAPABILITIES) perms[role.id][cap.id] = true;
  }
  return perms;
}

/** Aceita o formato antigo ({ leader: true }) e qualquer lixo, devolvendo sempre a tabela completa. */
export function normalizePermissions(raw) {
  const perms = defaultPermissions();
  if (!raw || typeof raw !== 'object') return perms;
  for (const role of ROLES) {
    const value = raw[role.id];
    if (value === false) {
      for (const cap of CAPABILITIES) perms[role.id][cap.id] = false;
    } else if (value && typeof value === 'object') {
      for (const cap of CAPABILITIES) {
        if (typeof value[cap.id] === 'boolean') perms[role.id][cap.id] = value[cap.id];
      }
    }
  }
  return perms;
}

export function can(perms, role, capability) {
  if (role === 'host' || role === 'solo') return true;
  return perms?.[role]?.[capability] !== false;
}
