import assert from 'node:assert/strict';

import { generateHTML, generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, it } from 'vitest';

import { Indent } from './indent';
import { PageBreak } from './page-break';

const extensions = [
  StarterKit.configure({
    heading: false,
  }),
  Indent.configure({ types: ['paragraph'] }),
  PageBreak,
];

describe('Indent and PageBreak extensions', () => {
  it('parses and renders paragraph indentation', () => {
    const json = generateJSON('<p data-indent="3">Indented</p>', extensions);

    assert.equal(json.content?.[0].type, 'paragraph');
    assert.equal(json.content?.[0].attrs?.indent, 3);

    const html = generateHTML(json, extensions);

    assert.match(html, /data-indent="3"/);
    assert.match(html, /Indented/);
  });

  it('clamps invalid indentation while parsing HTML', () => {
    const json = generateJSON('<p data-indent="100">Too far</p>', extensions);

    assert.equal(json.content?.[0].attrs?.indent, 8);
  });

  it('round-trips page break nodes through HTML', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before' }],
        },
        { type: 'pageBreak' },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'After' }],
        },
      ],
    };

    const html = generateHTML(document, extensions);
    assert.match(html, /data-type="pageBreak"/);
    assert.match(html, /class="page-break"/);

    const json = generateJSON(html, extensions);
    assert.equal(json.content?.[1].type, 'pageBreak');
  });
});
