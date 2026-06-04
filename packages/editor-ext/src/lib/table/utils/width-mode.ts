export const TABLE_WIDTH_MODES = ['normal', 'wide', 'full'] as const;

export type TableWidthMode = (typeof TABLE_WIDTH_MODES)[number];

export function normalizeTableWidthMode(value: unknown): TableWidthMode {
  return TABLE_WIDTH_MODES.includes(value as TableWidthMode)
    ? (value as TableWidthMode)
    : 'normal';
}

export function getTableWidthModeClass(value: unknown): string {
  return `tableWrapper--${normalizeTableWidthMode(value)}`;
}
