/**
 * Mantém a tela acesa durante o culto e avisa quando a aba do host passou por segundo plano.
 *
 * - Wake Lock API quando disponível (HTTPS ou localhost)
 * - Sem HTTPS (rede local por IP), usa um vídeo mudo em loop: o navegador não apaga a tela
 *   enquanto um vídeo toca. É a mesma técnica de bibliotecas como NoSleep.js.
 */

import { store } from './store.js';
import { showBanner } from './ui.js';

let sentinel = null;
let video = null;
let active = false;
let hiddenAt = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    return true;
  } catch (e) {
    return false;
  }
}

function startVideoFallback() {
  if (!video) {
    video = document.createElement('video');
    video.src = 'assets/keep-awake.mp4';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0';
    document.body.appendChild(video);
  }
  video.play().catch(() => { /* sem gesto do usuário: tenta de novo no próximo toque */ });
}

export async function startKeepAwake() {
  active = true;
  if (!(await requestWakeLock())) startVideoFallback();
}

export function stopKeepAwake() {
  active = false;
  sentinel?.release().catch(() => {});
  sentinel = null;
  video?.pause();
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  if (!active) return;
  if (!sentinel && !(await requestWakeLock())) startVideoFallback();

  // O iOS suspende o áudio quando a aba sai da frente: retoma e avisa o host
  await store.engine?.resume();
  if (store.role === 'host' && hiddenAt) {
    const seconds = Math.round((Date.now() - hiddenAt) / 1000);
    if (seconds >= 2) {
      showBanner(`A aba ficou ${seconds} s em segundo plano. Confira o som.`, 'warning', 6000);
    }
  }
  hiddenAt = null;
});

// Um toque qualquer reativa o vídeo de fallback (o navegador exige gesto do usuário)
document.addEventListener('pointerdown', () => {
  if (active && !sentinel && video && video.paused) video.play().catch(() => {});
}, { passive: true });
