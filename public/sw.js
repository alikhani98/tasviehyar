/* global URL, Response, caches, fetch, self */
const CACHE_NAME = "tasviehyar-shell-v5";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

function isPrivateApiPath(pathname) {
  // Includes /api/backup-v1.json and the reserved namespace for future backup routes.
  try {
    const path = decodeURIComponent(pathname).toLowerCase();
    return path === "/api" || path.startsWith("/api/") || /^\/backup\.php(?:\/|$)/.test(path);
  } catch {
    return true;
  }
}

function isCacheableRequest(request) {
  const url = new URL(request.url);
  return request.method === "GET" && url.origin === self.location.origin &&
    request.cache !== "no-store" && !isPrivateApiPath(url.pathname) && !url.pathname.endsWith(".json");
}

async function cacheResponse(request, response) {
  const cacheControl = response?.headers.get("Cache-Control");
  if (!response?.ok || response.redirected || /(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl ?? "") ||
      (response.url && isPrivateApiPath(new URL(response.url).pathname))) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function matchShell(request) {
  return (await caches.open(CACHE_NAME)).match(request);
}

async function serveFromCacheFirst(request) {
  const cached = await matchShell(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  return cacheResponse(request, response);
}

async function serveNavigation(request) {
  try {
    const response = await fetch(request);
    await cacheResponse("/index.html", response);
    return response;
  } catch {
    return (await matchShell("/index.html")) || (await matchShell("/")) || new Response("Application shell unavailable.", { status: 503 });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => /^tasviehyar-shell-v\d+$/.test(key) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isCacheableRequest(request)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(serveNavigation(request));
    return;
  }

  event.respondWith(serveFromCacheFirst(request));
});
