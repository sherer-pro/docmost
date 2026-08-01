import { Extension, InputRule } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { DOMParser } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { LinkExtension, sanitizeLinkHref } from "@docmost/editor-ext";
import { markdownToComposerHtml } from "./ai-markdown-composer.utils.ts";

type MarkdownSyntax = {
  prefix: string;
  suffix: string;
};

const markdownSyntaxByMark: Record<string, MarkdownSyntax> = {
  bold: { prefix: "**", suffix: "**" },
  italic: { prefix: "*", suffix: "*" },
  strike: { prefix: "~~", suffix: "~~" },
  code: { prefix: "`", suffix: "`" },
};

const activeMarkdownSyntaxPluginKey = new PluginKey(
  "activeMarkdownSyntax",
);

function getMarkRange($pos: any, mark: any) {
  const parent = $pos.parent;
  if (!parent.inlineContent || parent.childCount === 0) {
    return null;
  }

  let index = $pos.index();
  if (index === parent.childCount) {
    index -= 1;
  }

  if (index < 0 || !mark.isInSet(parent.child(index).marks)) {
    if (index > 0 && mark.isInSet(parent.child(index - 1).marks)) {
      index -= 1;
    } else {
      return null;
    }
  }

  let from = $pos.start();
  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    from += parent.child(currentIndex).nodeSize;
  }

  let to = from + parent.child(index).nodeSize;
  let startIndex = index;
  let endIndex = index + 1;

  while (
    startIndex > 0 &&
    mark.isInSet(parent.child(startIndex - 1).marks)
  ) {
    startIndex -= 1;
    from -= parent.child(startIndex).nodeSize;
  }

  while (
    endIndex < parent.childCount &&
    mark.isInSet(parent.child(endIndex).marks)
  ) {
    to += parent.child(endIndex).nodeSize;
    endIndex += 1;
  }

  return { from, to };
}

function getActiveMarkdownSyntax(mark: any): MarkdownSyntax | null {
  if (mark.type.name === "link") {
    const href = sanitizeLinkHref(mark.attrs.href);
    return href ? { prefix: "[", suffix: `](${href})` } : null;
  }

  return markdownSyntaxByMark[mark.type.name] ?? null;
}

const ActiveMarkdownSyntax = Extension.create({
  name: "activeMarkdownSyntax",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: activeMarkdownSyntaxPluginKey,
        props: {
          decorations: (state) => {
            if (!state.selection.empty) {
              return DecorationSet.empty;
            }

            const $head = state.selection.$head;
            const marks = new Map<string, any>();
            [...$head.marks(), ...($head.nodeAfter?.marks ?? [])].forEach(
              (mark) => {
                const syntax = getActiveMarkdownSyntax(mark);
                if (syntax) {
                  marks.set(
                    `${mark.type.name}:${JSON.stringify(mark.attrs)}`,
                    mark,
                  );
                }
              },
            );

            const decorations = [...marks.values()]
              .map((mark) => {
                const range = getMarkRange($head, mark);
                const syntax = getActiveMarkdownSyntax(mark);
                if (!range || !syntax) {
                  return null;
                }

                return Decoration.inline(range.from, range.to, {
                  class: "aiMarkdownSyntaxActive",
                  "data-markdown-prefix": syntax.prefix,
                  "data-markdown-suffix": syntax.suffix,
                });
              })
              .filter(Boolean) as Decoration[];

            return decorations.length
              ? DecorationSet.create(state.doc, decorations)
              : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

const MarkdownLinkInput = Extension.create({
  name: "markdownLinkInput",

  addInputRules() {
    const linkType = this.editor.schema.marks.link;
    if (!linkType) {
      return [];
    }

    return [
      new InputRule({
        find: /\[([^\]\n]+)\]\(([^\s)]+)\)$/,
        handler: ({ state, range, match }) => {
          const href = sanitizeLinkHref(match[2]);
          if (!href) {
            return null;
          }

          const label = match[1];
          const transaction = state.tr.insertText(label, range.from, range.to);
          transaction.addMark(
            range.from,
            range.from + label.length,
            linkType.create({ href }),
          );
          transaction.removeStoredMark(linkType);
          return transaction;
        },
      }),
    ];
  },
});

const MarkdownTaskListInput = Extension.create({
  name: "markdownTaskListInput",
  priority: 101,

  addInputRules() {
    const taskListType = this.editor.schema.nodes.taskList;
    const taskItemType = this.editor.schema.nodes.taskItem;
    if (!taskListType || !taskItemType) {
      return [];
    }

    return [
      new InputRule({
        find: /^\[([ xX])\]\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          let listDepth = -1;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === "bulletList") {
              listDepth = depth;
              break;
            }
          }

          if (listDepth < 0) {
            return null;
          }

          const listPosition = $from.before(listDepth);
          const listItemIndex = $from.index(listDepth);
          const transaction = state.tr.delete(range.from, range.to);
          const mappedListPosition = transaction.mapping.map(listPosition);
          const list = transaction.doc.nodeAt(mappedListPosition);
          if (!list) {
            return null;
          }

          const taskItems = [];
          for (let index = 0; index < list.childCount; index += 1) {
            taskItems.push(
              taskItemType.create(
                {
                  checked:
                    index === listItemIndex
                      ? match[1].toLowerCase() === "x"
                      : false,
                },
                list.child(index).content,
              ),
            );
          }

          transaction.replaceWith(
            mappedListPosition,
            mappedListPosition + list.nodeSize,
            taskListType.create(list.attrs, taskItems),
          );
          return transaction;
        },
      }),
    ];
  },
});

export function createAiMarkdownComposerExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      dropcursor: false,
      gapcursor: false,
      link: false,
      trailingNode: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    LinkExtension.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    Placeholder.configure({
      placeholder,
      showOnlyWhenEditable: true,
    }),
    MarkdownTaskListInput,
    MarkdownLinkInput,
    ActiveMarkdownSyntax,
  ];
}

export function insertMarkdownPaste(view: any, text: string) {
  const html = markdownToComposerHtml(text);
  if (!html) {
    return false;
  }

  const container = view.dom.ownerDocument.createElement("div");
  container.innerHTML = html;
  const slice = DOMParser.fromSchema(view.state.schema).parseSlice(container, {
    preserveWhitespace: true,
  });

  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}
