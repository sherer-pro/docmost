export const AI_SETTINGS_TABS = [
  "spaces",
  "built-in-tools",
  "external-tools",
  "guide",
] as const;

export type AiSettingsTab = (typeof AI_SETTINGS_TABS)[number];

export const AI_SETTINGS_DEFAULT_TAB: AiSettingsTab = "spaces";

export function isAiSettingsTab(
  value: string | null | undefined,
): value is AiSettingsTab {
  return (AI_SETTINGS_TABS as readonly string[]).includes(value as string);
}
