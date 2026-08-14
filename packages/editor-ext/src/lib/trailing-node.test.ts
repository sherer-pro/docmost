import { TrailingNode } from './trailing-node';
import { describe, expect, it } from 'vitest';

describe('trailing node', () => {
  it('does not append an untracked paragraph after template containers', () => {
    expect(TrailingNode.configure().options.notAfter).toEqual([
      'paragraph',
      'templateManagedBlock',
      'templateField',
    ]);
  });
});
