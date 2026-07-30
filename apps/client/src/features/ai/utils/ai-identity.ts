import type {
  AiAssistantGender,
  AiAssistantIdentity,
  AiSpaceConfigUpdate,
} from "@/features/ai/types/ai.types.ts";
import type { TFunction } from "i18next";
import { hasInvalidAiAssistantNameCharacters } from "@docmost/api-contract";

export { hasInvalidAiAssistantNameCharacters };

export type AiAssistantNamedText =
  | "title"
  | "openPanel"
  | "loadFailed"
  | "openDocument"
  | "unavailable"
  | "settings.enable";

const NAMED_TRANSLATION_KEYS: Record<AiAssistantNamedText, string> = {
  title: "ai.titleNamed",
  openPanel: "ai.openPanelNamed",
  loadFailed: "ai.loadFailedNamed",
  openDocument: "ai.openDocumentNamed",
  unavailable: "ai.unavailableNamed",
  "settings.enable": "ai.settings.enableNamed",
};

export function resolveAiAssistantName(
  t: TFunction,
  identity: AiAssistantIdentity | null | undefined,
): string {
  return resolveAiAssistantText(t, "title", identity);
}

export function resolveAiAssistantText(
  t: TFunction,
  key: AiAssistantNamedText,
  identity: AiAssistantIdentity | null | undefined,
): string {
  if (!identity?.name.trim()) {
    return t(`ai.${key}`);
  }
  return t(`${NAMED_TRANSLATION_KEYS[key]}.${identity.gender}`, {
    assistantName: identity.name,
  });
}

export function buildAiAssistantIdentityUpdate(values: {
  assistantNameEnabled: boolean;
  assistantName: string;
  assistantGender: AiAssistantGender;
}): Pick<
  AiSpaceConfigUpdate,
  "assistantNameEnabled" | "assistantName" | "assistantGender"
> {
  if (!values.assistantNameEnabled) {
    return { assistantNameEnabled: false };
  }
  return {
    assistantNameEnabled: true,
    assistantName: values.assistantName.trim(),
    assistantGender: values.assistantGender,
  };
}
