import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { aiDocumentContextAtom } from "@/features/ai/atoms/ai-atoms.ts";
import { useAiSpaceStatusQuery } from "@/features/ai/queries/ai-query.ts";
import {
  AiAssistantNamedText,
  resolveAiAssistantName,
  resolveAiAssistantText,
} from "@/features/ai/utils/ai-identity.ts";

export function useAiAssistantIdentity(
  spaceId?: string,
  pageId?: string,
) {
  const { t } = useTranslation();
  const documentContext = useAtomValue(aiDocumentContextAtom);
  const resolvedSpaceId = spaceId ?? documentContext?.spaceId;
  const resolvedPageId =
    pageId ??
    (documentContext?.spaceId === resolvedSpaceId
      ? documentContext.pageId
      : undefined);
  const statusQuery = useAiSpaceStatusQuery(resolvedSpaceId, resolvedPageId);
  const identity = statusQuery.data?.assistantIdentity ?? null;

  return {
    identity,
    name: resolveAiAssistantName(t, identity),
    text: (key: AiAssistantNamedText) =>
      resolveAiAssistantText(t, key, identity),
  };
}
