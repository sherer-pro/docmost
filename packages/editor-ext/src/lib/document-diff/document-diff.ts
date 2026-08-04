import { ChangeSet, simplifyChanges } from '@tiptap/pm/changeset';
import type { Node } from '@tiptap/pm/model';
import { recreateTransform } from '../recreate-transform';

export interface DocumentDiffChange {
  op: 'insert' | 'delete';
  text: string;
  block: string;
}

export interface DocumentDiffResult {
  summary: {
    inserted: number;
    deleted: number;
    blocksChanged: number;
  };
  integrity: {
    images: [number, number];
    links: [number, number];
    tables: [number, number];
    callouts: [number, number];
  };
  changes: DocumentDiffChange[];
  precise: boolean;
}

function blockContext(node: Node, position: number): string {
  try {
    const resolved = node.resolve(
      Math.max(0, Math.min(position, node.content.size)),
    );
    const block = resolved.depth >= 1 ? resolved.node(1) : resolved.node(0);
    const text = block.textContent;
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return '';
  }
}

function countNodes(node: Node, type: string): number {
  let count = 0;
  node.descendants((child) => {
    if (child.type.name === type) count += 1;
  });
  return count;
}

function countLinks(node: Node): number {
  const hrefs = new Set<string>();
  node.descendants((child) => {
    if (!child.isText) return;
    for (const mark of child.marks) {
      if (mark.type.name === 'link') {
        hrefs.add(String(mark.attrs.href ?? ''));
      }
    }
  });
  return hrefs.size;
}

function topLevelTexts(node: Node): string[] {
  const result: string[] = [];
  node.forEach((child) => result.push(child.textContent));
  return result;
}

function fallbackChanges(oldNode: Node, newNode: Node): DocumentDiffChange[] {
  const oldTexts = topLevelTexts(oldNode);
  const newTexts = topLevelTexts(newNode);
  const oldSet = new Set(oldTexts);
  const newSet = new Set(newTexts);
  return [
    ...oldTexts
      .filter((text) => text.trim() && !newSet.has(text))
      .map((text) => ({
        op: 'delete' as const,
        text,
        block: text.slice(0, 80),
      })),
    ...newTexts
      .filter((text) => text.trim() && !oldSet.has(text))
      .map((text) => ({
        op: 'insert' as const,
        text,
        block: text.slice(0, 80),
      })),
  ];
}

/**
 * Canonical structural diff used by both the history UI and server-side AI
 * history tools. Keeping these options in one place prevents the two surfaces
 * from assigning different ranges to the same document versions.
 */
export function getProseMirrorChanges(oldNode: Node, newNode: Node) {
  const transform = recreateTransform(oldNode, newNode, {
    complexSteps: false,
    wordDiffs: true,
    simplifyDiff: true,
  });
  const changeSet = ChangeSet.create(oldNode).addSteps(
    transform.doc,
    transform.mapping.maps,
    [],
  );
  return simplifyChanges(changeSet.changes, newNode);
}

export function diffProseMirrorDocuments(
  oldNode: Node,
  newNode: Node,
): DocumentDiffResult {
  const integrity = {
    images: [countNodes(oldNode, 'image'), countNodes(newNode, 'image')] as [
      number,
      number,
    ],
    links: [countLinks(oldNode), countLinks(newNode)] as [number, number],
    tables: [countNodes(oldNode, 'table'), countNodes(newNode, 'table')] as [
      number,
      number,
    ],
    callouts: [
      countNodes(oldNode, 'callout'),
      countNodes(newNode, 'callout'),
    ] as [number, number],
  };

  let changes: DocumentDiffChange[] = [];
  let precise = true;
  try {
    for (const change of getProseMirrorChanges(oldNode, newNode)) {
      if (change.toA > change.fromA) {
        const text = oldNode.textBetween(change.fromA, change.toA, '\n', ' ');
        if (text) {
          changes.push({
            op: 'delete',
            text,
            block: blockContext(oldNode, change.fromA),
          });
        }
      }
      if (change.toB > change.fromB) {
        const text = newNode.textBetween(change.fromB, change.toB, '\n', ' ');
        if (text) {
          changes.push({
            op: 'insert',
            text,
            block: blockContext(newNode, change.fromB),
          });
        }
      }
    }
  } catch {
    precise = false;
    changes = fallbackChanges(oldNode, newNode);
  }

  const changedBlocks = new Set(
    changes.map((change) => `${change.op}:${change.block}`),
  );
  return {
    summary: {
      inserted: changes
        .filter((change) => change.op === 'insert')
        .reduce((sum, change) => sum + change.text.length, 0),
      deleted: changes
        .filter((change) => change.op === 'delete')
        .reduce((sum, change) => sum + change.text.length, 0),
      blocksChanged: changedBlocks.size,
    },
    integrity,
    changes,
    precise,
  };
}
