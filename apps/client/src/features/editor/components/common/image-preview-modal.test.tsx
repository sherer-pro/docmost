// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewModal } from "./image-preview-modal";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@mantine/core", () => ({
  Modal: ({
    opened,
    title,
    children,
    classNames,
    size,
    xOffset,
    yOffset,
    closeButtonProps,
  }: {
    opened: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    classNames: { root?: string; content?: string; body?: string };
    size: string;
    xOffset: string;
    yOffset: string;
    closeButtonProps: { "aria-label": string };
  }) =>
    opened ? (
      <section
        data-testid="preview-modal"
        data-root-class={classNames.root}
        data-content-class={classNames.content}
        data-body-class={classNames.body}
        data-size={size}
        data-x-offset={xOffset}
        data-y-offset={yOffset}
        data-close-label={closeButtonProps["aria-label"]}
      >
        <header>{title}</header>
        {children}
      </section>
    ) : null,
}));

vi.mock("@/components/ui/accessible-action-icon", () => ({
  AccessibleActionIcon: ({ label, children, onClick, disabled }: any) => (
    <button aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ImagePreviewModal", () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("renders media in the shared viewport only while opened", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ImagePreviewModal opened onClose={() => undefined} title="Preview">
          <img src="/preview.png" alt="Preview content" />
        </ImagePreviewModal>,
      );
    });

    const modal = container.querySelector('[data-testid="preview-modal"]');
    expect(modal?.textContent).toContain("Preview");
    expect(modal?.getAttribute("data-root-class")).toBeTruthy();
    expect(modal?.getAttribute("data-content-class")).toBeTruthy();
    expect(modal?.getAttribute("data-body-class")).toBeTruthy();
    expect(modal?.getAttribute("data-size")).toBe(
      "calc(100vw - var(--image-preview-modal-offset))",
    );
    expect(modal?.getAttribute("data-x-offset")).toBe(
      "var(--image-preview-modal-gutter)",
    );
    expect(modal?.getAttribute("data-y-offset")).toBe(
      "var(--image-preview-modal-gutter)",
    );
    expect(modal?.getAttribute("data-close-label")).toBe("Cancel");
    expect(
      container.querySelector('img[alt="Preview content"]'),
    ).not.toBeNull();

    act(() => {
      root.render(
        <ImagePreviewModal
          opened={false}
          onClose={() => undefined}
          title="Preview"
        >
          <img src="/preview.png" alt="Preview content" />
        </ImagePreviewModal>,
      );
    });

    expect(container.querySelector('[data-testid="preview-modal"]')).toBeNull();
    act(() => root.unmount());
  });

  it("zooms with buttons, modified wheel and keyboard and resets after reopening", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (opened: boolean) =>
      act(() =>
        root.render(
          <ImagePreviewModal
            opened={opened}
            onClose={() => undefined}
            title="Preview"
          >
            <img src="/preview.png" alt="Preview content" />
          </ImagePreviewModal>,
        ),
      );
    render(true);
    const viewport = container.querySelector(
      '[role="region"]',
    ) as HTMLDivElement;
    viewport.getBoundingClientRect = () =>
      ({ width: 400, height: 300, left: 0, top: 0 }) as DOMRect;
    const button = (label: string) =>
      container!.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
    const scale = () => container!.querySelector("output")?.textContent;
    expect(button("Zoom out").disabled).toBe(true);
    act(() => button("Zoom in").click());
    expect(scale()).toBe("125%");
    act(() => button("Zoom out").click());
    expect(scale()).toBe("100%");

    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -50,
        clientX: 200,
        clientY: 150,
        ...init,
      });
      act(() => viewport.dispatchEvent(event));
      return event.defaultPrevented;
    };
    expect(wheel({})).toBe(false);
    expect(scale()).toBe("100%");
    expect(wheel({ altKey: true })).toBe(true);
    expect(Number.parseInt(scale()!)).toBeGreaterThan(100);
    act(() => button("Reset zoom").click());
    expect(wheel({ ctrlKey: true })).toBe(true);
    expect(Number.parseInt(scale()!)).toBeGreaterThan(100);
    act(() =>
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", bubbles: true }),
      ),
    );
    expect(scale()).toBe("100%");
    act(() =>
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", { key: "+", bubbles: true }),
      ),
    );
    expect(scale()).toBe("125%");
    for (let i = 0; i < 20; i++) act(() => button("Zoom in").click());
    expect(scale()).toBe("800%");
    expect(button("Zoom in").disabled).toBe(true);
    render(false);
    render(true);
    expect(scale()).toBe("100%");
    act(() => root.unmount());
  });

  it("pinches and pans with captured pointers and stops on cancellation", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ImagePreviewModal opened onClose={() => undefined} title="Diagram">
          <div>
            <svg viewBox="0 0 800 600" />
          </div>
        </ImagePreviewModal>,
      ),
    );
    const viewport = container.querySelector(
      '[role="region"]',
    ) as HTMLDivElement;
    viewport.getBoundingClientRect = () =>
      ({ width: 400, height: 300, left: 0, top: 0 }) as DOMRect;
    viewport.setPointerCapture = vi.fn();
    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
      });
      Object.defineProperties(event, {
        pointerId: { value: id },
        pointerType: { value: "touch" },
      });
      act(() => viewport.dispatchEvent(event));
    };
    pointer("pointerdown", 1, 150, 150);
    pointer("pointerdown", 2, 250, 150);
    pointer("pointermove", 2, 350, 150);
    expect(container.querySelector("output")?.textContent).toBe("200%");
    pointer("pointerup", 2, 350, 150);
    pointer("pointermove", 1, 190, 170);
    const media = viewport.firstElementChild as HTMLElement;
    expect(media.style.transform).toBe("translate(90px, 20px) scale(2)");
    pointer("pointercancel", 1, 190, 170);
    pointer("pointermove", 1, 300, 200);
    expect(media.style.transform).toBe("translate(90px, 20px) scale(2)");
    expect(viewport.hasAttribute("data-dragging")).toBe(false);
    act(() => root.unmount());
  });
});
