// @vitest-environment happy-dom

import { MantineProvider } from "@mantine/core";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
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
  it("reads the current editor immediately and follows document changes", async () => {
    const createEditor = (content: string) =>
      new Editor({ editable: false, extensions: [StarterKit], content });
    const preview = createEditor("<h2>Preview heading</h2>");
    const live = createEditor("<h2>Live heading</h2>");
    const nextPage = createEditor("<p>Page without headings</p>");
    const render = (editor: Editor | null) =>
      act(async () => {
        root.render(
          <MantineProvider>
            <TableOfContents editor={editor} />
          </MantineProvider>,
        );
      });
    const headingLabels = () =>
      Array.from(
        container.querySelectorAll("button"),
        (item) => item.textContent,
      );

    try {
      await render(null);
      expect(headingLabels()).toEqual([]);

      await render(preview);
      expect(headingLabels()).toEqual(["Preview heading"]);

      await render(live);
      expect(headingLabels()).toEqual(["Live heading"]);

      act(() => {
        preview.commands.setContent("<h2>Stale heading</h2>");
      });
      expect(headingLabels()).toEqual(["Live heading"]);

      act(() => {
        live.commands.setContent(
          "<h2>Updated heading</h2><h3>New heading</h3>",
        );
      });
      expect(headingLabels()).toEqual(["Updated heading", "New heading"]);

      await render(nextPage);
      expect(headingLabels()).toEqual([]);
      expect(container.textContent).toContain("Add headings (H1, H2, H3)");
    } finally {
      await render(null);
      [preview, live, nextPage].forEach((editor) => editor.destroy());
    }
  });

  it("does not read headings from an unmounted shared editor", async () => {
    const editor = {
      isDestroyed: true,
      $nodes: vi.fn(() => {
        throw new Error("The editor view is not mounted");
      }),
      on: vi.fn(),
      off: vi.fn(),
    };

    await act(async () => {
      root.render(
        <MantineProvider>
          <TableOfContents editor={editor as any} isShare />
        </MantineProvider>,
      );
    });

    expect(editor.$nodes).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No table of contents.");
  });

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
