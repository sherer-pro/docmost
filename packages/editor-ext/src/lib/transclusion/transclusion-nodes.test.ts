// @vitest-environment happy-dom

import { Editor } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';
import { TransclusionReference } from './transclusion-reference';
import { TransclusionSource } from './transclusion-source';

describe('transclusion node schema', () => {
  it('allows selecting and dragging sources and references', () => {
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
      true,
    );
    expect(editor.schema.nodes.transclusionReference.spec.draggable).toBe(
      true,
    );

    editor.destroy();
  });
});
