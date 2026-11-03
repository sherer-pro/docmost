// @vitest-environment happy-dom

import { Editor, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Fragment, Slice } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { Footnote, closeFootnoteSliceEdges, collectFootnotes } from './footnote';
import { Tabs, TabItem } from '../tabs';
import { UniqueID } from '../unique-id';

const definition = 'ПРИМЕЧАНИЕ_B: одновременная форма во второй вкладке.';
// Retained native clipboard payload from the single-reference audit case.
const capturedHTML = `<p data-id="jkkiinpwvwqg" dir="auto" data-pm-slice="2 1 []"><sup data-id="isgjoqmyywmv" data-footnote-id="isgjoqmyywmv" data-footnote-text="${definition}" data-type="footnote" title="${definition}"><a href="#">*</a></sup></p>`;
const schema = getSchema([StarterKit, Footnote, Tabs, TabItem]);
const note = schema.nodes.footnote.create({ id: 'note' }, schema.text(definition));
const paragraph = schema.nodes.paragraph.create(null, note);
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe('footnote clipboard slice boundaries', () => {
  it('prevents the captured 2/1 fitting from flattening the definition', () => {
    const state = EditorState.create({ schema });
    const broken = new Slice(Fragment.from(paragraph), 2, 1);
    const flattened = state.tr.replaceSelection(broken).doc;
    expect(collectFootnotes(flattened)).toHaveLength(0);
    expect(flattened.textContent).toBe(definition);
    const safe = closeFootnoteSliceEdges(broken);
    expect([safe.openStart, safe.openEnd]).toEqual([1, 1]);
    const preserved = state.tr.replaceSelection(safe).doc;
    expect(collectFootnotes(preserved)).toMatchObject([{ id: 'note', text: definition }]);
  });

  it.each([[1, 1], [0, 0]])('retains normal %i/%i slices unchanged', (start, end) => {
    const slice = new Slice(Fragment.from(paragraph), start, end);
    expect(closeFootnoteSliceEdges(slice)).toBe(slice);
    const doc = EditorState.create({ schema }).tr.replaceSelection(slice).doc;
    expect(collectFootnotes(doc)).toHaveLength(1);
  });

  it('handles asymmetric edges independently without changing text or attrs', () => {
    const first = new Slice(Fragment.from(schema.nodes.paragraph.create(null, [note, schema.text(' suffix')])), 2, 1);
    const last = new Slice(Fragment.from(schema.nodes.paragraph.create(null, [schema.text('prefix '), note])), 1, 2);
    for (const slice of [first, last]) {
      const safe = closeFootnoteSliceEdges(slice);
      expect([safe.openStart, safe.openEnd]).toEqual([1, 1]);
      expect(safe.content).toBe(slice.content);
      expect(collectFootnotes(EditorState.create({ schema }).tr.replaceSelection(safe).doc)).toHaveLength(1);
    }
  });

  it.each([
    (body: typeof paragraph) => schema.nodes.blockquote.create(null, body),
    (body: typeof paragraph) => schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, body)),
    (body: typeof paragraph) => schema.nodes.tabs.create(null, schema.nodes.tabItem.create({ id: 'tab', title: 'Tab' }, body)),
  ])('closes only the footnote edge inside nested blocks', (wrap) => {
    const content = Fragment.from(wrap(paragraph));
    const maximallyOpen = Slice.maxOpen(content);
    const safe = closeFootnoteSliceEdges(maximallyOpen);
    expect(safe.openStart).toBe(maximallyOpen.openStart - 1);
    expect(safe.openEnd).toBe(maximallyOpen.openEnd - 1);
    expect(safe.content).toBe(content);
  });

  it('leaves unrelated open slices and two-reference/full-body slices intact', () => {
    const plain = Slice.maxOpen(Fragment.from(schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text('plain')))));
    expect(closeFootnoteSliceEdges(plain)).toBe(plain);
    const two = new Slice(Fragment.from(schema.nodes.paragraph.create(null, [note, schema.text('between'), note])), 1, 1);
    expect(closeFootnoteSliceEdges(two)).toBe(two);
    const full = new Slice(Fragment.fromArray([paragraph, paragraph]), 0, 0);
    expect(closeFootnoteSliceEdges(full)).toBe(full);
  });
});

describe('native editor footnote paste pipeline', () => {
  function create() {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Footnote, UniqueID.configure({ types: ['paragraph', 'footnote'] })],
      content: '<p></p>',
    });
    editors.push(editor);
    return editor;
  }

  function paste(editor: Editor) {
    editor.view.someProp('handleDOMEvents', (handlers) => {
      handlers.paste?.(editor.view, new Event('paste') as ClipboardEvent);
    });
    editor.view.pasteHTML(capturedHTML);
  }

  it('repairs retained clipboard HTML before fitting and preserves pasted ID repair', () => {
    const editor = create();
    paste(editor);
    expect(collectFootnotes(editor.state.doc)).toMatchObject([{ text: definition, number: 1 }]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    paste(editor);
    const notes = collectFootnotes(editor.state.doc);
    expect(notes.map((entry) => entry.text)).toEqual([definition, definition]);
    expect(new Set(notes.map((entry) => entry.id)).size).toBe(2);
    expect(editor.commands.undo()).toBe(true);
    expect(collectFootnotes(editor.state.doc)).toHaveLength(0);
    expect(editor.commands.redo()).toBe(true);
    expect(collectFootnotes(editor.state.doc)).toHaveLength(2);
  });

  it('keeps code-block and explicit plain-text paste as text', () => {
    const editor = create();
    editor.view.pasteText(` [${definition}] `);
    expect(collectFootnotes(editor.state.doc)).toHaveLength(0);
    editor.commands.setContent('<pre><code></code></pre>');
    editor.view.pasteHTML(capturedHTML);
    expect(collectFootnotes(editor.state.doc)).toHaveLength(0);
  });
});
