/* global URL, Response, caches, fetch, self */
const CACHE_NAME = "tasviehyar-shell-v4";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

function isCacheableRequest(request) {
  const url = new URL(request.url);
  return request.method === "GET" && url.origin === self.location.origin && !url.pathname.endsWith(".json");
}

async function cacheResponse(request, response) {
  if (!response || !response.ok) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function serveFromCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  return cacheResponse(request, response);
}

async function serveNavigation(request) {
  try {
    const response = await fetch(request);
    await cacheResponse("/index.html", response.clone());
    return response;
  } catch {
    return (await caches.match("/index.html")) || (await caches.match("/")) || new Response("Application shell unavailable.", { status: 503 });
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
