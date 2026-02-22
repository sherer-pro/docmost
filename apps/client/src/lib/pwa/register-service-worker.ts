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

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      /**
       * When a new SW version is found, attach an install-state listener.
       * Once the new worker becomes active, reload the page so the app
       * immediately uses the fresh bundle/asset cache.
       */
      registration.addEventListener("updatefound", () => {
        const nextWorker = registration.installing;

        if (!nextWorker) {
          return;
        }

        nextWorker.addEventListener("statechange", () => {
          if (
            nextWorker.state === "activated" &&
            navigator.serviceWorker.controller
          ) {
            window.location.reload();
          }
        });
      });
    } catch (error) {
      // Log the error explicitly to speed up diagnostics for HTTPS, scope,
      // CSP, or invalid `/sw.js` response issues.
      console.error("Не удалось зарегистрировать Service Worker:", error);
    }
  });
}
