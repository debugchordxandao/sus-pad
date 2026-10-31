/**
 * PadStudio Live — ponto de entrada.
 *
 * Organização:
 *   catalog.js      sons (timbres, kits, clicks) — fonte única
 *   audio-engine.js motor de áudio (host/solo)
 *   library.js      repertórios
 *   permissions.js  o que cada função pode fazer
 *   store.js        estado + eventos
 *   net.js          WebSocket da sala
 *   setlist-text.js colar/compartilhar repertório em texto
 *   shortcuts.js    atalhos do teclado do computador
 *   actions.js      toda ação passa por dispatch()
 *   views/*.js      telas (cada uma escuta o evento 'view' e se atualiza)
 */

import { initUi } from './ui.js';
import { initPads } from './views/pads.js';
import { initDrums } from './views/drums.js';
import { initMetro } from './views/metro.js';
import { initMixer } from './views/mixer.js';
import { initSetlist } from './views/setlist.js';
import { initRoom } from './views/room.js';
import { initAuth } from './views/auth.js';
import { initSettings } from './views/settings.js';
import { initCues } from './views/cues.js';
import { initShortcuts } from './shortcuts.js';

initUi();
initPads();
initDrums();
initMetro();
initMixer();
initSetlist();
initRoom();
initAuth();
initSettings();
initCues();
initShortcuts();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('[SW] indisponível:', err));
  });
}
