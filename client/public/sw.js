// Krajcara Admin — Service Worker
const CACHE = 'ka-v1';
const OFFLINE_URL = '/';

// Cache app shell on install
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/']))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first strategy for API, cache-first for assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and API requests
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses for static assets
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match(OFFLINE_URL)))
  );
});

// Push notifications
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    e.waitUntil(
      self.registration.showNotification(data.title || 'Krajcara Admin', {
        body:  data.body  || '',
        icon:  '/favicon.svg',
        badge: '/favicon.svg',
        tag:   data.tag   || 'ka-notification',
        data:  { url: data.url || '/' },
      })
    );
  } catch {}
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const url = e.notification.data?.url || '/';
      const existing = list.find(c => c.url.includes(url) && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
