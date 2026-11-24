/* Journalism service worker: works offline, shows the daily reminder, sets the Home Screen badge.
 * Bump VERSION when you change the app so phones pick up the new files. */
const VERSION = 'journalism-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'storage.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/badge-96.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// App files: try the network first (so updates arrive), fall back to the saved copy when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

// Daily reminder sent by the GitHub Actions scheduler (.github/workflows/reminder.yml).
self.addEventListener('push', e => {
  let data = {}; try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'Journalism', body = data.body || 'What happened today?';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'daily-reminder', data: { url: './#write' } }),
    self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
  ]));
});
// Tapping the notification opens the app straight into a new entry.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './#write', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.postMessage({ type: 'write' }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
