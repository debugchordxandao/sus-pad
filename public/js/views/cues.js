/**
 * Sinais para a banda: quem tem permissão toca um aviso e ele aparece grande em todos os aparelhos da sala.
 */

import { store, allowed } from '../store.js';
import { send, onMessage } from '../net.js';
import { $, el, toast } from '../ui.js';

export const CUES = ['Repete', 'Última vez', 'Segura', 'Volta ao início', 'Refrão', 'Ponte', 'Mais forte', 'Mais suave', 'Sobe o tom', 'Fim'];
const SHOW_MS = 4000;

let hideTimer = null;

function showCue(text, from) {
  const overlay = $('cue-overlay');
  $('cue-text').textContent = text;
  $('cue-from').textContent = from || '';
  overlay.classList.remove('hidden');
  overlay.classList.remove('pop');
  void overlay.offsetWidth; // reinicia a animação
  overlay.classList.add('pop');
  try { navigator.vibrate?.([90, 60, 90]); } catch (e) { /* sem vibração */ }
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => overlay.classList.add('hidden'), SHOW_MS);
}

export function sendCue(text) {
  const clean = String(text || '').trim().slice(0, 60);
  if (!clean) return;
  if (!allowed('cues')) { toast('Sua função não pode enviar sinais nesta sala.', 'error'); return; }
  if (store.role === 'solo') { showCue(clean, ''); return; }
  if (!send({ type: 'cue', text: clean })) toast('Sem conexão com a sala.', 'error');
}

export function initCues() {
  $('cues-grid').replaceChildren(...CUES.map(text => el('button', {
    class: 'cue-button', type: 'button', text,
    onclick: () => sendCue(text)
  })));

  $('form-cue').addEventListener('submit', (e) => {
    e.preventDefault();
    sendCue($('cue-custom').value);
    $('cue-custom').value = '';
    $('cue-custom').blur();
  });

  $('cue-overlay').addEventListener('click', () => {
    clearTimeout(hideTimer);
    $('cue-overlay').classList.add('hidden');
  });

  onMessage('cue', (msg) => {
    if (typeof msg.text !== 'string') return;
    showCue(msg.text, typeof msg.from === 'string' ? msg.from : '');
  });
}
