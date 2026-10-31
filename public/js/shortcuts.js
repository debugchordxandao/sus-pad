/**
 * Atalhos no teclado do computador (host no notebook):
 *   1 2 3 4 5 6 7 8 9 0 - =   os 12 tons (C a B); a mesma tecla de novo para o pad
 *   Espaço                    para o pad
 *   →                         próxima música
 *   Q W E R · A S D F         bateria (em views/drums.js)
 */

import { allowed } from './store.js';
import { dispatch } from './actions.js';
import { toggleTone } from './views/pads.js';
import { activateNext } from './views/setlist.js';

export const TONE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

export function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable]')) return;
    if (!document.getElementById('screen-main-stage').classList.contains('active')) return;
    if (document.querySelector('.modal-backdrop:not(.hidden)')) return;

    const tone = TONE_KEYS.indexOf(e.key);
    if (tone !== -1 && allowed('pads')) {
      e.preventDefault();
      toggleTone(tone);
    } else if (e.key === ' ' && allowed('pads')) {
      e.preventDefault(); // não "clica" no botão focado
      dispatch('pad_off');
    } else if (e.key === 'ArrowRight' && allowed('setlist')) {
      e.preventDefault();
      activateNext();
    }
  });
}
