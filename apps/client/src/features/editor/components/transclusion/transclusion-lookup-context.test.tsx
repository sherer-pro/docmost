// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupTransclusion } from "@/features/transclusion/services/transclusion-api";
import { TransclusionLookupProvider } from "./transclusion-lookup-context";
import { useTransclusionLookup } from "./use-transclusion-lookup";

vi.mock("@/features/transclusion/services/transclusion-api", () => ({
  lookupTransclusion: vi.fn(),
  lookupTransclusionForShare: vi.fn(),
}));

const lookup = vi.mocked(lookupTransclusion);
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Probe({
  pageId = "page-1",
  blockId = "block-1",
}: {
  pageId?: string;
  blockId?: string;
}) {
  const { result, refresh } = useTransclusionLookup(pageId, blockId);
  return (
    <>
      <span data-testid={`content-${blockId}`}>
        {result && !("status" in result) ? JSON.stringify(result.content) : ""}
      </span>
      <button data-testid={`refresh-${blockId}`} onClick={() => void refresh()}>
        refresh
      </button>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  lookup.mockReset();
  vi.useRealTimers();
});

describe("TransclusionLookupProvider", () => {
  it("retries a failed lookup while the reference remains mounted", async () => {
    lookup.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({
      items: [
        {
          sourcePageId: "page-1",
          transclusionId: "block-1",
          content: { type: "doc", content: [] },
          sourceUpdatedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
    });

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          <Probe />
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="content-block-1"]')?.textContent,
    ).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[data-testid="content-block-1"]')?.textContent,
    ).toContain('"type":"doc"');
  });

  it("batches retrying references behind one scheduler", async () => {
    lookup.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({
      items: [
        {
          sourcePageId: "page-1",
          transclusionId: "block-1",
          status: "not_found",
        },
        {
          sourcePageId: "page-2",
          transclusionId: "block-2",
          status: "not_found",
        },
      ],
    });

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          <Probe />
          <Probe pageId="page-2" blockId="block-2" />
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0].references).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls[1][0].references).toHaveLength(2);
  });

  it("does not retry terminal lookup statuses", async () => {
    lookup.mockResolvedValue({
      items: [
        {
          sourcePageId: "page-1",
          transclusionId: "block-1",
          status: "not_found",
        },
      ],
    });

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          <Probe />
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("cancels scheduled retries after the provider unmounts", async () => {
    lookup.mockRejectedValue(new Error("network"));

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          <Probe />
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("keeps cached content visible while a manual refresh is pending", async () => {
    let resolveRefresh:
      | ((value: Awaited<ReturnType<typeof lookup>>) => void)
      | undefined;
    lookup
      .mockResolvedValueOnce({
        items: [
          {
            sourcePageId: "page-1",
            transclusionId: "block-1",
            content: { type: "doc", content: [] },
            sourceUpdatedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          <Probe />
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const content = container.querySelector('[data-testid="content-block-1"]');
    expect(content?.textContent).toContain('"type":"doc"');

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="refresh-block-1"]',
        ) as HTMLButtonElement
      ).click();
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(content?.textContent).toContain('"type":"doc"');

    await act(async () => {
      resolveRefresh?.({
        items: [
          {
            sourcePageId: "page-1",
            transclusionId: "block-1",
            status: "not_found",
          },
        ],
      });
    });
  });

  it("splits 51 unique references at the API limit", async () => {
    lookup.mockImplementation(async ({ references }) => ({
      items: references.map(({ sourcePageId, transclusionId }) => ({
        sourcePageId,
        transclusionId,
        status: "not_found" as const,
      })),
    }));

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          {Array.from({ length: 51 }, (_, index) => (
            <Probe
              key={index}
              pageId={`page-${index}`}
              blockId={`block-${index}`}
            />
          ))}
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(
      lookup.mock.calls.map(([params]) => params.references.length).sort(),
    ).toEqual([1, 50]);
  });

  it("splits 120 unique references into bounded chunks", async () => {
    lookup.mockImplementation(async ({ references }) => ({
      items: references.map(({ sourcePageId, transclusionId }) => ({
        sourcePageId,
        transclusionId,
        status: "not_found" as const,
      })),
    }));

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          {Array.from({ length: 120 }, (_, index) => (
            <Probe
              key={index}
              pageId={`page-${index}`}
              blockId={`block-${index}`}
            />
          ))}
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(lookup).toHaveBeenCalledTimes(3);
    expect(
      lookup.mock.calls.map(([params]) => params.references.length).sort(),
    ).toEqual([20, 50, 50]);
  });

  it("retries only a failed chunk", async () => {
    let rejectedLargeChunk = false;
    lookup.mockImplementation(async ({ references }) => {
      if (references.length === 50 && !rejectedLargeChunk) {
        rejectedLargeChunk = true;
        throw new Error("network");
      }
      return {
        items: references.map(({ sourcePageId, transclusionId }) => ({
          sourcePageId,
          transclusionId,
          status: "not_found" as const,
        })),
      };
    });

    await act(async () => {
      root.render(
        <TransclusionLookupProvider>
          {Array.from({ length: 51 }, (_, index) => (
            <Probe
              key={index}
              pageId={`page-${index}`}
              blockId={`block-${index}`}
            />
          ))}
        </TransclusionLookupProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(lookup).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });

    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup.mock.calls[2][0].references).toHaveLength(50);
  });
});
