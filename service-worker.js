const CACHE = "kweider-customer-v4.0.0";
const CORE = [
  "./",
  "./index.html",
  "./rewards.html",
  "./staff.html",
  "./privacy.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./logo.webp",
  "./assets/css/app-shell.css",
  "./assets/js/app-shell.js",
  "./assets/vendor/qrcode-local.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./staff-app/",
  "./staff-app/index.html",
  "./staff-app/manifest.webmanifest",
  "./staff-app/icons/icon-192.png",
  "./staff-app/icons/icon-512.png"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith("kweider-pwa-") || key.startsWith("kweider-customer-")) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok && url.origin === self.location.origin) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("./offline.html"))));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then(async cached => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }));
  }
});
