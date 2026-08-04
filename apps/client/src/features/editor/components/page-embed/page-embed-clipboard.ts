import type { TransclusionClipboardStorage } from "@/features/editor/extensions/transclusion-clipboard";
import type { PageEmbedLookup } from "@/features/page-template/types/page-template.types";

type AvailablePageEmbed = Exclude<PageEmbedLookup, { status: string }>;

function updateSourceResolution(
  storage: TransclusionClipboardStorage,
  sourcePageId: string,
): void {
  const occurrences = storage.pageItemOccurrences.get(sourcePageId);
  const available = occurrences
    ? Array.from(occurrences.values()).find(
        (item): item is AvailablePageEmbed => !("status" in item),
      )
    : undefined;
  if (available) storage.pageItems.set(sourcePageId, available);
  else storage.pageItems.delete(sourcePageId);
  if (occurrences?.size === 0) {
    storage.pageItemOccurrences.delete(sourcePageId);
  }
}

export function syncPageEmbedClipboardResolution(params: {
  storage: TransclusionClipboardStorage;
  sourcePageId: string;
  referenceNodeId: string;
  result: PageEmbedLookup | undefined;
  maxDepth: number | null;
}): () => void {
  const { storage, sourcePageId, referenceNodeId, result, maxDepth } = params;
  if (maxDepth !== null) storage.maxPageEmbedDepth = maxDepth;

  if (result && !("status" in result)) {
    const occurrences =
      storage.pageItemOccurrences.get(sourcePageId) ??
      new Map<string, PageEmbedLookup>();
    occurrences.set(referenceNodeId, result);
    storage.pageItemOccurrences.set(sourcePageId, occurrences);
  } else {
    storage.pageItemOccurrences.get(sourcePageId)?.delete(referenceNodeId);
  }
  updateSourceResolution(storage, sourcePageId);

  return () => {
    storage.pageItemOccurrences.get(sourcePageId)?.delete(referenceNodeId);
    updateSourceResolution(storage, sourcePageId);
  };
}
