// ═══════════════════════════════════════════════════════════
// MDRO App – Service Worker (Caching + Firebase Messaging)
// ═══════════════════════════════════════════════════════════
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyDttIrm6BxTtW2e20vGWS2Mqxitwxp6J7I",
  authDomain: "mdro-379fd.firebaseapp.com",
  projectId: "mdro-379fd",
  storageBucket: "mdro-379fd.firebasestorage.app",
  messagingSenderId: "409523753719",
  appId: "1:409523753719:web:06b09908f23a3f6ec1f9f2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, badge } = payload.notification || {};
  self.registration.showNotification(title || 'MDRO', {
    body: body || '',
    icon: icon || '/MDRO-APP/icon-192.png',
    badge: badge || '/MDRO-APP/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    requireInteraction: true,
  });
});

// ── Caching ────────────────────────────────────────────────
const CACHE_VERSION = 'mdro-v128';
const CACHE = CACHE_VERSION;

const CORE_FILES = [
  'https://artistph.github.io/MDRO-APP/',
  'https://artistph.github.io/MDRO-APP/index.html',
  'https://artistph.github.io/MDRO-APP/manifest.json',
  'https://artistph.github.io/MDRO-APP/icon-192.png',
  'https://artistph.github.io/MDRO-APP/icon-512.png',
  'https://artistph.github.io/MDRO-APP/sw.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_FILES))
      .catch(err => console.warn('[SW] Install cache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith('chrome-extension://')) return;
  if (req.url.includes('firestore.googleapis.com')) return;
  if (req.url.includes('firebase')) return;
  if (req.url.includes('gstatic.com')) return;

  const isAppFile = CORE_FILES.some(f => req.url === f || req.url.startsWith('https://artistph.github.io/MDRO-APP/'));

  if (isAppFile) {
    event.respondWith(
      fetch(req)
        .then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE).then(cache => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          return caches.match(req).then(cached => {
            return cached || caches.match('https://artistph.github.io/MDRO-APP/index.html');
          });
        })
    );
  } else {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE).then(cache => cache.put(req, clone));
          }
          return networkRes;
        });
      })
    );
  }
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
