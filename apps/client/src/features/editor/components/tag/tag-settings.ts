import {
  builtInTagDefinitions,
  normalizeBuiltInTagValues,
  type BuiltInTagValue,
  type TagDefinition,
} from "@docmost/editor-ext";

export interface SpaceTagSettings {
  disabled?: string[] | string;
}

export function normalizeDisabledTags(
  disabled?: string[] | string,
): BuiltInTagValue[] {
  let values: unknown = disabled ?? [];

  if (typeof values === "string") {
    try {
      values = JSON.parse(values);
    } catch {
      values = [];
    }
  }

  return normalizeBuiltInTagValues(values);
}

export function getEnabledTagDefinitions(
  settings?: SpaceTagSettings,
): readonly TagDefinition[] {
  const disabled = new Set(normalizeDisabledTags(settings?.disabled));

  return builtInTagDefinitions.filter((tag) => !disabled.has(tag.value));
}
