// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { Comment } from './comment';

describe('comment event ownership', () => {
  it('identifies the owning page even when rendered without a live collaboration editor', () => {
    const editor = new Editor({
      extensions: [StarterKit, Comment],
      content: '<p><span data-comment-id="thread">Commented text</span></p>',
      editorProps: { attributes: { 'data-editor-page-id': 'record-page' } },
    });
    let detail: unknown;
    const listener = (event: Event) => {
      detail = (event as CustomEvent).detail;
    };
    editor.view.dom.addEventListener('ACTIVE_COMMENT_EVENT', listener);
    try {
      document.getSelection()?.removeAllRanges();
      editor.view.dom.querySelector<HTMLElement>('[data-comment-id]')!.click();
      expect(detail).toEqual({
        commentId: 'thread',
        resolved: false,
        pageId: 'record-page',
      });
    } finally {
      editor.view.dom.removeEventListener('ACTIVE_COMMENT_EVENT', listener);
      editor.destroy();
    }
  });
});
