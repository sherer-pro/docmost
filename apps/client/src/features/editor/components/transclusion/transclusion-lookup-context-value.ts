import { createContext } from "react";
import type { TransclusionLookup } from "@/features/transclusion/types/transclusion.types";

export type LookupKey = string; // `${sourcePageId}::${transclusionId}`

export type Subscriber = {
  key: LookupKey;
  sourcePageId: string;
  transclusionId: string;
  setResult: (r: TransclusionLookup) => void;
};

export type ContextValue = {
  /** Register a subscriber. Returns an unsubscribe function. */
  subscribe: (s: Subscriber) => () => void;
  /**
   * Force a re-fetch of `key` and resolve when the response arrives (or the
   * request fails). Bypasses the cache and any in-flight de-dup so the user
   * always sees a fresh server read.
   */
  refresh: (key: LookupKey) => Promise<void>;
};

export const TransclusionLookupContext = createContext<ContextValue | null>(
  null,
);
