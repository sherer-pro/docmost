import { v7 as uuid7 } from 'uuid';

const STRUCTURAL_ID_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'transclusionSource',
  'pageEmbed',
]);

export interface MaterializePageContentOptions {
  sourcePageId: string;
  targetPageId: string;
  generateId?: () => string;
}

/**
 * Creates a presentation-safe copy of a ProseMirror document. Comment marks
 * are removed and all occurrence/structural ids are regenerated. References
 * to copied synced blocks are redirected to the target page; external live
 * references keep their source identifiers.
 */
export function materializePageContent(
  content: unknown,
  options: MaterializePageContentOptions,
): unknown {
  const generateId = options.generateId ?? uuid7;
  const cloned = content ? JSON.parse(JSON.stringify(content)) : content;
  const transclusionIdMap = new Map<string, string>();

  const regenerate = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.marks)) {
      node.marks = node.marks.filter((mark: any) => mark?.type !== 'comment');
      if (node.marks.length === 0) delete node.marks;
    }
    if (STRUCTURAL_ID_NODE_TYPES.has(node.type)) {
      node.attrs =
        node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
      const previousId = node.attrs.id;
      const nextId = generateId();
      node.attrs.id = nextId;
      if (
        node.type === 'transclusionSource' &&
        typeof previousId === 'string'
      ) {
        transclusionIdMap.set(previousId, nextId);
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(regenerate);
  };

  const remapInternalReferences = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'transclusionReference' &&
      node.attrs?.sourcePageId === options.sourcePageId
    ) {
      const nextId = transclusionIdMap.get(node.attrs.transclusionId);
      if (nextId) {
        node.attrs.sourcePageId = options.targetPageId;
        node.attrs.transclusionId = nextId;
      }
    }
    if (Array.isArray(node.content))
      node.content.forEach(remapInternalReferences);
  };

  regenerate(cloned);
  remapInternalReferences(cloned);
  return cloned;
}
