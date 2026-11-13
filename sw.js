/* Service worker: caches the app shell only. Live data is never cached (no-store). */
const CACHE = 'desk-shell-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'chart.js', 'manifest.json', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // data files go straight to the network
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (x) {}
  e.waitUntil(self.registration.showNotification('Grok Bot · now', { body: d.body || '', icon: 'icons/icon-192.png', data: { url: d.url } }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); if (e.notification.data && e.notification.data.url) e.waitUntil(clients.openWindow(e.notification.data.url)); });
