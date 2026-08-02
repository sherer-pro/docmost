import assert from 'node:assert/strict';

import { generateHTML, generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, it } from 'vitest';

import {
  BLOCK_WIDTH_MODES,
  normalizeBlockWidthMode,
} from './block-width';
import { CustomCodeBlock } from './custom-code-block';
import { Comment } from './comment/comment';
import { Drawio } from './drawio';
import { Excalidraw } from './excalidraw';
import {
  TABLE_WIDTH_MODES,
  normalizeTableWidthMode,
} from './table/utils/width-mode';

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  Comment,
  CustomCodeBlock,
  Drawio,
  Excalidraw,
];

describe('block width modes', () => {
  it('normalizes shared and legacy table width values', () => {
    assert.deepEqual(BLOCK_WIDTH_MODES, ['normal', 'wide', 'full']);
    assert.equal(TABLE_WIDTH_MODES, BLOCK_WIDTH_MODES);
    assert.equal(normalizeBlockWidthMode('wide'), 'wide');
    assert.equal(normalizeBlockWidthMode('unknown'), 'normal');
    assert.equal(normalizeTableWidthMode('full'), 'full');
    assert.equal(normalizeTableWidthMode(null), 'wide');
  });

  it('round-trips diagram width modes through HTML', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'mermaid', widthMode: 'wide' },
          content: [{ type: 'text', text: 'graph TD; A-->B' }],
        },
        {
          type: 'drawio',
          attrs: {
            src: '/drawio.svg',
            title: 'Draw.io',
            width: '70%',
            widthMode: 'full',
          },
        },
        {
          type: 'excalidraw',
          attrs: {
            src: '/excalidraw.svg',
            title: 'Excalidraw',
            width: '60%',
            widthMode: 'wide',
          },
        },
      ],
    };

    const html = generateHTML(document, extensions);
    assert.match(html, /data-block-width-mode="wide"/);
    assert.match(html, /data-block-width-mode="full"/);
    assert.match(html, /data-width="70%"/);
    assert.match(html, /data-width="60%"/);

    const json = generateJSON(html, extensions);
    assert.equal(json.content?.[0].attrs?.widthMode, 'wide');
    assert.equal(json.content?.[1].attrs?.widthMode, 'full');
    assert.equal(json.content?.[1].attrs?.width, '70%');
    assert.equal(json.content?.[2].attrs?.widthMode, 'wide');
    assert.equal(json.content?.[2].attrs?.width, '60%');
  });

  it('defaults missing and invalid diagram modes to normal', () => {
    const json = generateJSON(
      [
        '<pre data-block-width-mode="invalid"><code class="language-mermaid">graph TD; A--&gt;B</code></pre>',
        '<div data-type="drawio" data-src="/drawio.svg"></div>',
        '<div data-type="excalidraw" data-src="/excalidraw.svg" data-width-mode="invalid"></div>',
      ].join(''),
      extensions,
    );

    assert.equal(json.content?.[0].attrs?.widthMode, 'normal');
    assert.equal(json.content?.[1].attrs?.widthMode, 'normal');
    assert.equal(json.content?.[2].attrs?.widthMode, 'normal');
  });
});
