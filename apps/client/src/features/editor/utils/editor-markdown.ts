import { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  addHeadingNumbersToJson,
  collectTransclusionPresentationReferences,
  getTransclusionReferenceKey,
  htmlToMarkdown,
  materializeTransclusionsForPresentation,
  type TransclusionPresentationStrings,
} from "@docmost/editor-ext";
import { lookupTransclusion } from "@/features/transclusion/services/transclusion-api";
import i18n from "@/i18n";

export async function getEditorMarkdown(
  editor: Editor,
  headingNumberingEnabled: boolean,
  options: {
    lookup?: typeof lookupTransclusion;
    strings?: TransclusionPresentationStrings;
  } = {},
): Promise<string> {
  const strings = options.strings ?? {
    label: i18n.t("Synced block"),
    unavailable: i18n.t("Synced block content unavailable"),
  };
  const document = editor.getJSON();
  const references = collectTransclusionPresentationReferences(document);
  const resolutions = new Map();

  if (references.length > 0) {
    const result = await (options.lookup ?? lookupTransclusion)({ references });
    for (const item of result.items) {
      resolutions.set(
        getTransclusionReferenceKey(item.sourcePageId, item.transclusionId),
        item,
      );
    }
  }

  let presentationJson = materializeTransclusionsForPresentation(
    document,
    resolutions,
    strings,
  );
  if (headingNumberingEnabled) {
    presentationJson = addHeadingNumbersToJson(presentationJson as any) as any;
  }

  const presentationDoc = editor.schema.nodeFromJSON(presentationJson);
  const ownerDocument = editor.view.dom.ownerDocument;
  const container = ownerDocument.createElement("div");
  container.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(
      presentationDoc.content,
      { document: ownerDocument },
    ),
  );
  return htmlToMarkdown(container.innerHTML, { transclusion: strings });
}
