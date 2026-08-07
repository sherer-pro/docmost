export type AiComposerProfileOption = {
  value: string;
  label: string;
};

export type AiConversationProfileDisplay = {
  id: string | null;
  name: string | null;
  version: number | null;
  availability?: string;
};

type ResolveAiComposerProfileLabelOptions = {
  activeProfile?: AiConversationProfileDisplay | null;
  assistantProfileId: string | null;
  options: AiComposerProfileOption[];
  spaceAssistantLabel: string;
  unavailableLabel: string;
};

export const AI_LEGACY_SPACE_PROFILE_VALUE = "__legacy_space__";

export function resolveAiComposerProfileLabel({
  activeProfile,
  assistantProfileId,
  options,
  spaceAssistantLabel,
  unavailableLabel,
}: ResolveAiComposerProfileLabelOptions): string {
  const currentValue = assistantProfileId ?? AI_LEGACY_SPACE_PROFILE_VALUE;
  const activeValue = activeProfile?.id ?? AI_LEGACY_SPACE_PROFILE_VALUE;

  if (activeProfile && currentValue === activeValue) {
    if (!activeProfile.id) return spaceAssistantLabel;
    const unavailableSuffix =
      activeProfile.availability === "available"
        ? ""
        : ` · ${unavailableLabel}`;
    return `${activeProfile.name ?? unavailableLabel} · v${
      activeProfile.version ?? "?"
    }${unavailableSuffix}`;
  }

  return (
    options.find((option) => option.value === currentValue)?.label ??
    spaceAssistantLabel
  );
}
