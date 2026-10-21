const CACHE_NAME = 'es-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './sync.js',
  './manifest.webmanifest',
  './words.json',
  './grammar.json',
  './verbs.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Cizí původ (např. Firebase SDK z gstatic.com) necháváme prohlížeči.
  // Kdyby ho service worker odchytával, může na některých prohlížečích
  // selhat načtení dynamického modulu ("Importing a module script failed").
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (e) { sameOrigin = false; }
  if (!sameOrigin) return;

  // Cache-first jen pro čtení; ostatní metody (např. POST) na síť.
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(response => response || fetch(req))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});