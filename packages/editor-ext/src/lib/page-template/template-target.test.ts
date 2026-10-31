import { describe, expect, it } from 'vitest';
import { isEmptyTemplateTarget } from './template-content';

describe('empty template target protection', () => {
  it('accepts only an empty document or empty paragraphs', () => {
    expect(isEmptyTemplateTarget({ type: 'doc', content: [] })).toBe(true);
    expect(isEmptyTemplateTarget({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
  });

  it.each([
    null,
    { type: 'paragraph' },
    { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] },
    { type: 'doc', content: [{ type: 'horizontalRule' }] },
    { type: 'doc', content: [{ type: 'databaseEmbed', attrs: { databaseId: 'id' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
  ])('does not discard existing content %#', (content) => {
    expect(isEmptyTemplateTarget(content)).toBe(false);
  });
});
