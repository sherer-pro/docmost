import {
  builtInTagDefinitions,
  isBuiltInTagValue,
  type BuiltInTagValue,
  type TagDefinition,
} from "@docmost/editor-ext";

export interface WorkspaceTagSettings {
  disabled?: string[] | string;
}

export function normalizeDisabledTags(
  disabled?: string[] | string,
): BuiltInTagValue[] {
  const normalized = new Set<BuiltInTagValue>();
  let values: unknown = disabled ?? [];

  if (typeof values === "string") {
    try {
      values = JSON.parse(values);
    } catch {
      values = [];
    }
  }

  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") {
      continue;
    }

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
