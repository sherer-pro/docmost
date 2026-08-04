import { TransclusionNodeSnapshot } from '../transclusion.types';
import { validate as isUuid } from 'uuid';

const TRANSCLUSION_TYPE = 'transclusionSource';
const REFERENCE_TYPE = 'transclusionReference';
const PAGE_EMBED_TYPE = 'pageEmbed';

export type TransclusionReferenceSnapshot = {
  sourcePageId: string;
  transclusionId: string;
};

export type PageEmbedReferenceSnapshot = {
  referenceNodeId: string;
  sourcePageId: string;
};

/**
 * Walks a ProseMirror JSON document and returns one snapshot per top-level
 * `transclusion` node. Does not recurse into transclusions (schema disallows
 * nesting). Skips transclusion nodes without an id (transient state). When
 * duplicate ids are encountered, the later occurrence wins so the result is
 * deterministic.
 */
export function collectTransclusionsFromPmJson(
  doc: unknown,
): TransclusionNodeSnapshot[] {
  if (!doc || typeof doc !== 'object') return [];

  const byId = new Map<string, TransclusionNodeSnapshot>();

  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;

    if (node.type === TRANSCLUSION_TYPE) {
      const id = node.attrs?.id;
      if (typeof id === 'string' && id.length > 0) {
        byId.set(id, {
          transclusionId: id,
          content: { type: 'doc', content: node.content ?? [] },
        });
      }
      return; // do not recurse into transclusion children
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };

  visit(doc);
  return Array.from(byId.values());
}

/**
 * Walks a ProseMirror JSON document and returns one snapshot per unique
 * `(sourcePageId, transclusionId)` pair found on `transclusionReference`
 * nodes. The schema forbids references inside a `transclusionSource` so this
 * walk stops at source boundaries — references can only appear at page level.
 * Order preserved by first-seen.
 */
export function collectReferencesFromPmJson(
  doc: unknown,
): TransclusionReferenceSnapshot[] {
  if (!doc || typeof doc !== 'object') return [];

  const seen = new Set<string>();
  const out: TransclusionReferenceSnapshot[] = [];

  const visit = (node: any, insideTransclusionSource: boolean): void => {
    if (!node || typeof node !== 'object') return;

    if (node.type === REFERENCE_TYPE) {
      if (insideTransclusionSource) {
        throw new Error('page_embed_malformed_mixed_content');
      }
      const sourcePageId = node.attrs?.sourcePageId;
      const transclusionId = node.attrs?.transclusionId;
      if (
        typeof sourcePageId === 'string' &&
        sourcePageId.length > 0 &&
        typeof transclusionId === 'string' &&
        transclusionId.length > 0
      ) {
        const key = `${sourcePageId}::${transclusionId}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ sourcePageId, transclusionId });
        }
      }
      return; // atom node - no children
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(
          child,
          insideTransclusionSource || node.type === TRANSCLUSION_TYPE,
        );
      }
    }
  };

  visit(doc, false);
  return out;
}

/**
 * Collects exact whole-page embed occurrences. Unlike block references, page
 * embeds are indexed per node so repeated references on one page remain
 * independently addressable for detach and diagnostics.
 */
export function collectPageEmbedsFromPmJson(
  doc: unknown,
): PageEmbedReferenceSnapshot[] {
  if (!doc || typeof doc !== 'object') return [];

  const byNodeId = new Map<string, PageEmbedReferenceSnapshot>();

  const visit = (node: any, insideTransclusionSource: boolean): void => {
    if (!node || typeof node !== 'object') return;

    if (node.type === PAGE_EMBED_TYPE) {
      if (insideTransclusionSource) {
        throw new Error('page_embed_inside_transclusion_source');
      }
      const referenceNodeId = node.attrs?.id;
      const sourcePageId = node.attrs?.sourcePageId;
      if (typeof referenceNodeId !== 'string' || !isUuid(referenceNodeId)) {
        throw new Error('page_embed_invalid_reference_node_id');
      }
      if (typeof sourcePageId !== 'string' || !isUuid(sourcePageId)) {
        throw new Error('page_embed_invalid_source_page_id');
      }
      if (byNodeId.has(referenceNodeId)) {
        throw new Error('page_embed_duplicate_reference_node_id');
      }
      byNodeId.set(referenceNodeId, { referenceNodeId, sourcePageId });
      return;
    }

    const nextInside =
      insideTransclusionSource || node.type === TRANSCLUSION_TYPE;
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child, nextInside);
    }
  };

  visit(doc, false);
  return [...byNodeId.values()];
}
