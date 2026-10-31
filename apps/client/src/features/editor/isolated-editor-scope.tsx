import type { ReactNode } from "react";
import { ScopeProvider } from "jotai-scope";
import {
  activePageUsersAtom,
  pageEditorAtom,
  pageEditorUnsyncedChangesAtom,
  readOnlyEditorAtom,
  titleEditorAtom,
  yjsConnectionStatusAtom,
} from "./atoms/editor-atoms";
import { searchAndReplaceStateAtom } from "./components/search-and-replace/atoms/search-and-replace-state-atom";
import {
  activeCommentIdAtom,
  draftCommentIdAtom,
  draftCommentRangeAtom,
  showCommentPopupAtom,
} from "@/features/comment/atoms/comment-atom";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  diffCountsAtom,
  highlightChangesAtom,
  historyAtoms,
} from "@/features/page-history/atoms/history-atoms";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { databaseAiContextAtom } from "@/features/database/atoms/database-ai-context-atom";
import { EditorIsolationContext } from "./editor-isolation-context";

const editorAtoms = [
  pageEditorAtom,
  titleEditorAtom,
  readOnlyEditorAtom,
  yjsConnectionStatusAtom,
  pageEditorUnsyncedChangesAtom,
  activePageUsersAtom,
  searchAndReplaceStateAtom,
  activeCommentIdAtom,
  draftCommentIdAtom,
  draftCommentRangeAtom,
  showCommentPopupAtom,
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  diffCountsAtom,
  highlightChangesAtom,
  historyAtoms,
  asideStateAtom,
  databaseAiContextAtom,
];

export function IsolatedEditorScope({ children }: { children: ReactNode }) {
  return (
    <ScopeProvider atoms={editorAtoms}>
      <EditorIsolationContext.Provider value>
        {children}
      </EditorIsolationContext.Provider>
    </ScopeProvider>
  );
}
