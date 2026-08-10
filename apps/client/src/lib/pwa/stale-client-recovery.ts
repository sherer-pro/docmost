export const STALE_CLIENT_RECOVERY_KEY = "docmost:stale-client-recovery";

const RECOVERY_WINDOW_MS = 30_000;
const RECOVERY_MARKER_RESET_MS = 10_000;

interface StaleClientRecoveryDependencies {
  now: () => number;
  reload: () => void;
  storage: Pick<Storage, "getItem" | "setItem">;
}

export function recoverFromStaleClient(
  event: Event,
  dependencies: StaleClientRecoveryDependencies,
): boolean {
  const now = dependencies.now();

  try {
    const previousAttempt = Number(
      dependencies.storage.getItem(STALE_CLIENT_RECOVERY_KEY),
    );

    if (
      Number.isFinite(previousAttempt) &&
      previousAttempt > 0 &&
      now - previousAttempt < RECOVERY_WINDOW_MS
    ) {
      return false;
    }

    dependencies.storage.setItem(STALE_CLIENT_RECOVERY_KEY, String(now));
  } catch {
    // Without a durable marker a reload could loop indefinitely.
    return false;
  }

  event.preventDefault();
  dependencies.reload();
  return true;
}

let registered = false;

export function registerStaleClientRecovery(): void {
  if (import.meta.env.DEV || registered) {
    return;
  }

  registered = true;
  window.addEventListener("vite:preloadError", (event) => {
    recoverFromStaleClient(event, {
      now: Date.now,
      reload: () => window.location.reload(),
      storage: window.sessionStorage,
    });
  });

  window.setTimeout(() => {
    try {
      window.sessionStorage.removeItem(STALE_CLIENT_RECOVERY_KEY);
    } catch {
      // Storage can be unavailable in locked-down browser contexts.
    }
  }, RECOVERY_MARKER_RESET_MS);
}
