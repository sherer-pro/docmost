// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransclusionContent from "./transclusion-content";
import { useTransclusionViewport } from "./use-transclusion-viewport";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";

const extensions = [Document, Paragraph, Text];

function TestTransclusionContent(
  props: Omit<ComponentProps<typeof TransclusionContent>, "extensions">,
) {
  return <TransclusionContent {...props} extensions={extensions} />;
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Synced content" }],
    },
  ],
};

describe("TransclusionContent", () => {
  it("does not mount a nested editor outside the render window", () => {
    act(() => {
      root.render(
        <TestTransclusionContent content={content} renderEditor={false} />,
      );
    });

    expect(container.querySelector(".ProseMirror")).toBeNull();
  });

  it("preserves the measured height when the nested editor unmounts", async () => {
    class TestResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { height: 144 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }

      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    await act(async () => {
      root.render(<TestTransclusionContent content={content} />);
    });
    await act(async () => {
      root.render(
        <TestTransclusionContent content={content} renderEditor={false} />,
      );
    });

    expect((container.firstElementChild as HTMLElement).style.height).toBe(
      "144px",
    );
  });

  it("remounts the nested editor when the lookup version changes", async () => {
    await act(async () => {
      root.render(
        <TestTransclusionContent content={content} version="before" />,
      );
    });
    expect(container.querySelector(".ProseMirror")?.textContent).toBe(
      "Synced content",
    );

    await act(async () => {
      root.render(
        <TestTransclusionContent
          content={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Updated synced content" }],
              },
            ],
          }}
          version="after"
        />,
      );
    });

    expect(container.querySelector(".ProseMirror")?.textContent).toBe(
      "Updated synced content",
    );
  });

  it("isolates the mouse selection lifecycle from the host editor", async () => {
    await act(async () => {
      root.render(
        <div data-host-editor>
          <TestTransclusionContent content={content} />
        </div>,
      );
    });

    const host = container.querySelector("[data-host-editor]")!;
    const onHostMouseDown = vi.fn();
    const onHostMouseMove = vi.fn();
    const onHostMouseUp = vi.fn();
    host.addEventListener("mousedown", onHostMouseDown);
    host.addEventListener("mousemove", onHostMouseMove);
    host.addEventListener("mouseup", onHostMouseUp);

    const paragraph = container.querySelector(".ProseMirror p")!;
    for (const type of ["mousedown", "mousemove", "mouseup"]) {
      paragraph.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    expect(onHostMouseDown).not.toHaveBeenCalled();
    expect(onHostMouseMove).not.toHaveBeenCalled();
    expect(onHostMouseUp).not.toHaveBeenCalled();
  });

  it("lets editor drags bubble but isolates file drops", () => {
    const onDragOver = vi.fn();
    act(() => {
      root.render(
        <div onDragOver={onDragOver}>
          <TestTransclusionContent content={content} renderEditor={false} />
        </div>,
      );
    });
    const transclusion = container.firstElementChild!
      .firstElementChild as HTMLElement;

    const editorDrag = new Event("dragover", { bubbles: true });
    Object.defineProperty(editorDrag, "dataTransfer", {
      value: { types: ["text/html", "text/plain"] },
    });
    transclusion.dispatchEvent(editorDrag);
    expect(onDragOver).toHaveBeenCalledTimes(1);

    const fileDrag = new Event("dragover", { bubbles: true });
    Object.defineProperty(fileDrag, "dataTransfer", {
      value: { types: ["Files"] },
    });
    transclusion.dispatchEvent(fileDrag);
    expect(onDragOver).toHaveBeenCalledTimes(1);
  });
});

describe("useTransclusionViewport", () => {
  it("observes references with a 1000px overscan", async () => {
    let callback: IntersectionObserverCallback | undefined;
    let observed: Element | undefined;
    let options: IntersectionObserverInit | undefined;
    class TestIntersectionObserver {
      constructor(
        cb: IntersectionObserverCallback,
        init?: IntersectionObserverInit,
      ) {
        callback = cb;
        options = init;
      }

      observe(target: Element) {
        observed = target;
      }

      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "1000px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

    function Probe() {
      const { viewportRef, isNearViewport } = useTransclusionViewport();
      return (
        <div ref={viewportRef} data-near={isNearViewport ? "true" : "false"} />
      );
    }

    await act(async () => root.render(<Probe />));
    expect(options?.rootMargin).toBe("1000px 0px");
    expect(container.firstElementChild?.getAttribute("data-near")).toBe(
      "false",
    );

    await act(async () => {
      callback?.(
        [
          {
            target: observed!,
            isIntersecting: true,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(container.firstElementChild?.getAttribute("data-near")).toBe("true");
  });
});
