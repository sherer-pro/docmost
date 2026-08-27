// @vitest-environment happy-dom

import { Editor, Node } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';
import { TransclusionReference } from './transclusion-reference';
import { TransclusionSource } from './transclusion-source';

describe('transclusion node schema', () => {
  const sourcePageId = '019fdaa0-0000-7000-8000-000000000001';
  const transclusionId = '019fdaa0-0000-7000-8000-000000000002';

  it('keeps sources draggable and reference text mouse-selectable', () => {
    const TestTransclusionSource = TransclusionSource.extend({
      content: 'paragraph+',
    });
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        TestTransclusionSource,
        TransclusionReference,
      ],
    });

    expect(editor.schema.nodes.transclusionSource.spec.selectable).toBe(true);
    expect(editor.schema.nodes.transclusionSource.spec.draggable).toBe(true);
    expect(editor.schema.nodes.transclusionReference.spec.selectable).toBe(
      false,
    );
    expect(editor.schema.nodes.transclusionReference.spec.draggable).toBe(
      false,
    );

    editor.destroy();
  });

  it.each(['bulletList', 'table', 'image', 'drawio'])(
    'wraps a selected %s node in a synced block',
    (nodeType) => {
      const SelectedBlock = Node.create({
        name: nodeType,
        group: 'block',
        atom: true,
        renderHTML: () => ['div', { 'data-type': nodeType }],
      });
      const TestTransclusionSource = TransclusionSource.extend({
        content: `(paragraph | ${nodeType})+`,
      });
      const editor = new Editor({
        extensions: [
          Document,
          Paragraph,
          Text,
          SelectedBlock,
          TestTransclusionSource,
          TransclusionReference,
        ],
        content: {
          type: 'doc',
          content: [{ type: nodeType }],
        },
      });

      editor.commands.setNodeSelection(0);

      expect(editor.can().toggleTransclusionSource()).toBe(true);
      expect(editor.commands.toggleTransclusionSource()).toBe(true);
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: 'transclusionSource',
        content: [{ type: nodeType }],
      });

      editor.destroy();
    },
  );

  it('wraps the selected text block in a synced block', () => {
    const TestTransclusionSource = TransclusionSource.extend({
      content: 'paragraph+',
    });
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        TestTransclusionSource,
        TransclusionReference,
      ],
      content: '<p>Selected text</p>',
    });

    editor.commands.setTextSelection({ from: 1, to: 9 });

    expect(editor.commands.toggleTransclusionSource()).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'transclusionSource',
      content: [{ type: 'paragraph' }],
    });

    editor.destroy();
  });

  it('parses valid clipboard references and rejects malformed service attributes', () => {
    const TestTransclusionSource = TransclusionSource.extend({
      content: 'paragraph+',
    });
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        TestTransclusionSource,
        TransclusionReference,
      ],
    });

    editor.commands.setContent(
      `<div data-type="transclusionReference" data-source-page-id="${sourcePageId}" data-transclusion-id="${transclusionId}"></div>`,
    );
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'transclusionReference',
      attrs: { sourcePageId, transclusionId },
    });

    editor.commands.setContent(
      '<div data-type="transclusionReference" data-source-page-id="not-a-uuid"></div><p>Ordinary content</p>',
    );
    expect(editor.getJSON().content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Ordinary content' }],
      },
    ]);

    editor.commands.setContent(
      '<div data-type="transclusionSource"><p>Malformed source</p></div>',
    );
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Malformed source' }],
    });

    editor.destroy();
  });
});
