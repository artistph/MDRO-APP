const CACHE = 'mdro-v8';
const FILES = [
  'https://artistph.github.io/MDRO-APP/',
  'https://artistph.github.io/MDRO-APP/index.html',
  'https://artistph.github.io/MDRO-APP/manifest.json',
  'https://artistph.github.io/MDRO-APP/icon-192.png',
  'https://artistph.github.io/MDRO-APP/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {}));
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
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
