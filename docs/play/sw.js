// App-shell cache so the PWA opens offline (the agents then run in the browser).
// Live data (/events, /api) always goes to the network.
const CACHE = 'impact-v13';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'globe.js', 'siege.js', 'catch.js', 'faces.js', 'factors.js', 'agents-engine.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api') || u.pathname === '/events') return;
  // network first, cache as fallback (also caches three.js and fonts after the first visit)
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    if (r.ok || r.type === 'opaque') caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
