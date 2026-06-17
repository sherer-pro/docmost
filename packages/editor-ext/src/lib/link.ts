import { mergeAttributes } from "@tiptap/core";
import TiptapLink from "@tiptap/extension-link";
import { Plugin } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { sanitizeUrl } from "./utils";

export function sanitizeLinkHref(href: unknown): string {
  if (typeof href !== "string") {
    return "";
  }

  const sanitizedHref = sanitizeUrl(href).trim();
  if (!sanitizedHref || sanitizedHref.startsWith("//")) {
    return "";
  }

  return sanitizedHref;
}

export const LinkExtension = TiptapLink.extend({
  inclusive: false,

  parseHTML() {
    return [
      {
        tag: 'a[href]:not([data-type="button"])',
        getAttrs: (element) => {
          const href = sanitizeLinkHref(element.getAttribute("href"));
          if (!href) {
            return false;
          }

          return { href };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const href = sanitizeLinkHref(HTMLAttributes.href);

    return [
      "a",
      mergeAttributes(
        this.options.HTMLAttributes,
        { ...HTMLAttributes, href },
        {
          class: "link",
        },
      ),
      0,
    ];
  },

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      ...(this.parent?.() || []),
      new Plugin({
        props: {
          handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
            const { selection } = editor.state;

            if (event.key === "Escape" && selection.empty !== true) {
              editor.commands.focus(selection.to, { scrollIntoView: false });
            }

            return false;
          },
        },
      }),
    ];
  },
});
