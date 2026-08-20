// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMENT_PREFETCH_ROOT_MARGIN,
  useLazyCommentTrigger,
} from "./use-lazy-comment-trigger";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let observerCallback: IntersectionObserverCallback;
const disconnect = vi.fn();

function Probe({ activeCommentId }: { activeCommentId?: string }) {
  const { targetRef, shouldLoad } = useLazyCommentTrigger(activeCommentId);
  return (
    <div ref={targetRef} data-testid="probe">
      {shouldLoad ? "loaded" : "deferred"}
    </div>
  );
}

beforeEach(() => {
  disconnect.mockClear();
  class TestIntersectionObserver {
    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      observerCallback = callback;
      expect(options?.rootMargin).toBe(COMMENT_PREFETCH_ROOT_MARGIN);
    }

    observe = vi.fn();
    disconnect = disconnect;
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = COMMENT_PREFETCH_ROOT_MARGIN;
    thresholds = [0];
  }
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("defers loading until the comments section approaches the viewport", () => {
  act(() => root.render(<Probe />));
  expect(container.textContent).toBe("deferred");

  act(() =>
    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );

  expect(container.textContent).toBe("loaded");
});

it("loads immediately when navigating to a concrete comment", () => {
  act(() => root.render(<Probe activeCommentId="comment-1" />));
  expect(container.textContent).toBe("loaded");
});
