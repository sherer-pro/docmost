// @vitest-environment happy-dom

import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UniqueID } from './unique-id';

const editors: Editor[] = [];

function createEditor(synced: boolean, updateDocument = true) {
  const listeners = new Set<() => void>();
  const provider = {
    synced,
    on: vi.fn((_event: string, listener: () => void) =>
      listeners.add(listener),
    ),
    off: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  };
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Extension.create({
        name: 'collaboration',
        addOptions: () => ({ provider }),
      }),
      UniqueID.configure({ types: ['paragraph', 'heading'], updateDocument }),
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'existing' } },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
        { type: 'heading', attrs: { level: 2 } },
      ],
    },
  });
  editors.push(editor);
  return {
    editor,
    provider,
    sync: () => {
      provider.synced = true;
      listeners.forEach((listener) => listener());
    },
  };
}

function ids(editor: Editor) {
  const result: Array<string | null> = [];
  editor.state.doc.descendants((node) => {
    if (['paragraph', 'heading'].includes(node.type.name))
      result.push(node.attrs.id);
  });
  return result;
}

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe('UniqueID collaboration initialization', () => {
  it('assigns missing IDs when mounted after provider sync without changing existing IDs or history', async () => {
    const { editor, provider } = createEditor(true);
    await vi.waitFor(() => expect(editor.isInitialized).toBe(true));
    expect(ids(editor)).toEqual([
      'existing',
      expect.any(String),
      expect.any(String),
    ]);
    expect(new Set(ids(editor)).size).toBe(3);
    const initialized = editor.getJSON();
    expect(editor.commands.undo()).toBe(false);
    expect(editor.getJSON()).toEqual(initialized);
    expect(provider.on).not.toHaveBeenCalled();
  });

  it('waits for provider sync before assigning IDs and assigns them only once', async () => {
    const { editor, provider, sync } = createEditor(false);
    await vi.waitFor(() => expect(editor.isInitialized).toBe(true));
    expect(ids(editor)).toEqual(['existing', null, null]);
    sync();
    expect(ids(editor)).toEqual([
      'existing',
      expect.any(String),
      expect.any(String),
    ]);
    const initialized = editor.getJSON();
    sync();
    expect(editor.getJSON()).toEqual(initialized);
    expect(provider.off).toHaveBeenCalledWith('synced', expect.any(Function));
  });

  it('keeps immutable documents unchanged even when the provider is already synced', async () => {
    const { editor, provider } = createEditor(true, false);
    await vi.waitFor(() => expect(editor.isInitialized).toBe(true));
    expect(ids(editor)).toEqual(['existing', null, null]);
    expect(provider.on).not.toHaveBeenCalled();
  });
});
