import { atom } from "jotai";
import type { SetStateAction } from "react";
import {
  AiDocumentContext,
  AiEditorContext,
  AiActivityItem,
  AiStreamingRun,
} from "@/features/ai/types/ai.types.ts";

const aiDocumentContextBaseAtom = atom({
  value: null as AiDocumentContext | null,
});

export const aiDocumentContextAtom = atom(
  (get) => get(aiDocumentContextBaseAtom).value,
  (get, set, update: SetStateAction<AiDocumentContext | null>) => {
    const current = get(aiDocumentContextBaseAtom).value;
    set(aiDocumentContextBaseAtom, {
      value: typeof update === "function" ? update(current) : update,
    });
  },
);

export const aiStreamingRunsAtom = atom<Record<string, AiStreamingRun>>({});

export const aiLastEditorContextAtom = atom<
  Record<string, AiEditorContext | undefined>
>({});

export const aiUnreadRunsAtom = atom<Record<string, number>>({});

// Focus mode is intentionally session-only. Leaving the panel restores the
// user's persisted docked width instead of replacing that preference.
export const aiFocusModeAtom = atom(false);

export const aiActivityAtom = atom<Record<string, AiActivityItem>>({});

export const aiActiveConversationByPageAtom = atom<
  Record<string, string | null>
>({});
