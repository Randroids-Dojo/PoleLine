// PoleLine service worker: makes the game installable, keeps the last page
// for offline starts, and shows lap alerts (someone beat your time).

const CACHE = 'poleline-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages come from the network first so a deploy shows up straight away; the
// cached copy only covers starting the game offline. Assets are left to the
// browser's HTTP cache (they are immutable and hashed).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
        }
        return res;
      })
      .catch(() => caches.match('/').then((r) => r || Response.error())),
  );
});

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'PoleLine', {
      body: msg.body || '',
      icon: '/icon-192.png',
      tag: msg.tag,
      renotify: Boolean(msg.tag),
      data: { url: msg.url || '/' },
    }),
  );
});

// Open the circuit's leaderboard. An open game is focused and told where to
// go (it ignores this mid-lap); otherwise a new window starts at the link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === url.origin);
      if (open) {
        open.postMessage({ type: 'open', search: url.search });
        return open.focus();
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
