// @vitest-environment happy-dom

import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableOfContents } from "./table-of-contents";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("@docmost/editor-ext", async () => {
  const actual = await vi.importActual<typeof import("@docmost/editor-ext")>(
    "@docmost/editor-ext",
  );
  return {
    ...actual,
    isHeadingNumberingEnabled: () => false,
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  class TestIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TableOfContents", () => {
  it.each([
    { surface: "regular page", isShare: false },
    { surface: "public page", isShare: true },
  ])(
    "scrolls on a $surface without changing or focusing the editor selection",
    async ({ isShare }) => {
      const heading = document.createElement("h2");
      heading.textContent = "Section";
      heading.getBoundingClientRect = vi.fn(() => ({ top: 500 }) as DOMRect);

      const selection = { anchor: 7 };
      const dispatch = vi.fn();
      const focus = vi.fn();
      const editor = {
        $nodes: vi.fn(() => [
          {
            node: { attrs: { level: 2 }, textContent: "Section" },
            element: heading,
          },
        ]),
        state: { selection },
        view: { dispatch, focus, state: { selection } },
        on: vi.fn(),
        off: vi.fn(),
      };
      const scrollTo = vi.fn();
      vi.stubGlobal("scrollTo", scrollTo);
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 200,
      });
      vi.spyOn(window, "getComputedStyle").mockReturnValue({
        getPropertyValue: () => "64px",
      } as unknown as CSSStyleDeclaration);

      await act(async () => {
        root.render(
          <MantineProvider>
            <TableOfContents editor={editor as any} isShare={isShare} />
          </MantineProvider>,
        );
      });

      const link = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Section",
      );
      expect(link).toBeDefined();
      act(() => link?.click());

      expect(scrollTo).toHaveBeenCalledOnce();
      expect(scrollTo).toHaveBeenCalledWith({
        top: 636,
        behavior: "smooth",
      });
      expect(editor.state.selection).toBe(selection);
      expect(dispatch).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    },
  );
});
