const SCRIPT_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [250, 1_000];

let pending: Promise<void> | undefined;

function isRuntimeConfigReady(): boolean {
  return [window.CONFIG?.APP_URL, window.CONFIG?.COLLAB_URL].every((value) => {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  });
}

function loadConfigScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (success: boolean) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      if (success) resolve();
      else reject(new Error("Runtime configuration is unavailable"));
    };
    const timeout = window.setTimeout(() => finish(false), SCRIPT_TIMEOUT_MS);
    script.src = "/window-config.js";
    script.async = true;
    script.onload = () => finish(isRuntimeConfigReady());
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });
}

/**
 * A failed parser-loaded config script must not leave a partially working app.
 * Retry the same-origin public script before routes or editors initialize.
 */
export function ensureRuntimeConfig(): Promise<void> {
  if (isRuntimeConfigReady()) return Promise.resolve();
  if (pending) return pending;

  pending = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await loadConfigScript();
        return;
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        await new Promise((resolve) =>
          window.setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
        );
      }
    }
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
