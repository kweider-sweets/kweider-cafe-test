const CACHE = "kweider-staff-v4.1.0";
const CORE = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "../logo.webp",
  "../assets/css/app-shell.css",
  "../assets/js/app-shell.js"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("kweider-staff-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
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
