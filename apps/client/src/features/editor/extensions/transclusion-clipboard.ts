import { Extension, type Editor } from "@tiptap/core";
import { DOMSerializer, type Fragment, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  getTransclusionPresentationAttributes,
  getTransclusionReferenceKey,
  htmlToMarkdown,
  TRANSCLUSION_CONTENT_ATTRIBUTE,
  TRANSCLUSION_LABEL_STYLE,
  type TransclusionPresentationStrings,
} from "@docmost/editor-ext";
import type { TransclusionLookup } from "@/features/transclusion/types/transclusion.types";
import i18n from "@/i18n";
import type { PageEmbedLookup } from "@/features/page-template/types/page-template.types";

export interface TransclusionClipboardStorage {
  items: Map<string, TransclusionLookup>;
  pageItems: Map<string, PageEmbedLookup>;
  pageItemOccurrences: Map<string, Map<string, PageEmbedLookup>>;
  maxPageEmbedDepth: number | null;
}

export interface TransclusionClipboardPayload {
  html: string;
  text: string;
}

export const TransclusionClipboard = Extension.create<
  Record<string, never>,
  TransclusionClipboardStorage
>({
  name: "transclusionClipboard",

  addStorage() {
    return {
      items: new Map(),
      pageItems: new Map(),
      pageItemOccurrences: new Map(),
      maxPageEmbedDepth: null,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: new PluginKey("transclusionClipboard"),
        props: {
          handleDOMEvents: {
            copy: (view, event) => {
              return writeMaterializedSelection(view, event as ClipboardEvent);
            },
            cut: (view, event) => {
              const clipboardEvent = event as ClipboardEvent;
              const handled = writeMaterializedSelection(view, clipboardEvent);
              if (handled) {
                view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
              }
              return handled;
            },
          },
        },
      }),
    ];

    function writeMaterializedSelection(
      view: EditorView,
      clipboardEvent: ClipboardEvent,
    ): boolean {
      if (!clipboardEvent.clipboardData) return false;

      const slice = view.state.selection.content();
      if (!fragmentHasMaterializedReference(slice.content)) return false;

      const ownerDocument = view.dom.ownerDocument;
      const container = ownerDocument.createElement("div");
      container.appendChild(
        DOMSerializer.fromSchema(view.state.schema).serializeFragment(
          slice.content,
          { document: ownerDocument },
        ),
      );
      const payload = createTransclusionClipboardPayload({
        container,
        schema: view.state.schema,
        resolutions: storage.items,
        pageResolutions: storage.pageItems,
        maxPageEmbedDepth: storage.maxPageEmbedDepth,
        strings: getStrings(),
      });

      clipboardEvent.clipboardData.setData("text/html", payload.html);
      clipboardEvent.clipboardData.setData("text/plain", payload.text);
      clipboardEvent.preventDefault();
      return true;
    }
  },
});

export function buildSyncedBlockClipboardPayload(params: {
  editor: Editor;
  content: Fragment;
  sourcePageId: string;
  transclusionId: string;
  strings?: TransclusionPresentationStrings;
}): TransclusionClipboardPayload {
  const ownerDocument = params.editor.view.dom.ownerDocument;
  const container = ownerDocument.createElement("div");
  const reference = ownerDocument.createElement("div");
  reference.setAttribute("data-type", "transclusionReference");
  reference.setAttribute("data-source-page-id", params.sourcePageId);
  reference.setAttribute("data-transclusion-id", params.transclusionId);
  applyPresentationAttributes(reference);

  const content = ownerDocument.createElement("div");
  content.setAttribute(TRANSCLUSION_CONTENT_ATTRIBUTE, "");
  content.appendChild(
    DOMSerializer.fromSchema(params.editor.schema).serializeFragment(
      params.content,
      { document: ownerDocument },
    ),
  );
  reference.appendChild(content);
  container.appendChild(reference);

  return createTransclusionClipboardPayload({
    container,
    schema: params.editor.schema,
    resolutions: new Map(),
    strings: params.strings ?? getStrings(),
  });
}

export async function writeTransclusionClipboard(
  payload: TransclusionClipboardPayload,
): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
      }),
    ]);
    return;
  }

  await navigator.clipboard.writeText(payload.text);
}

export function createTransclusionClipboardPayload(params: {
  container: HTMLElement;
  schema: Schema;
  resolutions: Map<string, TransclusionLookup>;
  pageResolutions?: Map<string, PageEmbedLookup>;
  maxPageEmbedDepth?: number | null;
  strings: TransclusionPresentationStrings;
}): TransclusionClipboardPayload {
  const serializer = DOMSerializer.fromSchema(params.schema);
  const ownerDocument = params.container.ownerDocument;

  params.container
    .querySelectorAll<HTMLElement>(
      '[data-type="transclusionSource"], [data-type="transclusionReference"]',
    )
    .forEach((element) => {
      applyPresentationAttributes(element);

      let content = element.querySelector<HTMLElement>(
        `:scope > [${TRANSCLUSION_CONTENT_ATTRIBUTE}]`,
      );
      if (!content) {
        content = ownerDocument.createElement("div");
        content.setAttribute(TRANSCLUSION_CONTENT_ATTRIBUTE, "");
        element.appendChild(content);
      }

      if (element.dataset.type === "transclusionReference") {
        const resolution = params.resolutions.get(
          getTransclusionReferenceKey(
            element.dataset.sourcePageId,
            element.dataset.transclusionId,
          ),
        );

        if (resolution && !("status" in resolution)) {
          content.replaceChildren();
          try {
            const documentNode = params.schema.nodeFromJSON(
              resolution.content as any,
            );
            content.appendChild(
              serializer.serializeFragment(documentNode.content, {
                document: ownerDocument,
              }),
            );
          } catch {
            appendUnavailable(content, params.strings.unavailable);
          }
        } else if (resolution || !content.hasChildNodes()) {
          content.replaceChildren();
          appendUnavailable(content, params.strings.unavailable);
        }
      }

      if (
        !element.querySelector(
          ':scope > [data-docmost-transclusion-label="true"]',
        )
      ) {
        const label = ownerDocument.createElement("div");
        label.setAttribute("data-docmost-transclusion-label", "true");
        label.setAttribute("style", TRANSCLUSION_LABEL_STYLE);
        label.textContent = params.strings.label;
        element.insertBefore(label, content);
      }
    });

  for (let depth = 0; depth < (params.maxPageEmbedDepth ?? 0); depth += 1) {
    const embeds = Array.from(
      params.container.querySelectorAll<HTMLElement>('[data-type="pageEmbed"]'),
    );
    if (embeds.length === 0) break;
    for (const element of embeds) {
      const sourcePageId = element.dataset.sourcePageId;
      const resolution = sourcePageId
        ? params.pageResolutions?.get(sourcePageId)
        : undefined;
      const replacement = ownerDocument.createElement("div");
      if (resolution && !("status" in resolution)) {
        try {
          const documentNode = params.schema.nodeFromJSON(
            resolution.content as any,
          );
          replacement.appendChild(
            serializer.serializeFragment(documentNode.content, {
              document: ownerDocument,
            }),
          );
        } catch {
          appendUnavailable(replacement, params.strings.unavailable);
        }
      } else {
        appendUnavailable(replacement, params.strings.unavailable);
      }
      element.replaceWith(...Array.from(replacement.childNodes));
    }
  }
  params.container
    .querySelectorAll<HTMLElement>('[data-type="pageEmbed"]')
    .forEach((element) => {
      const replacement = ownerDocument.createElement("div");
      appendUnavailable(replacement, params.strings.unavailable);
      element.replaceWith(...Array.from(replacement.childNodes));
    });

  const html = params.container.innerHTML;
  return {
    html,
    text: htmlToMarkdown(html, { transclusion: params.strings }),
  };
}

function fragmentHasMaterializedReference(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (
      node.type.name === "transclusionSource" ||
      node.type.name === "transclusionReference" ||
      node.type.name === "pageEmbed"
    ) {
      found = true;
      return false;
    }
  });
  return found;
}

function applyPresentationAttributes(element: HTMLElement): void {
  for (const [name, value] of Object.entries(
    getTransclusionPresentationAttributes(),
  )) {
    element.setAttribute(name, value);
  }
}

function appendUnavailable(element: HTMLElement, text: string): void {
  const paragraph = element.ownerDocument.createElement("p");
  paragraph.textContent = text;
  element.appendChild(paragraph);
}

function getStrings(): TransclusionPresentationStrings {
  return {
    label: i18n.t("Synced block"),
    unavailable: i18n.t("Synced block content unavailable"),
  };
}
