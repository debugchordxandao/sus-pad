/**
 * Utilitários de interface: elementos, avisos, sheets e sliders.
 */

import { store } from './store.js';
import { noteLabels } from './catalog.js';

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...[].concat(children).filter(c => c !== null && c !== undefined && c !== false));
  return node;
}

export function labels() {
  return noteLabels(store.prefs.notation, store.prefs.accidental);
}

export function fillSelect(select, options, value) {
  select.replaceChildren(...options.map(o => new Option(o.name, o.id)));
  if (value !== undefined) select.value = value;
}

// Avisos
export function toast(message, type = 'info') {
  const container = $('toast-container');
  if (!container || !message) return;
  const node = el('div', { class: `toast toast-${type}`, text: message });
  container.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(-8px)';
    setTimeout(() => node.remove(), 250);
  }, 3200);
}

let bannerTimer = null;
export function showBanner(message, type = 'warning', autoHideMs = 0) {
  const banner = $('status-banner');
  if (!banner) return;
  clearTimeout(bannerTimer);
  banner.className = `status-banner ${type}`;
  banner.textContent = message;
  if (autoHideMs) bannerTimer = setTimeout(hideBanner, autoHideMs);
}

export function hideBanner() {
  clearTimeout(bannerTimer);
  $('status-banner')?.classList.add('hidden');
}

// Sheets
export function openModal(modal) {
  modal.classList.remove('hidden');
  modal.dispatchEvent(new CustomEvent('open'));
}

export function closeModal(modal) {
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.dispatchEvent(new CustomEvent('close'));
}

/** Botão que pede um segundo toque para confirmar (sem diálogos do navegador). */
export function confirmButton(button, label, confirmLabel, onConfirm) {
  let armed = false;
  let timer = null;
  const reset = () => { armed = false; button.textContent = label; };
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmLabel;
      clearTimeout(timer);
      timer = setTimeout(reset, 4000);
      return;
    }
    clearTimeout(timer);
    reset();
    onConfirm();
  });
  return reset;
}

// Sliders com preenchimento (Safari/Chrome não pintam a parte ativa sozinhos)
export function paintRange(input) {
  const min = parseFloat(input.min || 0);
  const max = parseFloat(input.max || 100);
  input.style.setProperty('--pct', `${((parseFloat(input.value) - min) / (max - min)) * 100}%`);
}

/** Atualiza o valor de um slider vindo do estado, sem brigar com quem está arrastando. */
export function setRangeValue(input, value) {
  if (document.activeElement === input && input.matches(':active')) return;
  if (String(input.value) !== String(value)) input.value = value;
  paintRange(input);
}

export function initUi() {
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(backdrop); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(closeModal);
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches?.('input[type="range"]')) paintRange(e.target);
  });
  document.querySelectorAll('input[type="range"]').forEach(paintRange);
}
