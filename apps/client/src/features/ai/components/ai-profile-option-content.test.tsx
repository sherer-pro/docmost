// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import { AiProfileOptionContent } from "./ai-profile-option-content";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

describe("AiProfileOptionContent", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
  });

  it("renders a two-level profile label and description", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <MantineProvider>
          <AiProfileOptionContent
            label="Pumpkin · v2"
            description="Reviews product strategy"
          />
        </MantineProvider>,
      );
    });

    expect(container.textContent).toContain("Pumpkin · v2");
    expect(
      container.querySelector('[data-testid="ai-profile-option-description"]')
        ?.textContent,
    ).toBe("Reviews product strategy");
  });
});
