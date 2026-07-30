export interface AiLocalDraft {
  text: string;
  useSpaceSearch: boolean;
  agentMode: boolean;
}

export function getAiLocalDraftKey(
  workspaceId: string,
  userId: string,
  pageId: string,
): string {
  return `docmost:ai-draft:${workspaceId}:${userId}:${pageId}`;
}

export function readAiLocalDraft(
  storage: Pick<Storage, "getItem">,
  key: string,
): AiLocalDraft | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.text !== "string" ||
      typeof record.useSpaceSearch !== "boolean" ||
      typeof record.agentMode !== "boolean"
    ) {
      return null;
    }
    return {
      text: record.text,
      useSpaceSearch: record.useSpaceSearch,
      agentMode: record.agentMode,
    };
  } catch {
    return null;
  }
}

export function writeAiLocalDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  draft: AiLocalDraft,
): void {
  if (!draft.text && !draft.useSpaceSearch && !draft.agentMode) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(draft));
}
