import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { shouldReloadAfterWorkerActivation } from "./register-service-worker";

const source = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");
const registrationSource = readFileSync(
  resolve(process.cwd(), "src", "lib", "pwa", "register-service-worker.ts"),
  "utf8",
);

function createServiceWorkerHarness() {
  const listeners = new Map<string, (event: any) => void>();
  const cacheStores = new Map<
    string,
    Map<string, { request: Request; response: Response }>
  >();
  const requestKey = (request: RequestInfo | URL) =>
    typeof request === "string"
      ? new URL(request, "http://localhost:3000").href
      : request instanceof URL
        ? request.href
        : request.url;
  const openCache = async (cacheName: string) => {
    let store = cacheStores.get(cacheName);
    if (!store) {
      store = new Map();
      cacheStores.set(cacheName, store);
    }

    return {
      put: async (request: RequestInfo | URL, response: Response) => {
        const key = requestKey(request);
        const normalizedRequest =
          request instanceof Request ? request : new Request(key);
        store?.set(key, {
          request: normalizedRequest,
          response: response.clone(),
        });
      },
      match: async (request: RequestInfo | URL) =>
        store?.get(requestKey(request))?.response.clone(),
      delete: async (request: RequestInfo | URL) =>
        store?.delete(requestKey(request)) ?? false,
      keys: async () =>
        [...(store?.values() ?? [])].map(({ request }) => request),
      addAll: vi.fn().mockResolvedValue(undefined),
    };
  };
  const caches = {
    open: vi.fn(openCache),
    delete: vi.fn(async (cacheName: string) => cacheStores.delete(cacheName)),
    keys: vi.fn(async () => [...cacheStores.keys()]),
    match: vi.fn(async () => undefined),
  };
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn();
  const matchAll = vi.fn().mockResolvedValue([
    {
      url: "http://localhost:3000/s/general/p/page-1",
      focus,
    },
  ]);
  const self = {
    addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
      listeners.set(type, listener);
    }),
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn() },
    location: { origin: "http://localhost:3000" },
    skipWaiting: vi.fn(),
  };

  const workerContext = {
    self,
    URL,
    caches,
    fetch: fetchMock,
    Response,
    Request,
  } as Record<string, unknown>;

  runInNewContext(source, workerContext);

  return {
    listeners,
    showNotification,
    focus,
    openWindow,
    matchAll,
    fetchMock,
    caches,
    workerContext: workerContext as {
      putRuntimeResponse: (
        cache: Awaited<ReturnType<typeof openCache>>,
        request: Request,
        response: Response,
      ) => Promise<void>;
      getFreshRuntimeResponse: (
        cache: Awaited<ReturnType<typeof openCache>>,
        request: Request,
      ) => Promise<Response | undefined>;
      networkFirstForResource: (request: Request) => Promise<Response>;
    },
  };
}

describe("service worker safety policy", () => {
  it("cleans partial shell installs and obsolete Docmost caches", () => {
    expect(source).toContain("await caches.delete(SHELL_CACHE)");
    expect(source).toContain("!CURRENT_CACHES.has(cacheName)");
    expect(source).toContain("cacheName.startsWith(CACHE_PREFIX)");
  });

  it("validates cached navigation documents and includes the offline locale script", () => {
    expect(source).toContain("isValidDocumentResponse(cachedResponse)");
    expect(source).toContain("html.includes('id=\"root\"')");
    expect(source).toContain('"/offline.js"');
  });

  it("keeps private API and collaboration traffic out of caches", () => {
    expect(source).toContain("url.origin !== self.location.origin");
    expect(source).toContain('url.pathname.startsWith("/api")');
    expect(source).toContain('url.pathname.startsWith("/socket.io")');
    expect(source).toContain('url.pathname.startsWith("/collab")');
    expect(source).toContain('url.pathname === "/window-config.js"');
  });

  it("leaves runtime window configuration entirely to the network", () => {
    const { listeners } = createServiceWorkerHarness();
    const respondWith = vi.fn();
    const waitUntil = vi.fn();

    listeners.get("fetch")?.({
      request: new Request("http://localhost:3000/window-config.js"),
      respondWith,
      waitUntil,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("registers even when the window load event has already fired", () => {
    expect(registrationSource).toContain('document.readyState === "complete"');
    expect(registrationSource).toContain("{ once: true }");
  });

  it("subscribes to updatefound before starting an explicit update check", () => {
    expect(
      registrationSource.indexOf('addEventListener("updatefound"'),
    ).toBeLessThan(registrationSource.indexOf("await registration.update()"));
    expect(registrationSource).toContain(
      "observeWorker(registration.installing)",
    );
  });

  it("reloads after activation only when the page was already controlled", () => {
    expect(registrationSource.indexOf("const wasControlled")).toBeLessThan(
      registrationSource.indexOf("await navigator.serviceWorker.register"),
    );
    expect(shouldReloadAfterWorkerActivation("activated", false)).toBe(false);
    expect(shouldReloadAfterWorkerActivation("activated", true)).toBe(true);
    expect(shouldReloadAfterWorkerActivation("installing", true)).toBe(false);
  });

  it("keeps background runtime cache writes inside the fetch event lifetime", () => {
    expect(source).toContain("event.waitUntil(networkResponsePromise");
    expect(source).toContain(
      "await putRuntimeResponse(cache, request, response)",
    );
    expect(source).toContain(
      "await putRuntimeResponse(cache, request, networkResponse)",
    );
  });

  it("bounds runtime entries by count and timestamped age", () => {
    expect(source).toContain("RUNTIME_CACHE_MAX_ENTRIES = 200");
    expect(source).toContain(
      "RUNTIME_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000",
    );
    expect(source).toContain("RUNTIME_METADATA_CACHE");
    expect(source).toContain(
      "await enforceRuntimeCacheLimits(cache, metadataCache)",
    );
    expect(source).toContain("await getFreshRuntimeResponse(cache, request)");
  });

  it("keeps the original response intact and stores retention metadata separately", async () => {
    const { caches, workerContext } = createServiceWorkerHarness();
    const runtimeCache = await caches.open("docmost-pwa-v9-runtime");
    const request = new Request("http://localhost:3000/assets/app.css");
    const response = new Response("body", {
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "text/css",
      },
    });

    await workerContext.putRuntimeResponse(runtimeCache, request, response);

    const cachedResponse = await runtimeCache.match(request);
    const metadataCache = await caches.open("docmost-pwa-v9-runtime-metadata");
    const metadata = await metadataCache.match(request);
    expect(await cachedResponse?.text()).toBe("body");
    expect(cachedResponse?.headers.get("content-encoding")).toBe("gzip");
    expect(Number(await metadata?.text())).toBeGreaterThan(0);
    expect(source).not.toContain("new Response(response.clone().body");
  });

  it("removes stale response and metadata entries together", async () => {
    const { caches, workerContext } = createServiceWorkerHarness();
    const runtimeCache = await caches.open("docmost-pwa-v9-runtime");
    const metadataCache = await caches.open("docmost-pwa-v9-runtime-metadata");
    const request = new Request("http://localhost:3000/assets/old.js");
    await runtimeCache.put(request, new Response("old"));
    await metadataCache.put(
      request,
      new Response(String(Date.now() - 31 * 24 * 60 * 60 * 1000)),
    );

    await expect(
      workerContext.getFreshRuntimeResponse(runtimeCache, request),
    ).resolves.toBeUndefined();
    await expect(runtimeCache.match(request)).resolves.toBeUndefined();
    await expect(metadataCache.match(request)).resolves.toBeUndefined();
  });

  it("returns a successful network response when the cache write fails", async () => {
    const { caches, fetchMock, workerContext } = createServiceWorkerHarness();
    const runtimeCache = await caches.open("docmost-pwa-v9-runtime");
    runtimeCache.put = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    fetchMock.mockResolvedValue(
      new Response("fresh", { headers: { "Content-Type": "text/css" } }),
    );

    const response = await workerContext.networkFirstForResource(
      new Request("http://localhost:3000/assets/app.css"),
    );

    expect(await response.text()).toBe("fresh");
  });

  it("displays the aggregated push payload with its target URL", async () => {
    const { listeners, showNotification } = createServiceWorkerHarness();
    let pending: Promise<void> | undefined;

    listeners.get("push")?.({
      data: {
        json: () => ({
          title: "2 updates",
          body: "You have unread notifications",
          url: "/s/general/p/page-1",
        }),
      },
      waitUntil: (promise: Promise<void>) => {
        pending = promise;
      },
    });
    await pending;

    expect(showNotification).toHaveBeenCalledWith(
      "2 updates",
      expect.objectContaining({
        body: "You have unread notifications",
        data: { url: "/s/general/p/page-1" },
      }),
    );
  });

  it("focuses an existing tab for a notification click", async () => {
    const { listeners, focus, openWindow, matchAll } =
      createServiceWorkerHarness();
    const close = vi.fn();
    let pending: Promise<void> | undefined;

    listeners.get("notificationclick")?.({
      notification: {
        close,
        data: { url: "/s/general/p/page-1" },
      },
      waitUntil: (promise: Promise<void>) => {
        pending = promise;
      },
    });
    await pending;

    expect(close).toHaveBeenCalledTimes(1);
    expect(matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });
});
