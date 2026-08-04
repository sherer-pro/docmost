import { describe, expect, it } from 'vitest';
import {
  collectTransclusionPresentationReferences,
  formatTransclusionMarkdown,
  getTransclusionReferenceKey,
  materializeTransclusionsForPresentation,
} from './transclusion-presentation';

const strings = {
  label: 'Synced block',
  unavailable: 'Content unavailable',
};

describe('transclusion presentation', () => {
  it('materializes resolved references and deduplicates lookup keys', () => {
    const reference = {
      type: 'transclusionReference',
      attrs: { sourcePageId: 'page-1', transclusionId: 'block-1' },
    };
    const document = { type: 'doc', content: [reference, reference] };
    const references = collectTransclusionPresentationReferences(document);
    const result = materializeTransclusionsForPresentation(
      document,
      new Map([
        [
          getTransclusionReferenceKey('page-1', 'block-1'),
          {
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Resolved content' }],
                },
              ],
            },
          },
        ],
      ]),
      strings,
    );

    expect(references).toEqual([
      { sourcePageId: 'page-1', transclusionId: 'block-1' },
    ]);
    expect(result.content[0]).toMatchObject({
      type: 'transclusionSource',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Resolved content' }],
        },
      ],
    });
  });

  it('uses the safe placeholder for missing and denied references', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'transclusionReference',
          attrs: { sourcePageId: 'page-1', transclusionId: 'block-1' },
        },
      ],
    };
    const result = materializeTransclusionsForPresentation(
      document,
      new Map([
        [
          getTransclusionReferenceKey('page-1', 'block-1'),
          { status: 'no_access' },
        ],
      ]),
      strings,
    );

    expect(result.content[0].content[0].content[0].text).toBe(
      'Content unavailable',
    );
  });

  it('formats plain text as a labeled markdown blockquote', () => {
    expect(formatTransclusionMarkdown('First\n\nSecond', strings).trim()).toBe(
      '> **Synced block**\n>\n> First\n>\n> Second',
    );
  });
});
