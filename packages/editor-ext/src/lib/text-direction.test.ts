// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextDirection } from './text-direction';

describe('block direction', () => {
  it('renders automatic direction per block and preserves explicit choices through HTML', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextDirection],
      content:
        '<p>Русский English</p><p dir="rtl">العربية עברית English</p><ul><li><p>עברית</p></li></ul>',
    });
    try {
      expect(editor.getHTML()).toContain('<p dir="auto">Русский English</p>');
      expect(editor.getHTML()).toContain(
        '<p dir="rtl">العربية עברית English</p>',
      );
      editor.commands.setTextSelection(1);
      expect(editor.commands.setBlockTextDirection('ltr')).toBe(true);
      expect(editor.getHTML()).toContain('<p dir="ltr">Русский English</p>');
      expect(editor.commands.setBlockTextDirection('unsafe' as any)).toBe(false);
      expect(editor.commands.setBlockTextDirection('auto')).toBe(true);
      expect(editor.getHTML()).toContain('<p dir="auto">Русский English</p>');
    } finally {
      editor.destroy();
    }
  });
});
