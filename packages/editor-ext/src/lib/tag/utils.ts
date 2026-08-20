export type BuiltInTagValue =
  | 'tbd'
  | 'todo'
  | 'done'
  | 'core'
  | 'future'
  | 'pilot';
export type TagValue = string;
export type TagColor =
  | 'red'
  | 'blue'
  | 'green'
  | 'violet'
  | 'cyan'
  | 'orange'
  | 'gray';

export interface TagDefinition {
  value: BuiltInTagValue;
  label: string;
  color: Exclude<TagColor, 'gray'>;
  titleKey: string;
  descriptionKey: string;
  menuDescriptionKey: string;
  searchTerms: readonly string[];
}

export const builtInTagDefinitions = [
  {
    value: 'tbd',
    label: 'TBD',
    color: 'red',
    titleKey: 'Tag TBD',
    descriptionKey: 'Tag TBD description',
    menuDescriptionKey: 'Mark text that needs clarification.',
    searchTerms: ['tag', 'tbd', 'clarify', 'needs clarification'],
  },
  {
    value: 'todo',
    label: 'TODO',
    color: 'blue',
    titleKey: 'Tag TODO',
    descriptionKey: 'Tag TODO description',
    menuDescriptionKey: 'Mark text that needs follow-up.',
    searchTerms: ['tag', 'todo', 'follow up', 'follow-up'],
  },
  {
    value: 'done',
    label: 'DONE',
    color: 'green',
    titleKey: 'Tag DONE',
    descriptionKey: 'Tag DONE description',
    menuDescriptionKey: 'Mark text that is resolved or completed.',
    searchTerms: ['tag', 'done', 'complete', 'completed', 'resolved'],
  },
  {
    value: 'core',
    label: 'Core',
    color: 'violet',
    titleKey: 'Tag Core',
    descriptionKey: 'Tag Core description',
    menuDescriptionKey: 'Mark foundational or essential content.',
    searchTerms: ['tag', 'core', 'foundation', 'foundational', 'essential'],
  },
  {
    value: 'future',
    label: 'Future',
    color: 'cyan',
    titleKey: 'Tag Future',
    descriptionKey: 'Tag Future description',
    menuDescriptionKey: 'Mark content planned for a future phase.',
    searchTerms: ['tag', 'future', 'later', 'planned', 'roadmap'],
  },
  {
    value: 'pilot',
    label: 'Pilot',
    color: 'orange',
    titleKey: 'Tag Pilot',
    descriptionKey: 'Tag Pilot description',
    menuDescriptionKey: 'Mark experimental or pilot content.',
    searchTerms: ['tag', 'pilot', 'experiment', 'experimental', 'prototype'],
  },
] as const satisfies readonly TagDefinition[];

export const builtInTagValues = builtInTagDefinitions.map(
  (tag) => tag.value,
) as BuiltInTagValue[];

const tagValueRegex = /^[a-z][a-z0-9_-]{0,31}$/;

export function isSafeTagValue(value?: string | null): value is string {
  return tagValueRegex.test(value ?? '');
}

export function getValidTagValue(value?: string | null): TagValue {
  const normalized = value?.trim().toLowerCase();

  return isSafeTagValue(normalized) ? normalized : 'todo';
}

export function isBuiltInTagValue(
  value?: string | null,
): value is BuiltInTagValue {
  const normalized = value?.trim().toLowerCase();

  return (
    isSafeTagValue(normalized) &&
    builtInTagValues.includes(normalized as BuiltInTagValue)
  );
}

export function normalizeBuiltInTagValues(values: unknown): BuiltInTagValue[] {
  const normalized = new Set<BuiltInTagValue>();

  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue;
    const tagValue = value.trim().toLowerCase();
    if (isBuiltInTagValue(tagValue)) normalized.add(tagValue);
  }

  return Array.from(normalized);
}

export function getBuiltInTagDefinition(
  value?: string | null,
): TagDefinition | undefined {
  const normalized = getValidTagValue(value);
  return builtInTagDefinitions.find((tag) => tag.value === normalized);
}

export function getTagLabel(value?: string | null): string {
  const normalized = getValidTagValue(value);
  return getBuiltInTagDefinition(normalized)?.label ?? normalized.toUpperCase();
}

export function getTagColor(value?: string | null): TagColor {
  return getBuiltInTagDefinition(value)?.color ?? 'gray';
}
