import { buildTagSearchMetadata } from './tag-search.utils';

describe('buildTagSearchMetadata', () => {
  it('groups selected tag matches by block and preserves stable anchors', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'block-one' },
          content: [
            { type: 'text', text: 'Clarify ' },
            { type: 'tag', attrs: { value: 'tbd' } },
            { type: 'text', text: ' and then ' },
            { type: 'tag', attrs: { value: 'todo' } },
          ],
        },
        {
          type: 'paragraph',
          attrs: { id: 'block-two' },
          content: [{ type: 'tag', attrs: { value: 'done' } }],
        },
      ],
    };

    const result = buildTagSearchMetadata(content, ['tbd', 'todo']);

    expect(result.tagMatchCount).toBe(2);
    expect(result.tagSnippets).toHaveLength(1);
    expect(result.tagSnippets[0]).toMatchObject({
      anchorId: 'block-one',
      text: 'Clarify TBD and then TODO',
      matches: [
        { start: 8, end: 11, value: 'tbd' },
        { start: 21, end: 25, value: 'todo' },
      ],
    });
  });

  it('limits snippets while retaining the total occurrence count', () => {
    const content = {
      type: 'doc',
      content: Array.from({ length: 5 }, (_, index) => ({
        type: 'paragraph',
        attrs: { id: `block-${index}` },
        content: [{ type: 'tag', attrs: { value: 'todo' } }],
      })),
    };

    const result = buildTagSearchMetadata(content, ['todo']);

    expect(result.tagMatchCount).toBe(5);
    expect(result.tagSnippets).toHaveLength(3);
  });

  it('returns plain structured text for hostile and malformed content', () => {
    const hostile = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: '<script>' },
          content: [
            { type: 'text', text: '<img src=x onerror=alert(1)> ' },
            { type: 'tag', attrs: { value: 'TODO' } },
          ],
        },
      ],
    };

    expect(buildTagSearchMetadata(hostile, ['todo'])).toEqual({
      tagMatchCount: 1,
      tagSnippets: [
        {
          anchorId: undefined,
          text: '<img src=x onerror=alert(1)> TODO',
          matches: [{ start: 29, end: 33, value: 'todo' }],
        },
      ],
    });
    expect(buildTagSearchMetadata('{broken', ['todo'])).toEqual({
      tagMatchCount: 0,
      tagSnippets: [],
    });
  });
});
