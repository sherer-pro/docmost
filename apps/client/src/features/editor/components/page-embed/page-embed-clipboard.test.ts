import { describe, expect, it } from "vitest";
import type { TransclusionClipboardStorage } from "../../extensions/transclusion-clipboard";
import { syncPageEmbedClipboardResolution } from "./page-embed-clipboard";

function storage(): TransclusionClipboardStorage {
  return {
    items: new Map(),
    pageItems: new Map(),
    pageItemOccurrences: new Map(),
    maxPageEmbedDepth: 5,
  };
}

const available = {
  kind: "page" as const,
  sourcePageId: "source-page",
  slugId: "source",
  title: "Secret title",
  icon: null,
  content: { type: "doc", content: [] },
  sourceUpdatedAt: "2026-08-04T00:00:00.000Z",
};

describe("page embed clipboard resolution", () => {
  it("removes cached content when a lookup becomes unavailable", () => {
    const value = storage();
    const cleanup = syncPageEmbedClipboardResolution({
      storage: value,
      sourcePageId: available.sourcePageId,
      referenceNodeId: "occurrence",
      result: available,
      maxDepth: 3,
    });
    expect(value.pageItems.get(available.sourcePageId)).toBe(available);
    expect(value.maxPageEmbedDepth).toBe(3);

    cleanup();
    syncPageEmbedClipboardResolution({
      storage: value,
      sourcePageId: available.sourcePageId,
      referenceNodeId: "occurrence",
      result: {
        kind: "page",
        sourcePageId: available.sourcePageId,
        status: "no_access",
      },
      maxDepth: 3,
    });

    expect(value.pageItems.has(available.sourcePageId)).toBe(false);
    expect(value.pageItemOccurrences.has(available.sourcePageId)).toBe(false);
  });

  it("removes the last occurrence on unmount or network failure", () => {
    const value = storage();
    const cleanup = syncPageEmbedClipboardResolution({
      storage: value,
      sourcePageId: available.sourcePageId,
      referenceNodeId: "occurrence",
      result: available,
      maxDepth: null,
    });

    cleanup();

    expect(value.pageItems.size).toBe(0);
    expect(value.pageItemOccurrences.size).toBe(0);
  });
});
