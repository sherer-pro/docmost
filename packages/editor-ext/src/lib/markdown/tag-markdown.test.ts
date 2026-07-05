import assert from 'node:assert/strict';

import { generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, it } from 'vitest';

import { Tag } from '../tag';
import { htmlToMarkdown, markdownToHtml } from './index';

const extensions = [StarterKit, Tag];

describe('tag markdown', () => {
  it('exports tag nodes as custom inline markdown', () => {
    const markdown = htmlToMarkdown(
      '<p>Fix <span data-type="tag" data-tag-value="tbd">TBD</span> later</p>',
    );

    assert.equal(markdown.trim(), 'Fix ::tag[TBD] later');
  });

  it('imports custom inline tag markdown as a tag node', () => {
    const html = markdownToHtml('Review ::tag[TODO] before release').toString();
    const json = generateJSON(html, extensions);
    const tagNode = json.content?.[0].content?.[1];

    assert.equal(tagNode?.type, 'tag');
    assert.equal(tagNode?.attrs?.value, 'todo');
  });
});
