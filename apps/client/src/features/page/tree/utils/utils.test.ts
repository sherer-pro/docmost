import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deleteTreeNode, dropTreeNode } from './utils';
import { SpaceTreeNode } from '../types';

function createNode(
  id: string,
  children: SpaceTreeNode[] = [],
  parentPageId: string | null = null,
): SpaceTreeNode {
  return {
    id,
    nodeType: 'page',
    slugId: id,
    databaseId: null,
    name: id,
    icon: null,
    status: null,
    position: id,
    hasChildren: children.length > 0,
    spaceId: 'space-1',
    parentPageId,
    children,
  };
}

describe('dropTreeNode', () => {
  it('removes a node together with all descendants', () => {
    const grandChild = createNode('grandchild', [], 'child');
    const child = createNode('child', [grandChild], 'parent');
    const parent = createNode('parent', [child]);
    const sibling = createNode('sibling');

    const nextTree = dropTreeNode([parent, sibling], 'child');

    assert.equal(nextTree.length, 2);
    assert.equal(nextTree[0].id, 'parent');
    assert.equal(nextTree[0].children.length, 0);
    assert.equal(nextTree[1].id, 'sibling');
    assert.equal(JSON.stringify(nextTree).includes('grandchild'), false);
  });

  it('synchronizes nested structure when removing one root branch', () => {
    const leftChild = createNode('left-child', [], 'left-root');
    const leftRoot = createNode('left-root', [leftChild]);
    const rightChild = createNode('right-child', [], 'right-root');
    const rightRoot = createNode('right-root', [rightChild]);

    const nextTree = dropTreeNode([leftRoot, rightRoot], 'left-root');

    assert.deepEqual(nextTree.map((node) => node.id), ['right-root']);
    assert.deepEqual(nextTree[0].children.map((node) => node.id), ['right-child']);
  });

  it('keeps backward-compatible deleteTreeNode wrapper aligned with dropTreeNode', () => {
    const child = createNode('child', [], 'parent');
    const parent = createNode('parent', [child]);

    const dropResult = dropTreeNode([parent], 'child');
    const deleteResult = deleteTreeNode([parent], 'child');

    assert.deepEqual(deleteResult, dropResult);
  });
});
