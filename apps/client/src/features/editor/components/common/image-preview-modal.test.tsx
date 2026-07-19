// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  }: {
    opened: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    classNames: { root?: string; content?: string; body?: string };
    size: string;
    xOffset: string;
    yOffset: string;
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
      >
        <header>{title}</header>
        {children}
      </section>
    ) : null,
}));

describe("ImagePreviewModal", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
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
    expect(container.querySelector('img[alt="Preview content"]')).not.toBeNull();

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
});
