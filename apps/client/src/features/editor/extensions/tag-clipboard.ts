import {
  Extension,
  getTextBetween,
  getTextSerializersFromSchema,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { getTagLabel } from "@docmost/editor-ext";

export function serializeTagClipboardText(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string {
  const textSerializers = getTextSerializersFromSchema(doc.type.schema);

  return getTextBetween(
    doc,
    { from, to },
    {
      textSerializers: {
        ...textSerializers,
        tag: ({ node }) => `::tag[${getTagLabel(node.attrs.value)}]`,
      },
    },
  );
}

export const TagClipboard = Extension.create({
  name: "tagClipboard",
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tagClipboard"),
        props: {
          handlePaste: (view, event, slice) => {
            const html = event.clipboardData?.getData("text/html");
            if (!html) {
              return false;
            }

            let containsTag = false;
            slice.content.descendants((node) => {
              if (node.type.name === "tag") {
                containsTag = true;
                return false;
              }
            });

            if (!containsTag) {
              return false;
            }

            event.preventDefault();
            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste"),
            );
            return true;
          },
          clipboardTextSerializer: () => {
            const { doc, selection } = this.editor.state;
            const from = Math.min(
              ...selection.ranges.map((range) => range.$from.pos),
            );
            const to = Math.max(
              ...selection.ranges.map((range) => range.$to.pos),
            );

            return serializeTagClipboardText(doc, from, to);
          },
        },
      }),
    ];
  },
});
