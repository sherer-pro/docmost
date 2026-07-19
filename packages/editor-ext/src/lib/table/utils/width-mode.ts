import {
  BLOCK_WIDTH_MODES,
  normalizeBlockWidthMode,
  type BlockWidthMode,
} from '../../block-width';

export const TABLE_WIDTH_MODES = BLOCK_WIDTH_MODES;

export type TableWidthMode = BlockWidthMode;

export function normalizeTableWidthMode(value: unknown): TableWidthMode {
  return normalizeBlockWidthMode(value);
}

export function getTableWidthModeClass(value: unknown): string {
  return `tableWrapper--${normalizeTableWidthMode(value)}`;
}
