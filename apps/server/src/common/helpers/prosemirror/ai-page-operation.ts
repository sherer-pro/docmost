import { createHash } from 'node:crypto';
import { sanitizeUrl } from '@docmost/editor-ext';
import { nanoid } from 'nanoid';
import type { AiApprovalPreview } from '@docmost/api-contract';

export type ProseMirrorJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJson[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  text?: string;
};

export type AiPageOperation =
  | {
      kind: 'editPageText';
      nodeId: string;
      oldText: string;
      newText: string;
    }
  | {
      kind: 'patchNode';
      nodeId: string;
      node: ProseMirrorJson;
    }
  | {
      kind: 'insertNode';
      anchorNodeId: string;
      position: 'before' | 'after';
      node: ProseMirrorJson;
    }
  | {
      kind: 'deleteNode';
      nodeId: string;
    };

export type AiPageOutlineItem = {
  index: number;
  id: string | null;
  type: string;
  level: number;
  text: string;
};

const SAFE_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'text',
  'hardBreak',
  'horizontalRule',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'details',
  'detailsSummary',
  'detailsContent',
  'callout',
  'mathInline',
  'mathBlock',
  'pageBreak',
]);

const SAFE_MARK_TYPES = new Set([
  'bold',
  'italic',
  'strike',
  'code',
  'underline',
  'link',
  'highlight',
  'superscript',
  'subscript',
  'textStyle',
]);

const AI_APPROVAL_PREVIEW_TEXT_LIMIT = 4000;

const ID_NODE_TYPES = new Set(['paragraph', 'heading']);
const MAX_NODE_JSON_BYTES = 32 * 1024;
const MAX_OPERATION_TEXT_LENGTH = 16 * 1024;

type NodeLocation = {
  node: ProseMirrorJson;
  parent: ProseMirrorJson | null;
  position: number;
  index: number;
};

export function hashProseMirrorJson(document: ProseMirrorJson): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

export function getProseMirrorText(node: ProseMirrorJson): string {
  if (typeof node.text === 'string') {
    return node.text;
  }
  return (node.content ?? []).map(getProseMirrorText).join(' ');
}

export function getAiPageOutline(
  document: ProseMirrorJson,
): AiPageOutlineItem[] {
  const result: AiPageOutlineItem[] = [];
  let index = 0;

  const visit = (node: ProseMirrorJson, level: number) => {
    if (isOutlineNode(node)) {
      result.push({
        index,
        id:
          typeof node.attrs?.id === 'string' ? (node.attrs.id as string) : null,
        type: node.type ?? 'unknown',
        level,
        text: getProseMirrorText(node)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240),
      });
      index += 1;
    }
    for (const child of node.content ?? []) {
      visit(child, node.type === 'doc' ? level : level + 1);
    }
  };

  visit(document, 0);
  return result;
}

export function getAiPageNode(
  document: ProseMirrorJson,
  nodeId: string,
): ProseMirrorJson {
  const location = findNode(document, nodeId);
  if (!location) {
    throw new Error('agent_node_not_found');
  }
  return structuredClone(location.node);
}

export function buildAiApprovalPreview(
  document: ProseMirrorJson,
  operation: AiPageOperation,
  pageId: string,
  pageTitle: string,
): AiApprovalPreview {
  const truncate = (value: string) => ({
    value: value.slice(0, AI_APPROVAL_PREVIEW_TEXT_LIMIT),
    truncated: value.length > AI_APPROVAL_PREVIEW_TEXT_LIMIT,
  });
  const nodeText = (nodeId: string) =>
    truncate(getProseMirrorText(getAiPageNode(document, nodeId)));

  if (operation.kind === 'insertNode') {
    const anchor = nodeText(operation.anchorNodeId);
    const after = truncate(getProseMirrorText(operation.node));
    return {
      kind: operation.kind,
      pageId,
      pageTitle,
      beforeText: '',
      afterText: after.value,
      anchorNodeId: operation.anchorNodeId,
      anchorText: anchor.value,
      position: operation.position,
      truncated: anchor.truncated || after.truncated,
    };
  }

  const before = nodeText(operation.nodeId);
  if (operation.kind === 'deleteNode') {
    return {
      kind: operation.kind,
      pageId,
      pageTitle,
      beforeText: before.value,
      afterText: '',
      anchorNodeId: operation.nodeId,
      truncated: before.truncated,
    };
  }

  const nextDocument = applyAiPageOperation(document, operation);
  const after = truncate(
    getProseMirrorText(getAiPageNode(nextDocument, operation.nodeId)),
  );
  return {
    kind: operation.kind,
    pageId,
    pageTitle,
    beforeText: before.value,
    afterText: after.value,
    anchorNodeId: operation.nodeId,
    truncated: before.truncated || after.truncated,
  };
}

export function extractAiApprovalPreview(
  result: unknown,
): AiApprovalPreview | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const preview = (result as Record<string, unknown>).approvalPreview;
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return null;
  }
  const value = preview as Record<string, unknown>;
  if (
    !['editPageText', 'patchNode', 'insertNode', 'deleteNode'].includes(
      String(value.kind),
    ) ||
    typeof value.pageId !== 'string' ||
    typeof value.pageTitle !== 'string' ||
    typeof value.beforeText !== 'string' ||
    typeof value.afterText !== 'string' ||
    typeof value.anchorNodeId !== 'string' ||
    typeof value.truncated !== 'boolean'
  ) {
    return null;
  }
  if (
    value.kind === 'insertNode' &&
    (typeof value.anchorText !== 'string' ||
      (value.position !== 'before' && value.position !== 'after'))
  ) {
    return null;
  }
  return preview as AiApprovalPreview;
}

export function assertSafeAiPageOperation(operation: AiPageOperation): void {
  const serialized = JSON.stringify(operation);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_NODE_JSON_BYTES) {
    throw new Error('agent_operation_too_large');
  }

  if (operation.kind === 'editPageText') {
    if (
      operation.oldText.length === 0 ||
      operation.oldText.length > MAX_OPERATION_TEXT_LENGTH ||
      operation.newText.length > MAX_OPERATION_TEXT_LENGTH ||
      operation.newText.includes('\u0000')
    ) {
      throw new Error('agent_text_operation_invalid');
    }
    return;
  }

  if (operation.kind === 'insertNode' || operation.kind === 'patchNode') {
    sanitizeAndValidateNode(operation.node);
  }
}

export function prepareAiPageOperation(
  operation: AiPageOperation,
): AiPageOperation {
  const prepared = structuredClone(operation);
  assertSafeAiPageOperation(prepared);
  if (prepared.kind === 'insertNode' || prepared.kind === 'patchNode') {
    addMissingNodeIds(prepared.node);
  }
  return prepared;
}

export function applyAiPageOperation(
  document: ProseMirrorJson,
  operation: AiPageOperation,
): ProseMirrorJson {
  assertSafeAiPageOperation(operation);
  const nextDocument = structuredClone(document);

  if (operation.kind === 'editPageText') {
    const target = findNode(nextDocument, operation.nodeId);
    if (!target) {
      throw new Error('agent_node_not_found');
    }
    const matches: ProseMirrorJson[] = [];
    walk(target.node, (node) => {
      if (
        typeof node.text === 'string' &&
        node.text.includes(operation.oldText)
      ) {
        matches.push(node);
      }
    });
    if (matches.length !== 1) {
      throw new Error('agent_text_match_ambiguous');
    }
    matches[0].text = matches[0].text!.replace(
      operation.oldText,
      operation.newText,
    );
    return nextDocument;
  }

  const referenceId =
    operation.kind === 'insertNode' ? operation.anchorNodeId : operation.nodeId;
  const target = findNode(nextDocument, referenceId);
  if (!target || !target.parent || !target.parent.content) {
    throw new Error('agent_node_not_found');
  }

  if (operation.kind === 'deleteNode') {
    target.parent.content.splice(target.position, 1);
    return nextDocument;
  }

  const safeNode = structuredClone(operation.node);
  sanitizeAndValidateNode(safeNode);
  addMissingNodeIds(safeNode);

  if (operation.kind === 'patchNode') {
    const currentId =
      typeof target.node.attrs?.id === 'string' ? target.node.attrs.id : null;
    if (currentId) {
      safeNode.attrs = { ...(safeNode.attrs ?? {}), id: currentId };
    }
    target.parent.content[target.position] = safeNode;
    return nextDocument;
  }

  const offset = operation.position === 'after' ? 1 : 0;
  target.parent.content.splice(target.position + offset, 0, safeNode);
  return nextDocument;
}

function findNode(
  document: ProseMirrorJson,
  nodeId: string,
): NodeLocation | null {
  const requestedIndex = /^#(\d+)$/.exec(nodeId)?.[1];
  let currentIndex = 0;
  let result: NodeLocation | null = null;

  const visit = (
    node: ProseMirrorJson,
    parent: ProseMirrorJson | null,
    position: number,
  ) => {
    if (result) return;
    if (isOutlineNode(node)) {
      const nodeIdentifier =
        typeof node.attrs?.id === 'string' ? node.attrs.id : null;
      if (
        nodeIdentifier === nodeId ||
        (requestedIndex !== undefined &&
          currentIndex === Number(requestedIndex))
      ) {
        result = {
          node,
          parent,
          position,
          index: currentIndex,
        };
        return;
      }
      currentIndex += 1;
    }
    (node.content ?? []).forEach((child, childPosition) =>
      visit(child, node, childPosition),
    );
  };

  visit(document, null, 0);
  return result;
}

function isOutlineNode(node: ProseMirrorJson): boolean {
  return node.type !== 'doc' && node.type !== 'text';
}

function walk(node: ProseMirrorJson, visitor: (node: ProseMirrorJson) => void) {
  visitor(node);
  for (const child of node.content ?? []) {
    walk(child, visitor);
  }
}

function sanitizeAndValidateNode(node: ProseMirrorJson): void {
  if (!node.type || !SAFE_NODE_TYPES.has(node.type)) {
    throw new Error('agent_node_type_not_allowed');
  }
  if (node.text !== undefined && typeof node.text !== 'string') {
    throw new Error('agent_node_invalid');
  }
  if (node.marks && !Array.isArray(node.marks)) {
    throw new Error('agent_node_invalid');
  }

  for (const mark of node.marks ?? []) {
    if (!mark.type || !SAFE_MARK_TYPES.has(mark.type)) {
      throw new Error('agent_mark_type_not_allowed');
    }
    if (mark.type === 'link') {
      const href =
        typeof mark.attrs?.href === 'string' ? mark.attrs.href.trim() : '';
      const safeHref = sanitizeUrl(href);
      if (!href || !safeHref) {
        throw new Error('agent_link_not_allowed');
      }
      mark.attrs = {
        ...(mark.attrs ?? {}),
        href: safeHref,
        target: '_blank',
        rel: 'noopener noreferrer',
      };
    }
  }

  for (const child of node.content ?? []) {
    sanitizeAndValidateNode(child);
  }
}

function addMissingNodeIds(node: ProseMirrorJson) {
  if (
    node.type &&
    ID_NODE_TYPES.has(node.type) &&
    typeof node.attrs?.id !== 'string'
  ) {
    node.attrs = { ...(node.attrs ?? {}), id: nanoid(12) };
  }
  for (const child of node.content ?? []) {
    addMissingNodeIds(child);
  }
}
