// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAiMarkdownComposerExtensions,
  insertMarkdownAtSelection,
} from "./ai-markdown-composer.extensions.ts";
import {
  composerHtmlToMarkdown,
  markdownToComposerHtml,
} from "./ai-markdown-composer.utils.ts";

const editors: Editor[] = [];

function createEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createAiMarkdownComposerExtensions("Write a message"),
  });
  editors.push(editor);
  return editor;
}

function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    let handled = false;
    editor.view.someProp("handleTextInput", (handler) => {
      handled =
        handler(editor.view, from, to, character, () =>
          editor.state.tr.insertText(character, from, to),
        ) === true;
      return handled;
    });

    if (!handled) {
      editor.commands.insertContent(character);
    }
  }
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.replaceChildren();
});

describe("AI Markdown composer", () => {
  it("converts Markdown input rules into rich content", () => {
    const editor = createEditor();

    type(editor, "**bold**");
    expect(editor.getHTML()).toContain("<strong>bold</strong>");

    editor.commands.clearContent();
    type(editor, "- ");
    expect(editor.isActive("bulletList")).toBe(true);

    editor.commands.clearContent();
    type(editor, "[Docmost](https://docmost.com)");
    expect(editor.getHTML()).toContain('href="https://docmost.com/"');

    editor.commands.clearContent();
    type(editor, "*italic*");
    expect(editor.getHTML()).toContain("<em>italic</em>");

    editor.commands.clearContent();
    type(editor, "~~strike~~");
    expect(editor.getHTML()).toContain("<s>strike</s>");

    editor.commands.clearContent();
    type(editor, "`code`");
    expect(editor.getHTML()).toContain("<code>code</code>");

    editor.commands.clearContent();
    type(editor, "# ");
    expect(editor.isActive("heading", { level: 1 })).toBe(true);

    editor.commands.clearContent();
    type(editor, "> ");
    expect(editor.isActive("blockquote")).toBe(true);

    editor.commands.clearContent();
    type(editor, "``` ");
    expect(editor.isActive("codeBlock")).toBe(true);

    editor.commands.clearContent();
    type(editor, "- [ ] ");
    expect(editor.getHTML()).toContain('data-type="taskList"');
  });

  it("shows Markdown delimiters only for the active formatted fragment", () => {
    const editor = createEditor();

    editor.commands.setContent(markdownToComposerHtml("**bold**"));
    editor.commands.setTextSelection(2);

    const activeSyntax = editor.view.dom.querySelector(
      ".aiMarkdownSyntaxActive",
    );
    expect(activeSyntax?.getAttribute("data-markdown-prefix")).toBe("**");
    expect(activeSyntax?.getAttribute("data-markdown-suffix")).toBe("**");
  });

  it("preserves the supported Markdown structures through editor content", () => {
    const editor = createEditor();
    const markdown = [
      "# Heading",
      "",
      "*italic*, ~~strike~~, and `code`",
      "",
      "> Quoted text",
      "",
      "1. First",
      "2. Second",
      "",
      "- [ ] Open task",
      "- [x] Done task",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n");

    editor.commands.setContent(markdownToComposerHtml(markdown));

    expect(editor.getHTML()).toContain("<h1>Heading</h1>");
    expect(editor.getHTML()).toContain("<em>italic</em>");
    expect(editor.getHTML()).toContain("<s>strike</s>");
    expect(editor.getHTML()).toContain("<blockquote>");
    expect(editor.getHTML()).toContain("<ol>");
    expect(editor.getHTML()).toContain('data-type="taskList"');
    expect(editor.getHTML()).toContain("<pre><code");

    const serialized = composerHtmlToMarkdown(editor.getHTML());
    expect(serialized).toContain("# Heading");
    expect(serialized).toContain("- [ ] Open task");
    expect(serialized).toContain("- [x] Done task");
    expect(serialized).toContain("```ts");
  });

  it("inserts a Markdown template at the current cursor position", () => {
    const editor = createEditor();
    editor.commands.setContent("<p>beforeafter</p>");
    editor.commands.setTextSelection(7);

    expect(insertMarkdownAtSelection(editor.view, "**template**")).toBe(true);
    expect(editor.getHTML()).toBe(
      "<p>before<strong>template</strong>after</p>",
    );
    expect(composerHtmlToMarkdown(editor.getHTML())).toBe(
      "before**template**after",
    );
  });

  it("preserves surrounding draft blocks when inserting a multiline template", () => {
    const editor = createEditor();
    editor.commands.setContent("<p>beforeafter</p>");
    editor.commands.setTextSelection(7);

    expect(
      insertMarkdownAtSelection(
        editor.view,
        "1. First instruction\n2. Second instruction",
      ),
    ).toBe(true);

    const markdown = composerHtmlToMarkdown(editor.getHTML());
    expect(editor.getHTML()).toBe(
      "<p>before</p><ol><li><p>First instruction</p></li><li><p>Second instruction</p></li></ol><p>after</p>",
    );
    expect(markdown.indexOf("before")).toBeLessThan(
      markdown.indexOf("First instruction"),
    );
    expect(markdown.indexOf("First instruction")).toBeLessThan(
      markdown.indexOf("after"),
    );
    expect(markdown).toMatch(/1\.\s+First instruction/);
    expect(markdown).toMatch(/2\.\s+Second instruction/);
  });

  it("supports every Markdown formatting menu command", () => {
    const editor = createEditor();
    const inlineCases = [
      ["strong", () => editor.chain().focus().toggleBold().run()],
      ["em", () => editor.chain().focus().toggleItalic().run()],
      ["s", () => editor.chain().focus().toggleStrike().run()],
      ["code", () => editor.chain().focus().toggleCode().run()],
      [
        "a",
        () =>
          editor.chain().focus().setLink({ href: "https://example.com" }).run(),
      ],
    ] as const;

    for (const [selector, run] of inlineCases) {
      editor.commands.setContent("<p>format</p>");
      editor.commands.setTextSelection({ from: 1, to: 7 });
      expect(run()).toBe(true);
      expect(editor.view.dom.querySelector(selector)?.textContent).toBe(
        "format",
      );
    }

    const blockCases = [
      ["h1", () => editor.chain().focus().toggleHeading({ level: 1 }).run()],
      [
        "ul:not([data-type])",
        () => editor.chain().focus().toggleBulletList().run(),
      ],
      ["ol", () => editor.chain().focus().toggleOrderedList().run()],
      [
        '[data-type="taskList"]',
        () => editor.chain().focus().toggleTaskList().run(),
      ],
      ["blockquote", () => editor.chain().focus().toggleBlockquote().run()],
      ["pre", () => editor.chain().focus().toggleCodeBlock().run()],
    ] as const;

    for (const [selector, run] of blockCases) {
      editor.commands.setContent("<p>format</p>");
      editor.commands.setTextSelection(2);
      expect(run()).toBe(true);
      expect(editor.view.dom.querySelector(selector)?.textContent).toBe(
        "format",
      );
    }
  });
});
