/**
 * Top-level block node types allowed inside a `transclusionSource`.
 * Notably excludes:
 * - `transclusionSource`: sync blocks cannot wrap other sync blocks (sources are leaves).
 * - `transclusionReference`: sync blocks cannot transclude other sync blocks,
 *   which keeps the transclusion graph acyclic and lets the renderer skip
 *   cycle-aware traversal entirely.
 * - `pageEmbed`: whole-page references are also page-level leaves. Keeping
 *   them out of source blocks prevents mixed block/page reference cycles.
 *
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
