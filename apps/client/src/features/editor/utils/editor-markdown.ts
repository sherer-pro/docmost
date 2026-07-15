import { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { addHeadingNumbersToJson, htmlToMarkdown } from "@docmost/editor-ext";

export function getEditorMarkdown(
  editor: Editor,
  headingNumberingEnabled: boolean,
): string {
  if (!headingNumberingEnabled) {
    return htmlToMarkdown(editor.getHTML());
  }

  const numberedJson = addHeadingNumbersToJson(editor.getJSON());
  const numberedDoc = editor.schema.nodeFromJSON(numberedJson);
  const ownerDocument = editor.view.dom.ownerDocument;
  const container = ownerDocument.createElement("div");
  container.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(
      numberedDoc.content,
      { document: ownerDocument },
    ),
  );
  return htmlToMarkdown(container.innerHTML);
}
