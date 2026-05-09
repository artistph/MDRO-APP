const CACHE = 'mdro-v5';
const FILES = [
  'https://artistph.github.io/MDRO-APP/',
  'https://artistph.github.io/MDRO-APP/index.html',
  'https://artistph.github.io/MDRO-APP/manifest.json',
  'https://artistph.github.io/MDRO-APP/icon-192.png',
  'https://artistph.github.io/MDRO-APP/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([
      './',
      './index.html',
      './manifest.json',
      './icon-192.png',
      './icon-512.png'
    ])).catch(() => {})
  );
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
