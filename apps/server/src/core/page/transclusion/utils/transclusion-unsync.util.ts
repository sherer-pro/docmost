import { isAttachmentNode } from '../../../../common/helpers/prosemirror/utils';

export type AttachmentRewritePlan = {
  oldAttachmentId: string;
  newAttachmentId: string;
};

export type RewriteResult = {
  content: unknown;
  copies: AttachmentRewritePlan[];
};

/**
 * Walk a ProseMirror JSON tree, rewrite every attachment-like node so its
 * `attachmentId` (and any `src`/`url` substring matching that id) point at a fresh
 * id. Each unique old id maps to exactly one new id; the caller is responsible
 * for actually copying the underlying storage file.
 *
 * Pure: does not mutate the input. Returns a deep clone.
 */
export function rewriteAttachmentsForUnsync(
  content: unknown,
  generateId: (oldAttachmentId?: string) => string,
): RewriteResult {
  const cloned = content ? JSON.parse(JSON.stringify(content)) : content;
  const idMap = new Map<string, string>();

  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;

    if (
      typeof node.type === 'string' &&
      isAttachmentNode(node.type) &&
      node.attrs
    ) {
      const oldId = node.attrs.attachmentId;
      if (typeof oldId === 'string' && oldId.length > 0) {
        let newId = idMap.get(oldId);
        if (!newId) {
          newId = generateId(oldId);
          idMap.set(oldId, newId);
        }
        node.attrs.attachmentId = newId;
        for (const key of ['src', 'url']) {
          if (
            typeof node.attrs[key] === 'string' &&
            node.attrs[key].includes(oldId)
          ) {
            node.attrs[key] = node.attrs[key].split(oldId).join(newId);
          }
        }
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };

  visit(cloned);

  const copies: AttachmentRewritePlan[] = Array.from(idMap.entries()).map(
    ([oldAttachmentId, newAttachmentId]) => ({
      oldAttachmentId,
      newAttachmentId,
    }),
  );

  return { content: cloned, copies };
}
