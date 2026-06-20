import { describe, expect, it } from 'vitest';
import {
  TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES,
  TRANSCLUSION_SOURCE_CONTENT_EXPRESSION,
} from './constants';

describe('transclusion constants', () => {
  it('keeps source/reference nodes out of source content', () => {
    expect(TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES).not.toContain(
      'transclusionSource',
    );
    expect(TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES).not.toContain(
      'transclusionReference',
    );
  });

  it('builds the content expression from the allowed type list', () => {
    expect(TRANSCLUSION_SOURCE_CONTENT_EXPRESSION).toBe(
      `(${TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES.join(' | ')})+`,
    );
  });
});
