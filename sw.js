// ═══════════════════════════════════════════════════════════
// MDRO App – Service Worker
// تعليمات الترقية: غيّر CACHE_VERSION فقط عند كل إصدار جديد
// ═══════════════════════════════════════════════════════════

const CACHE_VERSION = 'mdro-v149';
const CACHE = CACHE_VERSION;

const CORE_FILES = [
  'https://artistph.github.io/MDRO-APP/',
  'https://artistph.github.io/MDRO-APP/index.html',
  'https://artistph.github.io/MDRO-APP/manifest.json',
  'https://artistph.github.io/MDRO-APP/icon-192.png',
  'https://artistph.github.io/MDRO-APP/icon-512.png',
  'https://artistph.github.io/MDRO-APP/sw.js'
];

// ── Install ───────────────────────────────────────────────
// يشتغل مرة واحدة لما المتصفح يكتشف نسخة SW جديدة
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_FILES))
      .catch(err => console.warn('[SW] Install cache failed:', err))
  );
  // لا تستنى: خلّي الـ SW الجديد يحل محل القديم فوراً
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────
// يشتغل بعد install مباشرةً ويمسح كل الكاشات القديمة
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
  // سيطر فوراً على كل الصفحات المفتوحة بدون ما تحتاج refresh
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────
// استراتيجية: Network First للملفات الأساسية، Cache First للباقي
self.addEventListener('fetch', event => {
  const req = event.request;

  // تجاهل: non-GET، chrome-extension، وطلبات Firebase/Firestore/CDN خارجي
  if (req.method !== 'GET') return;
  if (req.url.startsWith('chrome-extension://')) return;
  if (req.url.includes('firestore.googleapis.com')) return;
  if (req.url.includes('firebase')) return;
  if (req.url.includes('gstatic.com')) return;

  const isAppFile = CORE_FILES.some(f => req.url === f || req.url.startsWith('https://artistph.github.io/MDRO-APP/'));

  if (isAppFile) {
    // Network First: دايماً جرب النت أولاً عشان تجيب أحدث نسخة
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
          // النت فشل: ارجع من الكاش (وضع أوفلاين)
          return caches.match(req).then(cached => {
            return cached || caches.match('https://artistph.github.io/MDRO-APP/index.html');
          });
        })
    );
  } else {
    // باقي الطلبات (CDN, fonts): Cache First → fallback Network
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

// ── Message ───────────────────────────────────────────────
// بيسمح للتطبيق يطلب تحديث فوري لو احتاج
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
