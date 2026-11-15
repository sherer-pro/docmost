import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { diffProseMirrorDocuments } from './document-diff';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', attrs: { metadata: { default: null } } },
    text: { inline: true },
  },
});
function document(texts: string[], metadata: unknown = null) {
  return schema.node(
    'doc',
    null,
    texts.map((text) =>
      schema.node('paragraph', { metadata }, text ? [schema.text(text)] : []),
    ),
  );
}

describe('document diff computation budget', () => {
  it('keeps precise changes for small document edits', () => {
    const result = diffProseMirrorDocuments(
      document(['First old sentence.']),
      document(['First new sentence.']),
    );
    expect(result.precise).toBe(true);
    expect(result.changes.map((change) => [change.op, change.text])).toEqual([
      ['delete', 'old'],
      ['insert', 'new'],
    ]);
  });

  it('reads a large historical document through the linear semantic fallback', () => {
    const texts = Array.from(
      { length: 600 },
      (_, i) => `Historical paragraph ${i}: ${'old '.repeat(60)}`,
    );
    const result = diffProseMirrorDocuments(
      document(texts),
      document(['Current document']),
    );
    expect(result.precise).toBe(false);
    expect(result.changes).toHaveLength(601);
    expect(result.summary).toMatchObject({
      inserted: 16,
      deleted: texts.reduce((total, text) => total + text.length, 0),
    });
  });

  it('avoids quadratic word work even with only one structural block', () => {
    const result = diffProseMirrorDocuments(
      document(['old '.repeat(2000)]),
      document(['new '.repeat(2000)]),
    );
    expect(result.precise).toBe(false);
    expect(result.summary).toMatchObject({ inserted: 8000, deleted: 8000 });
  });

  it('bounds nested attribute arrays before structural patching', () => {
    const result = diffProseMirrorDocuments(
      document(
        ['Before'],
        Array.from({ length: 300 }, (_, id) => ({ id })),
      ),
      document(
        ['After'],
        Array.from({ length: 300 }, (_, id) => ({ id: id + 1 })),
      ),
    );
    expect(result.precise).toBe(false);
    expect(result.changes.map((change) => change.text)).toEqual([
      'Before',
      'After',
    ]);
  });

  it('recognizes an unchanged large document without a structural transform', () => {
    const texts = Array.from(
      { length: 600 },
      (_, i) => `Unchanged paragraph ${i}`,
    );
    const result = diffProseMirrorDocuments(document(texts), document(texts));
    expect(result.precise).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.summary).toEqual({
      inserted: 0,
      deleted: 0,
      blocksChanged: 0,
    });
  });
});
