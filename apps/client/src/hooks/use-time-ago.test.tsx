// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimeAgo } from "./use-time-ago";

vi.mock("@/i18n.ts", () => ({ default: { language: "en-US" } }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.useRealTimers());
describe("useTimeAgo", () => {
  it("refreshes immediately on language and date changes and releases its timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const i18n = createInstance();
    await i18n.init({
      lng: "en-US",
      resources: { "en-US": { translation: {} }, "ru-RU": { translation: {} } },
      react: { useSuspense: false },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const date = "2026-11-02T11:58:00Z";
    function Time({ value }: { value: string }) {
      return <span>{useTimeAgo(value)}</span>;
    }
    const render = (value: string) =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <Time value={value} />
        </I18nextProvider>,
      );
    try {
      act(() => render(date));
      expect(container.textContent).toBe("2 minutes ago");
      await act(async () => {
        await i18n.changeLanguage("ru-RU");
      });
      expect(container.textContent).toBe("2 минуты назад");
      act(() => render("2026-11-02T11:59:00Z"));
      expect(container.textContent).toBe("1 минуту назад");
      act(() => vi.advanceTimersByTime(60_000));
      expect(container.textContent).toBe("2 минуты назад");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
