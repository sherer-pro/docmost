import { useCallback, useContext, useEffect, useState } from "react";
import type { TransclusionLookup } from "@/features/transclusion/types/transclusion.types";
import { TransclusionLookupContext } from "./transclusion-lookup-context-value";

export function useTransclusionLookup(
  sourcePageId: string | null | undefined,
  transclusionId: string | null | undefined,
): {
  result: TransclusionLookup | null;
  refresh: () => Promise<void>;
} {
  const ctx = useContext(TransclusionLookupContext);
  const [result, setResult] = useState<TransclusionLookup | null>(null);

  useEffect(() => {
    if (!ctx || !sourcePageId || !transclusionId) return;
    const key = `${sourcePageId}::${transclusionId}`;
    const unsubscribe = ctx.subscribe({
      key,
      sourcePageId,
      transclusionId,
      setResult,
    });
    return unsubscribe;
  }, [ctx, sourcePageId, transclusionId]);

  const refresh = useCallback(async () => {
    if (!ctx || !sourcePageId || !transclusionId) return;
    await ctx.refresh(`${sourcePageId}::${transclusionId}`);
  }, [ctx, sourcePageId, transclusionId]);

  return { result, refresh };
}
