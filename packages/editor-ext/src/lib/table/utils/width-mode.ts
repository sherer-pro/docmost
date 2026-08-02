import {
  BLOCK_WIDTH_MODES,
  type BlockWidthMode,
} from '../../block-width';

export const TABLE_WIDTH_MODES = BLOCK_WIDTH_MODES;
export const DEFAULT_TABLE_WIDTH_MODE: TableWidthMode = 'wide';

export type TableWidthMode = BlockWidthMode;

export function normalizeTableWidthMode(value: unknown): TableWidthMode {
  return TABLE_WIDTH_MODES.includes(value as TableWidthMode)
    ? (value as TableWidthMode)
    : DEFAULT_TABLE_WIDTH_MODE;
}

export function getTableWidthModeClass(value: unknown): string {
  return `tableWrapper--${normalizeTableWidthMode(value)}`;
}
