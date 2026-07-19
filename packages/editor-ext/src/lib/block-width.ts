export const BLOCK_WIDTH_MODES = ['normal', 'wide', 'full'] as const;

export type BlockWidthMode = (typeof BLOCK_WIDTH_MODES)[number];

export function normalizeBlockWidthMode(value: unknown): BlockWidthMode {
  return BLOCK_WIDTH_MODES.includes(value as BlockWidthMode)
    ? (value as BlockWidthMode)
    : 'normal';
}

export function getBlockWidthModeClass(value: unknown): string {
  return `blockWidthWrapper--${normalizeBlockWidthMode(value)}`;
}
