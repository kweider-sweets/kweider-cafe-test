const CACHE = "kweider-customer-v4.5.14";
const CORE = [
  "./",
  "./index.html",
  "./rewards.html",
  "./staff.html",
  "./privacy.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./logo.webp",
  "./assets/fonts/cairo-variable.woff2",
  "./assets/css/app-shell.css",
  "./assets/js/app-shell.js",
  "./assets/js/rewards-page.js",
  "./assets/js/rewards-turnstile-hotfix.js",
  "./assets/js/staff-page.js",
  "./assets/js/staff-app-install.js",
  "./assets/js/staff-app-page.js",
  "./assets/vendor/html5-qrcode.min.js",
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

const BADGE_STATE_CACHE = "kweider-badge-state-v1";
const BADGE_STATE_URL = new URL("./__kweider_badge_count__", self.location.href).href;

async function readBadgeCount() {
  try {
    const cache = await caches.open(BADGE_STATE_CACHE);
    const response = await cache.match(BADGE_STATE_URL);
    if (!response) return 0;
    const value = Number(await response.text());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

async function writeBadgeCount(count) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));

  try {
    const cache = await caches.open(BADGE_STATE_CACHE);
    if (safeCount > 0) {
      await cache.put(
        BADGE_STATE_URL,
        new Response(String(safeCount), {
          headers: { "Content-Type": "text/plain" },
        }),
      );
    } else {
      await cache.delete(BADGE_STATE_URL);
    }
  } catch {}

  try {
    if (safeCount > 0 && "setAppBadge" in self.navigator) {
      await self.navigator.setAppBadge(safeCount);
    } else if (safeCount === 0 && "clearAppBadge" in self.navigator) {
      await self.navigator.clearAppBadge();
    }
  } catch (error) {
    console.warn("Unable to update Kweider app badge:", error);
  }

  return safeCount;
}

async function incrementBadgeCount() {
  const currentCount = await readBadgeCount();
  return writeBadgeCount(currentCount + 1);
}

async function clearBadgeCount() {
  return writeBadgeCount(0);
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => (key.startsWith("kweider-pwa-") || key.startsWith("kweider-customer-")) && key !== CACHE)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();

    const scopeUrl = new URL(self.registration.scope);
    const rootPath = scopeUrl.pathname.replace(/\/+$/, "");
    const indexPath = `${rootPath}/index.html`.replace(/\/+/g, "/");
    const rewardsPath = `${rootPath}/rewards.html`.replace(/\/+/g, "/");
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    await Promise.all(windows.map(client => {
      try {
        const url = new URL(client.url);
        const path = url.pathname.replace(/\/+$/, "");
        const shouldRefresh = url.origin === scopeUrl.origin && (path === rootPath || path === indexPath || path === rewardsPath);
        if (shouldRefresh && "navigate" in client) return client.navigate(client.url);
      } catch {}
      return undefined;
    }));
  })());
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
      if (response && response.ok) { const cacheCopy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, cacheCopy)); }
      return response;
    }));
  }
});

self.addEventListener("push", event => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "Kweider Rewards";
  const rewardsUrl = new URL("./rewards.html", self.location.href).href;
  const iconUrl = new URL("./assets/icons/icon-192.png", self.location.href).href;
  const badgeUrl = new URL("./assets/icons/icon-192.png", self.location.href).href;

  const options = {
    body: payload.body || "You have a new Kweider reward update.",
    icon: payload.icon || iconUrl,
    badge: payload.badge || badgeUrl,
    tag: payload.tag || "kweider-rewards-update",
    renotify: false,
    data: {
      url: payload.url || rewardsUrl,
      messageId: payload.messageId || null,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      incrementBadgeCount(),
    ]),
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ||
    new URL("./rewards.html", self.location.href).href;

  event.waitUntil(
    Promise.all([
      clearBadgeCount(),
      clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          const target = new URL(targetUrl);
          if (clientUrl.origin === target.origin && "focus" in client) {
            if ("navigate" in client) client.navigate(targetUrl);
            return client.focus();
          }
        } catch {}
      }
        return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
      }),
    ]),
  );
});

self.addEventListener("message", event => {
  if (event.data?.type !== "CLEAR_APP_BADGE") return;
  event.waitUntil(clearBadgeCount());
});
