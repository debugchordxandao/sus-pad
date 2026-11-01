/**
 * PadStudio Live — Service Worker
 * - App (HTML/JS/CSS): rede primeiro, cópia salva quando offline
 * - Ícones e vídeo: cache primeiro
 * - Áudio: fica a cargo do motor de áudio (cache 'padstudio-audio-*'), que este SW nunca apaga
 */

const SHELL_CACHE = 'padstudio-shell-v8';
const SHELL_PREFIX = 'padstudio-shell-';
const LEGACY_PREFIX = 'padstudio-live-';

const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/assets/keep-awake.mp4',
  '/js/main.js',
  '/js/actions.js',
  '/js/audio-engine.js',
  '/js/catalog.js',
  '/js/chords.js',
  '/js/library.js',
  '/js/midi.js',
  '/js/net.js',
  '/js/permissions.js',
  '/js/setlist-text.js',
  '/js/shortcuts.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/wake.js',
  '/js/views/auth.js',
  '/js/views/chart.js',
  '/js/views/cues.js',
  '/js/views/drums.js',
  '/js/views/metro.js',
  '/js/views/mixer.js',
  '/js/views/pads.js',
  '/js/views/room.js',
  '/js/views/settings.js',
  '/js/views/setlist.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => (k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE) || k.startsWith(LEGACY_PREFIX))
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/audio/') || url.pathname.startsWith('/dev/')) return;

  const isShell = request.mode === 'navigate' || /\.(html|js|css|json)$/.test(url.pathname) || url.pathname === '/';
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(SHELL_CACHE).then(c => c.put(request, copy));
          }
          return resp;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: request.mode === 'navigate' })) || caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(resp => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then(c => c.put(request, copy));
      }
      return resp;
    }))
  );
});
