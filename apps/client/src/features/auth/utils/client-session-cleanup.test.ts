// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSensitiveClientState,
  registerLogoutSync,
} from "./client-session-cleanup";

describe("client session cleanup", () => {
  const deletedDatabases: string[] = [];
  const deletedCaches: string[] = [];
  const postMessage = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    deletedDatabases.length = 0;
    deletedCaches.length = 0;
    postMessage.mockReset();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        databases: vi
          .fn()
          .mockResolvedValue([
            { name: "page.private-document" },
            { name: "unrelated-database" },
          ]),
        deleteDatabase: vi.fn((name: string) => {
          deletedDatabases.push(name);
          const request: Record<string, (() => void) | undefined> = {};
          queueMicrotask(() => request.onsuccess?.());
          return request;
        }),
      },
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        keys: vi
          .fn()
          .mockResolvedValue([
            "docmost-pwa-v7-shell",
            "docmost-pwa-v7-runtime",
            "unrelated-cache",
          ]),
        delete: vi.fn(async (name: string) => {
          deletedCaches.push(name);
          return true;
        }),
      },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: { postMessage } },
    });
  });

  it("removes private storage while preserving the installable shell", async () => {
    window.localStorage.setItem("currentUser", "private");
    window.localStorage.setItem(
      "docmost:sidebar-tree-open-state:v1",
      "private",
    );
    window.localStorage.setItem(
      "docmost:database-table-state:database",
      "private",
    );
    window.localStorage.setItem("unrelated", "keep");
    window.sessionStorage.setItem("docmost:ai-draft:w:u:p", "private");

    await clearSensitiveClientState();

    expect(window.localStorage.getItem("currentUser")).toBeNull();
    expect(
      window.localStorage.getItem("docmost:sidebar-tree-open-state:v1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("docmost:database-table-state:database"),
    ).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(window.sessionStorage.getItem("docmost:ai-draft:w:u:p")).toBeNull();
    expect(deletedDatabases).toEqual(["page.private-document"]);
    expect(deletedCaches).toEqual(["docmost-pwa-v7-runtime"]);
    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_SENSITIVE_DATA" });
  });

  it("reacts to a logout event from another tab", async () => {
    const onLogout = vi.fn();
    const unregister = registerLogoutSync(onLogout);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "docmost:auth-logout",
        newValue: "event-id",
      }),
    );
    await Promise.resolve();

    expect(onLogout).toHaveBeenCalledTimes(1);
    unregister();
  });
});
