import assert from 'node:assert/strict';

import { generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, it } from 'vitest';

import { Tag } from '../tag';
import { htmlToMarkdown, markdownToHtml } from './index';

const extensions = [StarterKit, Tag];

describe('tag markdown', () => {
  it('exports transclusion presentation wrappers as blockquotes', () => {
    const markdown = htmlToMarkdown(
      '<div data-type="transclusionSource"><div data-docmost-transclusion-content><p>Shared text</p></div></div>',
      {
        transclusion: {
          label: 'Synced block',
          unavailable: 'Content unavailable',
        },
      },
    );

    assert.equal(markdown.trim(), '> **Synced block**\n>\n> Shared text');
  });

  it('exports tag nodes as custom inline markdown', () => {
    const markdown = htmlToMarkdown(
      '<p>Fix <span data-type="tag" data-tag-value="tbd">TBD</span> later</p>',
    );

    assert.equal(markdown.trim(), 'Fix ::tag[TBD] later');
  });

  it('exports new and future-safe tag nodes without coercing them', () => {
    assert.equal(
      htmlToMarkdown(
        '<p>Scope <span data-type="tag" data-tag-value="core">Core</span> <span data-type="tag" data-tag-value="future">Future</span> <span data-type="tag" data-tag-value="pilot">Pilot</span></p>',
      ).trim(),
      'Scope ::tag[Core] ::tag[Future] ::tag[Pilot]',
    );
    assert.equal(
      htmlToMarkdown(
        '<p>Release <span data-type="tag" data-tag-value="done">DONE</span></p>',
      ).trim(),
      'Release ::tag[DONE]',
    );
    assert.equal(
      htmlToMarkdown(
        '<p>Check <span data-type="tag" data-tag-value="blocked">BLOCKED</span></p>',
      ).trim(),
      'Check ::tag[BLOCKED]',
    );
  });

  it('imports custom inline tag markdown as a tag node', () => {
    const html = markdownToHtml('Review ::tag[TODO] before release').toString();
    const json = generateJSON(html, extensions);
    const tagNode = json.content?.[0].content?.[1];

    assert.equal(tagNode?.type, 'tag');
    assert.equal(tagNode?.attrs?.value, 'todo');
  });

  it('imports done and future-safe custom inline tag markdown', () => {
    const html = markdownToHtml('Release ::tag[DONE] after QA').toString();
    const json = generateJSON(html, extensions);
    const tagNode = json.content?.[0].content?.[1];

    assert.equal(tagNode?.type, 'tag');
    assert.equal(tagNode?.attrs?.value, 'done');

    const newHtml = markdownToHtml(
      'Scope ::tag[Core] ::tag[Future] ::tag[Pilot]',
    ).toString();
    const newJson = generateJSON(newHtml, extensions);
    assert.deepEqual(
      newJson.content?.[0].content
        ?.filter((node) => node.type === 'tag')
        .map((node) => node.attrs?.value),
      ['core', 'future', 'pilot'],
    );

    const futureHtml = markdownToHtml('Wait ::tag[BLOCKED] here').toString();
    const futureJson = generateJSON(futureHtml, extensions);
    const futureTagNode = futureJson.content?.[0].content?.[1];

    assert.equal(futureTagNode?.type, 'tag');
    assert.equal(futureTagNode?.attrs?.value, 'blocked');
  });
});
