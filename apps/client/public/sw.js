const CACHE_VERSION = "docmost-pwa-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/favicon-16x16.png",
  "/icons/favicon-32x32.png",
  "/icons/app-icon-192x192.png",
  "/icons/app-icon-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => !cacheName.startsWith(CACHE_VERSION))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Не перехватываем non-GET запросы и системные chrome-extension URL.
  if (request.method !== "GET" || !request.url.startsWith("http")) {
    return;
  }

  const url = new URL(request.url);

  // Критичные realtime/API запросы всегда отдаем напрямую в сеть,
  // чтобы не ломать аутентификацию, WebSocket upgrade и синхронизацию.
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/socket.io") ||
    url.pathname.startsWith("/collab")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstForDocuments(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/**
 * Стратегия Network First для HTML-навигации.
 *
 * @param {Request} request - Исходный браузерный navigation-request.
 * @returns {Promise<Response>} Актуальный ответ из сети или fallback из кэша/offline-страницы.
 */
async function networkFirstForDocuments(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    const offlinePage = await caches.match("/offline.html");

    if (offlinePage) {
      return offlinePage;
    }

    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=UTF-8" },
    });
  }
}

/**
 * Стратегия Stale-While-Revalidate для ассетов (JS/CSS/изображения).
 *
 * @param {Request} request - Исходный запрос к статическому ресурсу.
 * @returns {Promise<Response>} Быстрый ответ из кэша или из сети с последующим обновлением кэша.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  const networkResponsePromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }

      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkResponsePromise;

  if (networkResponse) {
    return networkResponse;
  }

  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });
}
