// Service Worker – nur für die App-Hülle (damit die App auch ohne Netz öffnet).
// Strategie: Alle Dateien einer Version werden beim Installieren gemeinsam gespeichert und nur aus diesem einen
// Cache ausgeliefert – nie eine Mischung aus alten und neuen Dateien (die legt die App lahm).
// Neue Version: Der Browser prüft sw.js bei jedem Öffnen; BUILD (Prüfsumme aller Dateien, `node tools/stamp.mjs`)
// macht jede Änderung an der App zu einer neuen sw.js → neuer Cache → die App lädt einmal neu.
// Ausnahme config.js: Netz zuerst (die URL wird direkt auf GitHub geändert). Anfragen an Google fasst er nicht an.
const VERSION = '1.2.1-m4'; // = APP_VERSION in js/version.js (wird getestet)
const BUILD = '31cc4051b29f'; // Prüfsumme der Dateien – wird von tools/stamp.mjs gesetzt (CI prüft)
const CACHE = `gas-shell-${VERSION}-${BUILD}`;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './config.js',
  './manifest.webmanifest',
  './js/guard.js',
  './js/main.js',
  './js/version.js',
  './js/storage.js',
  './js/format.js',
  './js/plausi.js',
  './js/api.js',
  './js/queue.js',
  './js/render.js',
  './js/charts.js',
  './js/analyse.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const CONFIG_TIMEOUT_MS = 3000;

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
  const scope = self.registration.scope;
  const key = req.mode === 'navigate' ? new URL('./index.html', scope).href : url.origin + url.pathname;
  event.respondWith(key === new URL('./config.js', scope).href ? networkFirst(req, key) : cacheFirst(req, key));
});

async function cacheFirst(req, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    return await fetch(req, { cache: 'no-cache' });
  } catch {
    return offline();
  }
}

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  });
  try {
    const res = await Promise.race([network, new Promise(resolve => setTimeout(resolve, CONFIG_TIMEOUT_MS, null))]);
    if (res) return res;
  } catch {
    /* offline → Cache */
  }
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    return await network;
  } catch {
    return offline();
  }
}

function offline() {
  return new Response('Offline – die App wurde noch nie online geöffnet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
