// Service Worker – nur für die App-Hülle (damit die App auch ohne Netz öffnet).
// Strategie: Netz zuerst (mit kurzer Wartezeit, Revalidierung statt HTTP-Cache), sonst Cache.
// Anfragen an Google (API) fasst er nicht an.
const VERSION = '1.0.0-m2'; // = APP_VERSION in js/version.js (wird getestet)
const CACHE = `gas-shell-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './config.js',
  './manifest.webmanifest',
  './js/main.js',
  './js/version.js',
  './js/storage.js',
  './js/format.js',
  './js/plausi.js',
  './js/api.js',
  './js/queue.js',
  './js/render.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('gas-shell-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API & Fremdes: direkt ans Netz
  const cacheKey = req.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : url.origin + url.pathname;
  event.respondWith(networkFirst(req, cacheKey));
});

async function networkFirst(req, cacheKey) {
  const cache = await caches.open(CACHE);
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok && res.type === 'basic') cache.put(cacheKey, res.clone());
    return res;
  });
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    /* offline → Cache */
  }
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    return await network; // kein Cache: doch auf das Netz warten
  } catch {
    return new Response('Offline – die App wurde noch nie online geöffnet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
