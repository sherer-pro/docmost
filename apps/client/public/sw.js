const CACHE_VERSION = "docmost-pwa-v9";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const RUNTIME_METADATA_CACHE = `${CACHE_VERSION}-runtime-metadata`;
const CACHE_PREFIX = "docmost-pwa-";
const CURRENT_CACHES = new Set([
  SHELL_CACHE,
  RUNTIME_CACHE,
  RUNTIME_METADATA_CACHE,
]);
const RUNTIME_CACHE_MAX_ENTRIES = 200;
const RUNTIME_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let lastRuntimeExpiryCheck = 0;
let runtimeMaintenancePromise = null;
let runtimeMaintenanceRequested = false;

const APP_SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/offline.js",
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
      .then(() => self.skipWaiting())
      .catch(async (error) => {
        await caches.delete(SHELL_CACHE);
        throw error;
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(CACHE_PREFIX) &&
                !CURRENT_CACHES.has(cacheName),
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Do not intercept non-GET requests and system chrome-extension URLs.
  if (request.method !== "GET" || !request.url.startsWith("http")) {
    return;
  }

  const url = new URL(request.url);

  // Cross-origin resources can carry private or opaque responses and must not
  // become part of Docmost's offline storage.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Always pass critical realtime/API requests directly to the network
  // to avoid breaking authentication, WebSocket upgrades, and synchronization.
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/socket.io") ||
    url.pathname.startsWith("/collab") ||
    url.pathname === "/window-config.js"
  ) {
    return;
  }

  if (request.mode === "navigate") {
    respondWithNetworkFirst(event, networkFirstForDocuments(request));
    return;
  }

  if (url.pathname.startsWith("/locales/")) {
    respondWithNetworkFirst(event, networkFirstForResource(request));
    return;
  }

  const networkOperation = updateRuntimeCache(request);
  const networkResponse = networkOperation.then(({ response }) => response);
  event.waitUntil(networkOperation.then(({ cacheWrite }) => cacheWrite));
  event.respondWith(staleWhileRevalidate(request, networkResponse));
});

/**
 * Returns a successful network-first response without making the document or
 * locale wait for CacheStorage maintenance. The same operation promise keeps
 * the background write inside the fetch event lifetime.
 *
 * @param {FetchEvent} event - Fetch event receiving the response.
 * @param {Promise<{response: Response, cacheWrite: Promise<void>}>} operation
 * Network-first operation.
 * @returns {void}
 */
function respondWithNetworkFirst(event, operation) {
  event.respondWith(operation.then(({ response }) => response));
  event.waitUntil(operation.then(({ cacheWrite }) => cacheWrite));
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePushEvent(event));
});

self.addEventListener("notificationclick", (event) => {
  event.waitUntil(handleNotificationClick(event));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_SENSITIVE_DATA") {
    return;
  }

  event.waitUntil(
    Promise.all([
      caches.delete(RUNTIME_CACHE),
      caches.delete(RUNTIME_METADATA_CACHE),
    ]),
  );
});

/**
 * Handles incoming push payload and displays a notification.
 *
 * @param {PushEvent} event - Push event from the browser.
 * @returns {Promise<void>} Promise that resolves when notification display completes.
 */
async function handlePushEvent(event) {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "Docmost";
  const body = payload.body || "You have a new notification";

  await self.registration.showNotification(title, {
    body,
    icon: "/icons/app-icon-192x192.png",
    badge: "/icons/favicon-32x32.png",
    data: {
      url: payload.url || "/",
    },
  });
}

/**
 * On click, opens the target tab or focuses an existing one.
 *
 * @param {NotificationEvent} event - Click event for a system notification.
 * @returns {Promise<void>} Promise that resolves when click handling completes.
 */
async function handleNotificationClick(event) {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  const existingWindow = windows.find((client) => {
    try {
      const clientUrl = new URL(client.url);
      const expectedUrl = new URL(targetUrl, self.location.origin);

      return clientUrl.pathname === expectedUrl.pathname;
    } catch {
      return false;
    }
  });

  if (existingWindow) {
    await existingWindow.focus();
    return;
  }

  await self.clients.openWindow(targetUrl);
}

/**
 * Network First strategy for HTML navigation.
 *
 * @param {Request} request - Original browser navigation request.
 * @returns {Promise<{response: Response, cacheWrite: Promise<void>}>}
 * Fresh response and background cache completion.
 */
async function networkFirstForDocuments(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  let response;

  try {
    response = await fetch(request);
  } catch {
    const cachedResponse = await getFreshRuntimeResponse(cache, request);

    if (cachedResponse && (await isValidDocumentResponse(cachedResponse))) {
      return {
        response: cachedResponse,
        cacheWrite: Promise.resolve(),
      };
    }

    if (cachedResponse) {
      await cache.delete(request);
    }

    const offlinePage = await caches.match("/offline.html");

    if (offlinePage) {
      return {
        response: offlinePage,
        cacheWrite: Promise.resolve(),
      };
    }

    return {
      response: new Response("Offline", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
      }),
      cacheWrite: Promise.resolve(),
    };
  }

  let cacheWrite = Promise.resolve();
  if (await isValidDocumentResponse(response)) {
    cacheWrite = putRuntimeResponse(cache, request, response).catch(() => {
      // A cache quota failure must not hide a successful network response.
    });
  }

  return { response, cacheWrite };
}

/**
 * Rejects malformed or manually corrupted navigation entries before use.
 *
 * @param {Response} response - Candidate HTML navigation response.
 * @returns {Promise<boolean>} Whether the response is a valid Docmost shell.
 */
async function isValidDocumentResponse(response) {
  if (!response?.ok || response.type === "opaque") {
    return false;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return false;
  }

  try {
    const html = await response.clone().text();
    return (
      /<!doctype\s+html/i.test(html) &&
      (html.includes('id="root"') || html.includes('class="offline-card"'))
    );
  } catch {
    return false;
  }
}

/**
 * Network First strategy for resources that must not remain stale while online.
 *
 * @param {Request} request - Original resource request.
 * @returns {Promise<{response: Response, cacheWrite: Promise<void>}>}
 * Fresh response and background cache completion.
 */
async function networkFirstForResource(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  let response;

  try {
    response = await fetch(request);
  } catch {
    const cachedResponse = await getFreshRuntimeResponse(cache, request);
    if (cachedResponse) {
      return {
        response: cachedResponse,
        cacheWrite: Promise.resolve(),
      };
    }
    return {
      response: new Response("Offline", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
      }),
      cacheWrite: Promise.resolve(),
    };
  }

  let cacheWrite = Promise.resolve();
  if (response.ok) {
    cacheWrite = putRuntimeResponse(cache, request, response).catch(() => {
      // A cache quota failure must not hide a successful network response.
    });
  }
  return { response, cacheWrite };
}

/**
 * Stale-While-Revalidate strategy for assets (JS/CSS/images).
 *
 * @param {Request} request - Original request for a static resource.
 * @param {Promise<Response|null>} networkResponsePromise - In-flight cache update.
 * @returns {Promise<Response>} Fast response from cache or network with follow-up cache update.
 */
async function staleWhileRevalidate(request, networkResponsePromise) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await getFreshRuntimeResponse(cache, request);

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

/**
 * Refreshes a runtime resource and keeps the cache write inside the fetch
 * event lifetime through event.waitUntil().
 *
 * @param {Request} request - Original request for a static resource.
 * @returns {Promise<{response: Response|null, cacheWrite: Promise<void>}>}
 * Network response and background cache completion.
 */
async function updateRuntimeCache(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  let networkResponse;

  try {
    networkResponse = await fetch(request);
  } catch {
    return {
      response: null,
      cacheWrite: Promise.resolve(),
    };
  }

  let cacheWrite = Promise.resolve();
  if (networkResponse.ok) {
    cacheWrite = putRuntimeResponse(cache, request, networkResponse).catch(
      () => {
        // The fetched response is still usable when runtime caching fails.
      },
    );
  }
  return { response: networkResponse, cacheWrite };
}

/**
 * Stores the original response plus separate timestamp metadata and enforces
 * the bounded runtime-cache policy.
 *
 * @param {Cache} cache - Runtime cache.
 * @param {Request} request - Cache key.
 * @param {Response} response - Fresh network response.
 * @returns {Promise<void>} Promise resolved after cache maintenance.
 */
async function putRuntimeResponse(cache, request, response) {
  const metadataCache = await caches.open(RUNTIME_METADATA_CACHE);

  try {
    await cache.put(request, response.clone());
    await metadataCache.put(
      request,
      new Response(String(Date.now()), {
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
      }),
    );
  } catch (error) {
    await Promise.allSettled([
      cache.delete(request),
      metadataCache.delete(request),
    ]);
    throw error;
  }

  await scheduleRuntimeCacheMaintenance(cache, metadataCache);
}

/**
 * Coalesces concurrent response writes into a bounded number of cache scans.
 * A busy route can request hundreds of assets at once; running a full
 * retention scan for every response would serialize application startup on
 * CacheStorage, particularly in Firefox.
 *
 * @param {Cache} cache - Runtime cache.
 * @param {Cache} metadataCache - Runtime metadata cache.
 * @returns {Promise<void>} Shared maintenance completion.
 */
function scheduleRuntimeCacheMaintenance(cache, metadataCache) {
  runtimeMaintenanceRequested = true;
  if (!runtimeMaintenancePromise) {
    runtimeMaintenancePromise = (async () => {
      try {
        while (true) {
          // Let concurrently completed cache writes join this maintenance pass.
          await Promise.resolve();
          runtimeMaintenanceRequested = false;
          await enforceRuntimeCacheLimits(cache, metadataCache);

          if (!runtimeMaintenanceRequested) {
            // Clear ownership before resolving. A write queued immediately
            // after this synchronous assignment starts a new maintenance pass
            // instead of joining a promise whose finalizer already ran.
            runtimeMaintenancePromise = null;
            return;
          }
        }
      } catch (error) {
        runtimeMaintenancePromise = null;
        throw error;
      }
    })();
  }

  return runtimeMaintenancePromise;
}

/**
 * Returns a cache entry only while it is inside the retention window.
 *
 * @param {Cache} cache - Runtime cache.
 * @param {Request} request - Cache key.
 * @returns {Promise<Response|undefined>} Fresh cached response, if present.
 */
async function getFreshRuntimeResponse(cache, request) {
  const response = await cache.match(request);
  if (!response) {
    const metadataCache = await caches.open(RUNTIME_METADATA_CACHE);
    await metadataCache.delete(request);
    return undefined;
  }

  const metadataCache = await caches.open(RUNTIME_METADATA_CACHE);
  const cachedAt = await getRuntimeCachedAt(metadataCache, request);
  const now = Date.now();
  if (
    !Number.isFinite(cachedAt) ||
    cachedAt <= 0 ||
    cachedAt > now + 5 * 60 * 1000 ||
    now - cachedAt > RUNTIME_CACHE_MAX_AGE_MS
  ) {
    await Promise.all([cache.delete(request), metadataCache.delete(request)]);
    return undefined;
  }
  return response;
}

/**
 * Reads the timestamp associated with a runtime cache entry.
 *
 * @param {Cache} metadataCache - Runtime metadata cache.
 * @param {Request} request - Cache key.
 * @returns {Promise<number>} Cache timestamp or NaN when metadata is invalid.
 */
async function getRuntimeCachedAt(metadataCache, request) {
  const metadata = await metadataCache.match(request);
  if (!metadata) {
    return Number.NaN;
  }

  try {
    return Number(await metadata.text());
  } catch {
    return Number.NaN;
  }
}

/**
 * Removes expired entries and then evicts the oldest entries over the cap.
 *
 * @param {Cache} cache - Runtime cache.
 * @param {Cache} metadataCache - Runtime metadata cache.
 * @returns {Promise<void>} Promise resolved after bounded eviction.
 */
async function enforceRuntimeCacheLimits(cache, metadataCache) {
  const now = Date.now();
  const keys = await cache.keys();
  const checkExpiry =
    lastRuntimeExpiryCheck === 0 ||
    now - lastRuntimeExpiryCheck >= 60 * 60 * 1000;
  if (!checkExpiry && keys.length <= RUNTIME_CACHE_MAX_ENTRIES) {
    return;
  }
  if (checkExpiry) {
    lastRuntimeExpiryCheck = now;
  }

  const entries = await Promise.all(
    keys.map(async (request) => {
      return {
        request,
        cachedAt: await getRuntimeCachedAt(metadataCache, request),
      };
    }),
  );
  const retained = [];
  for (const entry of entries) {
    if (
      !Number.isFinite(entry.cachedAt) ||
      entry.cachedAt <= 0 ||
      entry.cachedAt > now + 5 * 60 * 1000 ||
      now - entry.cachedAt > RUNTIME_CACHE_MAX_AGE_MS
    ) {
      await Promise.all([
        cache.delete(entry.request),
        metadataCache.delete(entry.request),
      ]);
    } else {
      retained.push(entry);
    }
  }

  if (checkExpiry) {
    const metadataKeys = await metadataCache.keys();
    await Promise.all(
      metadataKeys.map(async (request) => {
        if (!(await cache.match(request))) {
          await metadataCache.delete(request);
        }
      }),
    );
  }

  retained.sort((left, right) => left.cachedAt - right.cachedAt);
  const excess = retained.length - RUNTIME_CACHE_MAX_ENTRIES;
  if (excess > 0) {
    await Promise.all(
      retained
        .slice(0, excess)
        .map((entry) =>
          Promise.all([
            cache.delete(entry.request),
            metadataCache.delete(entry.request),
          ]),
        ),
    );
  }
}
