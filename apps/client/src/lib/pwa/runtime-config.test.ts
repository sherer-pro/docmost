// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureRuntimeConfig } from "./runtime-config";

const config = {
  APP_URL: "https://example.test",
  COLLAB_URL: "https://collab.example.test",
};
const script = () =>
  document.head.querySelector<HTMLScriptElement>(
    'script[src="/window-config.js"]',
  )!;

beforeEach(() => {
  vi.useFakeTimers();
  delete window.CONFIG;
});

afterEach(() => {
  document.head
    .querySelectorAll('script[src="/window-config.js"]')
    .forEach((node) => node.remove());
  delete window.CONFIG;
  vi.useRealTimers();
});

describe("runtime configuration recovery", () => {
  it("uses an already loaded configuration without another request", async () => {
    window.CONFIG = config;
    await ensureRuntimeConfig();
    expect(script()).toBeNull();
  });

  it("shares recovery and retries a transient failure before initializing callers", async () => {
    const ready = vi.fn();
    const pending = ensureRuntimeConfig();
    pending.then(ready);
    expect(ensureRuntimeConfig()).toBe(pending);
    const first = script();
    expect(first.src).toMatch(/\/window-config\.js$/);
    first.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(250);
    expect(ready).not.toHaveBeenCalled();
    expect(first.isConnected).toBe(false);

    window.CONFIG = config;
    script().dispatchEvent(new Event("load"));
    await pending;

    expect(ready).toHaveBeenCalledOnce();
    expect(script()).toBeNull();
  });

  it("bounds failed attempts and permits a later online or manual retry", async () => {
    const pending = ensureRuntimeConfig();
    const rejected = expect(pending).rejects.toThrow(
      "Runtime configuration is unavailable",
    );
    for (const delay of [250, 1_000, 0]) {
      expect(script()).not.toBeNull();
      script().dispatchEvent(new Event("error"));
      await vi.advanceTimersByTimeAsync(delay);
    }
    await rejected;
    expect(script()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    const retry = ensureRuntimeConfig();
    window.CONFIG = config;
    script().dispatchEvent(new Event("load"));
    await retry;
  });

  it("times out a stalled request and continues without reloading", async () => {
    const pending = ensureRuntimeConfig();
    const stalled = script();
    await vi.advanceTimersByTimeAsync(5_250);
    expect(stalled.isConnected).toBe(false);
    expect(script()).not.toBe(stalled);

    window.CONFIG = config;
    script().dispatchEvent(new Event("load"));
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, "", "invalid", "javascript:alert(1)"])(
    "rejects a script that leaves the collaboration URL invalid: %s",
    async (url) => {
      window.CONFIG = {
        APP_URL: config.APP_URL,
        ...(url === undefined ? {} : { COLLAB_URL: url }),
      };
      const pending = ensureRuntimeConfig();
      const rejected = expect(pending).rejects.toThrow(
        "Runtime configuration is unavailable",
      );
      for (const delay of [250, 1_000, 0]) {
        script().dispatchEvent(new Event("load"));
        await vi.advanceTimersByTimeAsync(delay);
      }
      await rejected;
    },
  );
});
