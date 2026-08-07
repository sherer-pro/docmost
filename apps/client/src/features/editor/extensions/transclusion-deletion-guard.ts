import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isChangeOrigin } from "@tiptap/extension-collaboration";

export type TransclusionSourceState =
  | "unknown"
  | "unreferenced"
  | "referenced"
  | "error";

export interface TransclusionDeletionGuardStorage {
  sourceStates: Map<string, TransclusionSourceState>;
}

interface TransclusionDeletionGuardOptions {
  onBlocked: (reason: "referenced" | "unknown") => void;
}

declare module "@tiptap/core" {
  interface Storage {
    transclusionDeletionGuard: TransclusionDeletionGuardStorage;
  }
}

export const TransclusionDeletionGuard = Extension.create<
  TransclusionDeletionGuardOptions,
  TransclusionDeletionGuardStorage
>({
  name: "transclusionDeletionGuard",

  addOptions() {
    return {
      onBlocked: () => undefined,
    };
  },

  addStorage() {
    return {
      sourceStates: new Map(),
    };
  },

  addProseMirrorPlugins() {
    const sourceStates = this.storage.sourceStates;
    const onBlocked = this.options.onBlocked;

    return [
      new Plugin({
        key: new PluginKey("transclusionDeletionGuard"),
        filterTransaction(transaction, state) {
          if (!transaction.docChanged || isChangeOrigin(transaction)) {
            return true;
          }

          const nextSourceIds = collectTransclusionSourceIds(transaction.doc);
          let blockedReason: "referenced" | "unknown" | null = null;

          state.doc.descendants((node) => {
            if (blockedReason === "referenced") return false;
            if (node.type.name !== "transclusionSource") return;

            const id = node.attrs.id;
            if (typeof id !== "string" || nextSourceIds.has(id)) return;

            const sourceState = sourceStates.get(id) ?? "unknown";
            if (sourceState === "unreferenced") return;

            blockedReason =
              sourceState === "referenced" ? "referenced" : "unknown";
          });

          if (!blockedReason) return true;

          queueMicrotask(() => onBlocked(blockedReason!));
          return false;
        },
      }),
    ];
  },
});

function collectTransclusionSourceIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name !== "transclusionSource") return;
    const id = node.attrs.id;
    if (typeof id === "string") ids.add(id);
  });
  return ids;
}
