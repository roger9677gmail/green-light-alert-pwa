const CACHE_NAME = "front-car-alert-v2124";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=2.12.4",
  "./app.js?v=2.12.4",
  "./manifest.webmanifest",
  "./icon.svg",
  "./ads.txt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = request.mode === "navigate" ? "./index.html" : request;

  try {
    const response = await fetch(new Request(request, { cache: "reload" }));
    cache.put(cacheKey, response.clone());
    return response;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    throw new Error("No cached response available");
  }
}
