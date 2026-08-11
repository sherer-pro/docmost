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

export function resolveActiveAiComposerProfileOptionLabel(
  activeProfile: { name?: string | null; version?: number | null },
  liveProfile: { name: string; version: number },
): string {
  return `${activeProfile.name ?? liveProfile.name} · v${activeProfile.version ?? liveProfile.version}`;
}

export function shouldShowUnavailableAiComposerProfileOption(
  activeProfileId: string | null | undefined,
  liveAvailableProfileIds: readonly string[],
): boolean {
  return Boolean(
    activeProfileId && !liveAvailableProfileIds.includes(activeProfileId),
  );
}

export function shouldShowHiddenActiveAiComposerProfileOption(
  activeProfileId: string | null | undefined,
  liveAvailableProfileIds: readonly string[],
  visibleProfileIds: readonly string[],
): boolean {
  return Boolean(
    activeProfileId &&
      liveAvailableProfileIds.includes(activeProfileId) &&
      !visibleProfileIds.includes(activeProfileId),
  );
}

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
