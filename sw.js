const CACHE_NAME = 'es-v9';
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

  // Cross-origin (e.g. the Firebase SDK from gstatic.com) is left to the browser.
  // If the service worker intercepted it, dynamic module loading could fail
  // on some browsers ("Importing a module script failed").
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (e) { sameOrigin = false; }
  if (!sameOrigin) return;

  // Cache-first for GET only; other methods (e.g. POST) go to the network.
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