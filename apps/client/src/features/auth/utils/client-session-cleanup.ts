const AUTH_LOGOUT_EVENT_KEY = "docmost:auth-logout";
const AUTH_LOGOUT_CHANNEL = "docmost-auth";
const PAGE_DATABASE_PREFIX = "page.";
const SENSITIVE_LOCAL_STORAGE_KEYS = [
  "currentUser",
  "docmost:sidebar-tree-open-state:v1",
];
const SENSITIVE_LOCAL_STORAGE_PREFIXES = ["docmost:database-table-state:"];
const SENSITIVE_SESSION_STORAGE_PREFIXES = [
  "docmost:ai-draft:",
  "docmost:idempotency:",
];

function removeStorageEntries(
  storage: Storage,
  keys: string[],
  prefixes: string[],
) {
  for (const key of keys) {
    storage.removeItem(key);
  }

  const matchingKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      matchingKeys.push(key);
    }
  }

  for (const key of matchingKeys) {
    storage.removeItem(key);
  }
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function clearPageDatabases() {
  if (!("indexedDB" in window) || !indexedDB.databases) {
    return;
  }

  const databases = await indexedDB.databases();
  await Promise.all(
    databases
      .map((database) => database.name)
      .filter(
        (name): name is string =>
          Boolean(name) && name.startsWith(PAGE_DATABASE_PREFIX),
      )
      .map(deleteDatabase),
  );
}

async function clearRuntimeCaches() {
  if (!("caches" in window)) {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(
        (cacheName) =>
          cacheName.startsWith("docmost-pwa-") &&
          cacheName.endsWith("-runtime"),
      )
      .map((cacheName) => caches.delete(cacheName)),
  );

  navigator.serviceWorker?.controller?.postMessage({
    type: "CLEAR_SENSITIVE_DATA",
  });
}

export async function clearSensitiveClientState() {
  removeStorageEntries(
    window.localStorage,
    SENSITIVE_LOCAL_STORAGE_KEYS,
    SENSITIVE_LOCAL_STORAGE_PREFIXES,
  );
  removeStorageEntries(
    window.sessionStorage,
    [],
    SENSITIVE_SESSION_STORAGE_PREFIXES,
  );

  await Promise.allSettled([clearPageDatabases(), clearRuntimeCaches()]);
}

export function notifyOtherTabsAboutLogout() {
  const eventId = `${Date.now()}:${crypto.randomUUID?.() ?? Math.random()}`;
  window.localStorage.setItem(AUTH_LOGOUT_EVENT_KEY, eventId);
  window.localStorage.removeItem(AUTH_LOGOUT_EVENT_KEY);

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(AUTH_LOGOUT_CHANNEL);
    channel.postMessage({ type: "logout", eventId });
    channel.close();
  }
}

export function registerLogoutSync(onLogout: () => void | Promise<void>) {
  let handlingLogout = false;
  const handleLogout = () => {
    if (handlingLogout) {
      return;
    }

    handlingLogout = true;
    void Promise.resolve(onLogout()).finally(() => {
      handlingLogout = false;
    });
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_LOGOUT_EVENT_KEY && event.newValue) {
      handleLogout();
    }
  };
  const channel =
    "BroadcastChannel" in window
      ? new BroadcastChannel(AUTH_LOGOUT_CHANNEL)
      : null;

  window.addEventListener("storage", handleStorage);
  channel?.addEventListener("message", handleLogout);

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.removeEventListener("message", handleLogout);
    channel?.close();
  };
}
