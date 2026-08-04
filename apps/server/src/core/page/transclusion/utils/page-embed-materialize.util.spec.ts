import { materializePageContent } from './page-embed-materialize.util';
import { collectPageEmbedsFromPmJson } from './transclusion-prosemirror.util';

describe('page embed ProseMirror helpers', () => {
  it('collects exact occurrences and rejects page embeds in synced sources', () => {
    const sourcePageId = '019ed000-0000-7000-8000-000000000001';
    const firstNodeId = '019ed000-0000-7000-8000-000000000002';
    const secondNodeId = '019ed000-0000-7000-8000-000000000003';
    expect(
      collectPageEmbedsFromPmJson({
        type: 'doc',
        content: [
          { type: 'pageEmbed', attrs: { id: firstNodeId, sourcePageId } },
          { type: 'pageEmbed', attrs: { id: secondNodeId, sourcePageId } },
        ],
      }),
    ).toEqual([
      { referenceNodeId: firstNodeId, sourcePageId },
      { referenceNodeId: secondNodeId, sourcePageId },
    ]);

    expect(() =>
      collectPageEmbedsFromPmJson({
        type: 'doc',
        content: [
          {
            type: 'transclusionSource',
            attrs: { id: 'block-1' },
            content: [
              {
                type: 'pageEmbed',
                attrs: { id: firstNodeId, sourcePageId },
              },
            ],
          },
        ],
      }),
    ).toThrow('page_embed_inside_transclusion_source');

    expect(() =>
      collectPageEmbedsFromPmJson({
        type: 'doc',
        content: [
          { type: 'pageEmbed', attrs: { id: firstNodeId, sourcePageId } },
          { type: 'pageEmbed', attrs: { id: firstNodeId, sourcePageId } },
        ],
      }),
    ).toThrow('page_embed_duplicate_reference_node_id');

    expect(() =>
      collectPageEmbedsFromPmJson({
        type: 'doc',
        content: [{ type: 'pageEmbed', attrs: { sourcePageId } }],
      }),
    ).toThrow('page_embed_invalid_reference_node_id');
  });

  it('removes comments, regenerates occurrence ids and remaps internal blocks', () => {
    const ids = [
      'paragraph-new',
      'source-new',
      'source-child-new',
      'embed-new',
    ];
    const result = materializePageContent(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'paragraph-old' },
            content: [
              {
                type: 'text',
                text: 'Text',
                marks: [{ type: 'comment', attrs: { id: 'comment-1' } }],
              },
            ],
          },
          {
            type: 'transclusionSource',
            attrs: { id: 'source-old' },
            content: [{ type: 'paragraph' }],
          },
          {
            type: 'transclusionReference',
            attrs: {
              sourcePageId: 'source-page',
              transclusionId: 'source-old',
            },
          },
          {
            type: 'pageEmbed',
            attrs: { id: 'embed-old', sourcePageId: 'external-page' },
          },
        ],
      },
      {
        sourcePageId: 'source-page',
        targetPageId: 'target-page',
        generateId: () => ids.shift()!,
      },
    ) as any;

    expect(result.content[0].attrs.id).toBe('paragraph-new');
    expect(result.content[0].content[0].marks).toBeUndefined();
    expect(result.content[1].attrs.id).toBe('source-new');
    expect(result.content[2].attrs).toEqual({
      sourcePageId: 'target-page',
      transclusionId: 'source-new',
    });
    expect(result.content[3].attrs).toEqual({
      id: 'embed-new',
      sourcePageId: 'external-page',
    });
  });

  it('creates structural attrs when the source node has none', () => {
    const result = materializePageContent(
      { type: 'doc', content: [{ type: 'paragraph' }] },
      {
        sourcePageId: 'source-page',
        targetPageId: 'target-page',
        generateId: () => 'paragraph-new',
      },
    ) as any;

    expect(result.content[0].attrs).toEqual({ id: 'paragraph-new' });
  });
});
