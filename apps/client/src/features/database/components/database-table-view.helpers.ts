import { DatabasePropertyType } from '@docmost/api-contract';

const hasEmptyUserReference = (value: unknown): boolean => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    !(value as { id?: string }).id
  );
};

export const shouldDeleteCellPayload = (
  propertyType: DatabasePropertyType,
  normalizedValue: unknown,
): boolean => {
  return (
    propertyType !== 'checkbox' &&
    (normalizedValue === null || normalizedValue === '' || hasEmptyUserReference(normalizedValue))
  );
};

export const isSameCellPayloadValue = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }

  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

export const isDatabaseFilterControlsVisible = (isMobileViewport: boolean): boolean => {
  return !isMobileViewport;
};

export const getCheckboxFilterOptions = (
  t: (key: string) => string,
): Array<{ value: 'true' | 'false'; label: string }> => {
  return [
    { value: 'true', label: t('Checked') },
    { value: 'false', label: t('Unchecked') },
  ];
};

export const resolveDatabasePropertyRename = (
  currentName: string,
  draftName: string,
): string | null => {
  const nextName = draftName.trim();
  if (!nextName || nextName === currentName) {
    return null;
  }

  return nextName;
};
