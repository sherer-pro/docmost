/**
 * Top-level block node types allowed inside a `transclusionSource`.
 * Notably excludes:
 * - `transclusionSource`: sync blocks cannot wrap other sync blocks (sources are leaves).
 * - `transclusionReference`: sync blocks cannot transclude other sync blocks,
 *   which keeps the transclusion graph acyclic and lets the renderer skip
 *   cycle-aware traversal entirely.
 * Child-only nodes (`listItem`, `tableRow`, `column`, etc.) are also excluded
 * because they are already constrained by their parent containers.
 */
export const TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'taskList',
  'image',
  'video',
  'audio',
  'attachment',
  'callout',
  'details',
  'embed',
  'mathBlock',
  'table',
  'drawio',
  'excalidraw',
  'pdf',
  'subpages',
  'youtube',
] as const;

export type TransclusionSourceAllowedNodeType =
  (typeof TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES)[number];

export const TRANSCLUSION_SOURCE_CONTENT_EXPRESSION = `(${TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES.join(' | ')})+`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidTransclusionIdentifier(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
