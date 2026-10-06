// LifeMail service worker: makes the app open instantly and offline.
// It caches ONLY the app's own files. Email data from Google is never cached here.
const VERSION = 'lifemail-v1.0.0';
const SHELL = [
  '/', '/index.html', '/oauth.html', '/css/app.css', '/manifest.webmanifest',
  '/js/app.js', '/js/core.js', '/js/lib.js', '/js/auth.js', '/js/config.js', '/js/gmail.js', '/js/demo.js',
  '/js/store.js', '/js/actions.js', '/js/reader.js', '/js/compose.js', '/js/task.js', '/js/settings.js',
  '/js/oauth-landing.js', '/js/vendor/purify.min.js', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google APIs go straight to the network
  if (url.pathname.startsWith('/oauth.html')) return; // never interfere with sign-in
  // Network first (so updates arrive), falling back to the cached copy when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (new URL(w.url).origin === location.origin) { w.focus(); return w.navigate(target); }
    return self.clients.openWindow(target);
  }));
});
