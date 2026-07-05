export type TagValue = 'tbd' | 'todo';

const validTagValues = ['tbd', 'todo'];

export function getValidTagValue(value?: string | null): TagValue {
  const normalized = value?.toLowerCase();

  return validTagValues.includes(normalized ?? '')
    ? (normalized as TagValue)
    : 'todo';
}

export function getTagLabel(value?: string | null): string {
  return getValidTagValue(value).toUpperCase();
}
