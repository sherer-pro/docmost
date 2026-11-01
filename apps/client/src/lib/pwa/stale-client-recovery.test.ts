import { describe, expect, it, vi } from "vitest";
import {
  recoverFromStaleClient,
  STALE_CLIENT_RECOVERY_KEY,
} from "./stale-client-recovery";

function createStorage(initialValue: string | null = null) {
  let value = initialValue;

  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe("stale client recovery", () => {
  it("does not reload or reserve recovery while the document is leaving", () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    const storage = createStorage();
    const reload = vi.fn();
    const now = vi.fn(() => 42_000);

    expect(
      recoverFromStaleClient(event, {
        now,
        reload,
        storage,
        isLeavingDocument: () => true,
      }),
    ).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("can recover after a document resumes without consuming an earlier marker", () => {
    let leaving = true;
    const storage = createStorage();
    const reload = vi.fn();
    const dependencies = {
      now: () => 42_000,
      reload,
      storage,
      isLeavingDocument: () => leaving,
    };
    expect(
      recoverFromStaleClient(new Event("vite:preloadError"), dependencies),
    ).toBe(false);
    leaving = false;
    expect(
      recoverFromStaleClient(new Event("vite:preloadError"), dependencies),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once and records a bounded recovery marker", () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    const storage = createStorage();
    const reload = vi.fn();

    const recovered = recoverFromStaleClient(event, {
      now: () => 42_000,
      reload,
      storage,
    });

    expect(recovered).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      STALE_CLIENT_RECOVERY_KEY,
      "42000",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again inside the recovery window", () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    const storage = createStorage("41000");
    const reload = vi.fn();

    const recovered = recoverFromStaleClient(event, {
      now: () => 42_000,
      reload,
      storage,
    });

    expect(recovered).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("fails closed when the recovery marker cannot be persisted", () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    const reload = vi.fn();

    const recovered = recoverFromStaleClient(event, {
      now: () => 42_000,
      reload,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage unavailable");
        },
      },
    });

    expect(recovered).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
