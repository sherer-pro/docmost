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
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
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

  runInNewContext(source, {
    self,
    URL,
    caches: {},
    fetch: vi.fn(),
    Response,
  });

  return { listeners, showNotification, focus, openWindow, matchAll };
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
    expect(source).toContain('url.pathname.startsWith("/api")');
    expect(source).toContain('url.pathname.startsWith("/socket.io")');
    expect(source).toContain('url.pathname.startsWith("/collab")');
  });

  it("registers even when the window load event has already fired", () => {
    expect(registrationSource).toContain('document.readyState === "complete"');
    expect(registrationSource).toContain("{ once: true }");
  });

  it("subscribes to updatefound before starting an explicit update check", () => {
    expect(registrationSource.indexOf('addEventListener("updatefound"')).toBeLessThan(
      registrationSource.indexOf("await registration.update()"),
    );
    expect(registrationSource).toContain("observeWorker(registration.installing)");
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
    expect(source).toContain("await cache.put(request, response.clone())");
    expect(source).toContain("await cache.put(request, networkResponse.clone())");
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
