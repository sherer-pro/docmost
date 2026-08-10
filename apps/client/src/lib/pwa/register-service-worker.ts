/**
 * Registers a Service Worker only in production and only in browsers
 * that support the required API. This guard helps to:
 * 1) keep local DX clean in dev (HMR and SW cache often conflict);
 * 2) avoid unnecessary work in unsupported environments;
 * 3) keep PWA update behavior centralized and predictable.
 */
export async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) {
    return;
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });

      /**
       * When a new SW version is found, attach an install-state listener.
       * Once the new worker becomes active, reload the page so the app
       * immediately uses the fresh bundle/asset cache.
       */
      const observedWorkers = new WeakSet<ServiceWorker>();
      const observeWorker = (nextWorker: ServiceWorker | null) => {
        if (!nextWorker) {
          return;
        }

        if (observedWorkers.has(nextWorker)) {
          return;
        }

        observedWorkers.add(nextWorker);

        nextWorker.addEventListener("statechange", () => {
          if (
            nextWorker.state === "activated" &&
            navigator.serviceWorker.controller
          ) {
            window.location.reload();
          }
        });
      };

      registration.addEventListener("updatefound", () => {
        observeWorker(registration.installing);
      });
      observeWorker(registration.installing);

      // Attach listeners before the explicit update check so a fast update
      // cannot complete between update() and updatefound subscription.
      await registration.update();
    } catch (error) {
      // Log the error explicitly to speed up diagnostics for HTTPS, scope,
      // CSP, or invalid `/sw.js` response issues.
      console.error("Failed to register Service Worker:", error);
    }
  };

  if (document.readyState === "complete") {
    await register();
    return;
  }

  window.addEventListener("load", () => void register(), { once: true });
}
