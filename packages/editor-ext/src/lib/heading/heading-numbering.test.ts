// @vitest-environment happy-dom

import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Fragment, Slice } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import {
  addHeadingNumbersToJson,
  calculateHeadingNumbers,
  findManualHeadingNumbering,
  HeadingNumbering,
  isHeadingNumberingPasteCleanupEnabled,
  stripManualHeadingNumberingFromPastedSlice,
} from './heading-numbering';

const descriptor = (level: number, text: string) => ({
  level,
  text,
  value: text,
});

describe('heading numbering', () => {
  it('starts at the largest heading level and resets child counters', () => {
    const headings = calculateHeadingNumbers([
      descriptor(2, 'First'),
      descriptor(3, 'Child'),
      descriptor(3, 'Next child'),
      descriptor(2, 'Second'),
    ]);

    expect(headings.map((heading) => heading.number)).toEqual([
      '1.',
      '1.1.',
      '1.2.',
      '2.',
    ]);
  });

  it('seeds missing parent levels and ignores empty and H4 headings', () => {
    const headings = calculateHeadingNumbers([
      descriptor(3, 'Before the first H1'),
      descriptor(1, 'First H1'),
      descriptor(3, 'Nested H3'),
      descriptor(2, ''),
      descriptor(4, 'Ignored'),
      descriptor(2, 'Explicit H2'),
    ]);

    expect(headings.map((heading) => heading.number)).toEqual([
      '1.1.1.',
      '2.',
      '2.1.1.',
      '2.2.',
    ]);
  });

  it('adds numbers to a cloned JSON document only', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Heading' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Child' }],
        },
      ],
    };

    const numbered = addHeadingNumbersToJson(content);

    expect(numbered.content?.[0].content?.[0].text).toBe('1. ');
    expect(numbered.content?.[1].content?.[0].text).toBe('1.1. ');
    expect(content.content[0].content[0].text).toBe('Heading');
  });

  it('renders non-editable decorations and toggles them dynamically', () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: '<h2>Heading</h2><h3>Child</h3>',
    });

    expect(editor.view.dom.querySelectorAll('.heading-number')).toHaveLength(0);

    editor.commands.setHeadingNumberingEnabled(true);

    const numbers = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('.heading-number'),
    );
    expect(numbers.map((node) => node.textContent)).toEqual(['1.', '1.1.']);
    expect(numbers.every((node) => node.contentEditable === 'false')).toBe(
      true,
    );
    expect(editor.getJSON().content?.[0].content?.[0].text).toBe('Heading');

    editor.destroy();
  });

  it('finds and removes agreed manual prefixes in one transaction', () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: '1.' },
              { type: 'text', text: ' Heading' },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '1.2Heading' }],
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: '1.2.3 Heading' }],
          },
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: '2024Roadmap' }],
          },
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: '1Heading' }],
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: '1.2.3.4 Heading' }],
          },
        ],
      },
    });
    let transactionCount = 0;
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) transactionCount += 1;
    });

    expect(findManualHeadingNumbering(editor.state.doc)).toHaveLength(3);
    expect(editor.commands.removeManualHeadingNumbering()).toBe(true);

    expect(
      editor
        .getJSON()
        .content?.filter((node) => node.type === 'heading')
        .map((node) => node.content?.[0]?.text),
    ).toEqual([
      'Heading',
      'Heading',
      'Heading',
      '2024Roadmap',
      '1Heading',
      '1.2.3.4 Heading',
    ]);
    expect(transactionCount).toBe(1);

    editor.destroy();
  });

  it('strips manual numbering only from pasted H1-H3 nodes', () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: '<p>Existing content</p>',
    });
    const pastedDoc = editor.schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: '1.' },
            { type: 'text', text: ' Heading' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: '1.2.3 Child' }],
        },
        {
          type: 'heading',
          attrs: { level: 4 },
          content: [{ type: 'text', text: '4. Keep H4' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '2. Keep paragraph' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '2024Roadmap' }],
        },
      ],
    });
    const slice = new Slice(pastedDoc.content, 0, 0);

    const cleaned = stripManualHeadingNumberingFromPastedSlice(slice);

    expect(
      cleaned.content.content.map((node) => node.textContent),
    ).toEqual([
      'Heading',
      'Child',
      '4. Keep H4',
      '2. Keep paragraph',
      '2024Roadmap',
    ]);
    expect(editor.getText()).toBe('Existing content');
    editor.destroy();
  });

  it('strips plain text only when pasted at the start of H1-H3', () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: '<h2>Existing</h2>',
    });
    const paragraph = editor.schema.nodeFromJSON({
      type: 'paragraph',
      content: [{ type: 'text', text: '1.2. Pasted' }],
    });
    const slice = new Slice(Fragment.from(paragraph), 1, 1);

    editor.commands.setTextSelection(1);
    expect(
      stripManualHeadingNumberingFromPastedSlice(slice, editor.state).content
        .firstChild?.textContent,
    ).toBe('Pasted');

    editor.commands.setTextSelection(3);
    expect(
      stripManualHeadingNumberingFromPastedSlice(slice, editor.state).content
        .firstChild?.textContent,
    ).toBe('1.2. Pasted');
    editor.destroy();
  });

  it('toggles paste cleanup independently from displayed numbering', () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: '<h1>Heading</h1>',
    });

    expect(isHeadingNumberingPasteCleanupEnabled(editor.state)).toBe(false);
    editor.commands.setHeadingNumberingPasteCleanupEnabled(true);
    expect(isHeadingNumberingPasteCleanupEnabled(editor.state)).toBe(true);
    expect(editor.view.dom.querySelectorAll('.heading-number')).toHaveLength(0);
    editor.destroy();
  });
});
