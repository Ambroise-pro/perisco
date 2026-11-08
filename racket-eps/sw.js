/*
 * Racket EPS — service de mise en cache (fonctionnement hors connexion).
 * Stratégie « réseau d'abord » : en ligne, on sert toujours la dernière version publiée (et on
 * met la copie locale à jour) ; si le réseau est absent ou trop lent (3 s, Wi-Fi de gymnase),
 * on sert la copie locale. Les données des élèves ne passent jamais par ici : elles restent dans
 * le stockage du navigateur (localStorage).
 */
const CACHE = 'racket-eps-app-v1';
const SHELL = [
  './', './index.html', './style.css', './engine.js', './app.js', './qr.js', './qrdecode.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), ms)); }

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Les pages (feuilles de match #f=…, #p=…, projection #projection) sont toutes index.html.
  const isPage = req.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([fetch(req), timeout(3000)]);
      if (res && res.ok) cache.put(isPage ? './index.html' : req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(isPage ? './index.html' : req, { ignoreSearch: true });
      if (hit) return hit;
      if (isPage) { const idx = await cache.match('./index.html'); if (idx) return idx; }
      return new Response('Hors connexion : ressource indisponible.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
