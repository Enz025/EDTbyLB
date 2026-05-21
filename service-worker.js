/* Service Worker — EDT
   Stratégie :
   - App shell (HTML/CSS/JS/manifest/icons) : cache-first
   - Données .ics : network-first avec fallback cache (pour rester utilisable hors-ligne) */

const VERSION = 'edt-v1.9.2';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE  = `data-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll échoue si une seule ressource manque ; on tolère les icônes
      Promise.all(SHELL_ASSETS.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => ![SHELL_CACHE, DATA_CACHE].includes(k))
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Données .ics (souvent cross-origin) → network-first
  if (url.pathname.endsWith('.ics') || req.destination === '' && url.search.includes('ics')) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // presets.json : network-first pour avoir les ajouts récents
  if (url.pathname.endsWith('/presets.json')) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Same-origin app-shell → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Reste cross-origin → network puis cache opportuniste
  event.respondWith(networkFirst(req, DATA_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    // Fallback final : page d'accueil pour les navigations
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return Response.error();
  }
}

// Permet de forcer une mise à jour depuis l'app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
