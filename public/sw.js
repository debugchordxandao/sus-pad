/**
 * PadStudio Live Service Worker
 * Cache com versão, estratégia Network-First para HTML/JS e Cache-First para assets estáticos.
 */

const CACHE_NAME = 'padstudio-live-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/audio-engine.js',
  '/setlist.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignorar WebSocket, rotas de API e arquivos de áudio grandes (WAV)
  if (
    event.request.url.includes('/audio/') ||
    event.request.url.includes('/api/') ||
    event.request.url.startsWith('ws')
  ) {
    return;
  }

  const url = new URL(event.request.url);
  const isHtmlOrJs =
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname === '/';

  if (isHtmlOrJs) {
    // Network-First para scripts e páginas (garante atualizações em tempo real)
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-First para CSS, ícones, fontes e manifesto
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return (
          cached ||
          fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
        );
      })
    );
  }
});
