import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  getAiPageNodePath,
  assertUniqueNodeIds,
  type ProseMirrorJson,
} from './ai-page-operation';

export type McpContentEdit =
  | { kind: 'editText'; nodeId: string; oldText: string; newText: string }
  | { kind: 'replaceBlock'; nodeId: string; node: ProseMirrorJson }
  | {
      kind: 'insertBlock';
      nodeId: string;
      position: 'before' | 'after';
      node: ProseMirrorJson;
    }
  | { kind: 'deleteBlock'; nodeId: string }
  | { kind: 'appendBlock' | 'appendImage'; node: ProseMirrorJson };

export const MCP_TEXT_NODES = new Set([
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
  'codeBlock',
]);

function visit(
  node: ProseMirrorJson,
  callback: (node: ProseMirrorJson) => void,
) {
  callback(node);
  for (const child of node.content ?? []) visit(child, callback);
}

function anchorConflict(): never {
  throw new ConflictException({
    code: 'MCP_COMMENT_ANCHOR_CONFLICT',
    message:
      'The edit touches an inline comment anchor. Edit a different text run or block.',
  });
}

export function applyMcpContentEdit(
  document: ProseMirrorJson,
  edit: McpContentEdit,
) {
  const next = structuredClone(document);
  next.content ??= [];
  if (
    'node' in edit &&
    (edit.kind === 'appendBlock' || edit.kind === 'appendImage')
  ) {
    next.content.push(edit.node);
    assertUniqueNodeIds(next);
    return { next, before: null, after: edit.node };
  }
  if (!('nodeId' in edit))
    throw new BadRequestException('Invalid content edit');

  let path: number[];
  try {
    path = getAiPageNodePath(next, edit.nodeId);
  } catch {
    throw new ConflictException('The selected node is missing or ambiguous');
  }
  const parent = path.slice(0, -1).reduce((node, index) => {
    const child = node.content![index];
    if (
      child.type === 'transclusionSource' ||
      child.type === 'transclusionReference'
    ) {
      throw new ConflictException('The selected node is inside a synced block');
    }
    return child;
  }, next);
  const index = path.at(-1)!;
  const target = parent.content![index];
  const before = structuredClone(target);

  if (edit.kind === 'insertBlock') {
    parent.content!.splice(
      index + (edit.position === 'after' ? 1 : 0),
      0,
      edit.node,
    );
    assertUniqueNodeIds(next);
    return { next, before, after: edit.node };
  }

  if (edit.kind === 'editText') {
    if (!['paragraph', 'heading', 'codeBlock'].includes(target.type ?? '')) {
      throw new BadRequestException(
        'Select a paragraph, heading or code block for a text edit',
      );
    }
    if (!edit.oldText.length)
      throw new BadRequestException('oldText must be nonempty');
    const matches: ProseMirrorJson[] = [];
    visit(target, (node) => {
      if (node.text?.includes(edit.oldText)) matches.push(node);
    });
    if (
      matches.length !== 1 ||
      matches[0].text!.indexOf(edit.oldText) !==
        matches[0].text!.lastIndexOf(edit.oldText)
    ) {
      throw new ConflictException(
        'oldText must match exactly once within a single text run',
      );
    }
    const match = matches[0];
    if (match.marks?.some((mark) => mark.type === 'comment')) anchorConflict();
    const start = match.text!.indexOf(edit.oldText);
    const replacement =
      match.text!.slice(0, start) +
      edit.newText +
      match.text!.slice(start + edit.oldText.length);
    if (!replacement) {
      throw new BadRequestException(
        'Use replaceBlock or deleteBlock to remove the full text run',
      );
    }
    match.text = replacement;
    return { next, before, after: target };
  }

  visit(target, (node) => {
    if (node.marks?.some((mark) => mark.type === 'comment')) anchorConflict();
    if (!node.type || !MCP_TEXT_NODES.has(node.type)) {
      throw new ConflictException(
        'The selected block contains protected or embedded content',
      );
    }
  });
  if (edit.kind === 'deleteBlock') {
    parent.content!.splice(index, 1);
    return { next, before, after: null };
  }

  const replacement = structuredClone(edit.node);
  if (typeof target.attrs?.id === 'string') {
    if (replacement.type !== target.type) {
      throw new ConflictException(
        'A block with a stable ID must keep its node type',
      );
    }
    replacement.attrs = { ...replacement.attrs, id: target.attrs.id };
  }
  parent.content![index] = replacement;
  assertUniqueNodeIds(next);
  return { next, before, after: replacement };
}
