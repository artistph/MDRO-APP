const CACHE = 'mdro-v6'; // رقم جديد عشان يجبر الموبايل يحدّث
const FILES = [
  'https://artistph.github.io/MDRO-APP/',
  'https://artistph.github.io/MDRO-APP/index.html',
  'https://artistph.github.io/MDRO-APP/manifest.json',
  'https://artistph.github.io/MDRO-APP/icon-192.png',
  'https://artistph.github.io/MDRO-APP/icon-512.png'
];

// ── Install: كاش كل الملفات ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {})
  );
  self.skipWaiting(); // خلّي الـ SW الجديد يشتغل فوراً
});

// ── Activate: امسح الكاشات القديمة ───────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE) // كل كاش غير الحالي
          .map(key => caches.delete(key)) // امسحه
      )
    )
  );
  self.clients.claim(); // سيطر على كل التابات المفتوحة فوراً
});

// ── Fetch: Network First (دايماً جيب الأحدث من النت) ─────
self.addEventListener('fetch', e => {
  // تجاهل طلبات غير GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(networkResponse => {
        // لو جاب من النت، حدّث الكاش وارجع الرد
        const clone = networkResponse.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return networkResponse;
      })
      .catch(() => {
        // لو مفيش نت، ارجع من الكاش
        return caches.match(e.request);
      })
  );
});
