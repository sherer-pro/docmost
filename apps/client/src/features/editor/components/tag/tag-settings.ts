import {
  builtInTagDefinitions,
  isBuiltInTagValue,
  type BuiltInTagValue,
  type TagDefinition,
} from "@docmost/editor-ext";

export interface WorkspaceTagSettings {
  disabled?: string[];
}

export function normalizeDisabledTags(disabled?: string[]): BuiltInTagValue[] {
  const normalized = new Set<BuiltInTagValue>();

  for (const value of disabled ?? []) {
    const tagValue = value.trim().toLowerCase();
    if (isBuiltInTagValue(tagValue)) {
      normalized.add(tagValue);
    }
  }

  return Array.from(normalized);
}

export function getEnabledTagDefinitions(
  settings?: WorkspaceTagSettings,
): readonly TagDefinition[] {
  const disabled = new Set(normalizeDisabledTags(settings?.disabled));

  return builtInTagDefinitions.filter((tag) => !disabled.has(tag.value));
}
