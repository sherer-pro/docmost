// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupPageEmbeds } from "@/features/page-template/services/page-template-api";
import {
  PageEmbedLookupProvider,
  usePageEmbedLookup,
} from "./page-embed-lookup-context";

vi.mock("jotai", () => ({ useAtomValue: () => null }));
vi.mock("@/features/websocket/atoms/socket-atom", () => ({ socketAtom: {} }));
vi.mock("@/features/page-template/services/page-template-api", () => ({
  lookupPageEmbeds: vi.fn(),
}));

const lookup = vi.mocked(lookupPageEmbeds);
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

function text(testId: string): string {
  return (
    container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ""
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(sourcePageId: string, title: string) {
  return {
    items: [
      {
        kind: "page" as const,
        sourcePageId,
        slugId: sourcePageId,
        title,
        icon: null,
        content: { type: "doc", content: [] },
        sourceUpdatedAt: "2026-08-04T00:00:00.000Z",
      },
    ],
    maxDepth: 4,
  };
}

function Probe({ sourcePageId }: { sourcePageId: string }) {
  const { result, maxDepth } = usePageEmbedLookup(sourcePageId);
  return (
    <div>
      <span data-testid="title">
        {result && !("status" in result) ? result.title : ""}
      </span>
      <span data-testid="status">
        {result && "status" in result ? result.status : ""}
      </span>
      <span data-testid="depth">{maxDepth ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  lookup.mockReset();
});

describe("PageEmbedLookupProvider cache isolation", () => {
  it("ignores a delayed response from the previous consumer context", async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    lookup
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      root.render(
        <PageEmbedLookupProvider referencePageId="consumer-a">
          <Probe sourcePageId="source" />
        </PageEmbedLookupProvider>,
      );
    });
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));

    await act(async () => {
      root.render(
        <PageEmbedLookupProvider referencePageId="consumer-b">
          <Probe sourcePageId="source" />
        </PageEmbedLookupProvider>,
      );
    });
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(response("source", "Consumer B")));
    await waitFor(() => expect(text("title")).toBe("Consumer B"));

    await act(async () =>
      first.resolve(response("source", "Stale consumer A")),
    );
    await waitFor(() => expect(text("title")).toBe("Consumer B"));
    expect(text("depth")).toBe("4");
  });

  it("clears prior content on invalidation and a failed refresh", async () => {
    lookup
      .mockResolvedValueOnce(response("source", "Previously readable"))
      .mockRejectedValueOnce(new Error("network"));
    await act(async () => {
      root.render(
        <PageEmbedLookupProvider shareId="share-a" referencePageId="consumer-a">
          <Probe sourcePageId="source" />
        </PageEmbedLookupProvider>,
      );
    });
    await waitFor(() => expect(text("title")).toBe("Previously readable"));

    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(text("title")).toBe(""));
  });

  it("replaces readable data with a neutral unavailable result", async () => {
    lookup
      .mockResolvedValueOnce(response("source", "Secret"))
      .mockResolvedValueOnce({
        items: [{ kind: "page", sourcePageId: "source", status: "no_access" }],
        maxDepth: 4,
      });
    await act(async () => {
      root.render(
        <PageEmbedLookupProvider referencePageId="consumer-a">
          <Probe sourcePageId="source" />
        </PageEmbedLookupProvider>,
      );
    });
    await waitFor(() => expect(text("title")).toBe("Secret"));

    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(text("status")).toBe("no_access"));
    expect(text("title")).toBe("");
  });
});
