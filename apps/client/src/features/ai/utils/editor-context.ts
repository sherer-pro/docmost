import { Editor } from "@tiptap/core";
import { htmlToMarkdown } from "@docmost/editor-ext";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { AiEditorContext } from "@/features/ai/types/ai.types.ts";

export interface AiPageAttachmentRef {
  id: string;
  name: string;
}

export function hashEditorDocument(document: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(document))));
}

export function captureAiEditorContext(
  editor: Editor,
  pageId: string,
): AiEditorContext {
  const document = editor.getJSON() as Record<string, unknown>;
  const { from, to } = editor.state.selection;

  return {
    pageId,
    document,
    documentHash: hashEditorDocument(document),
    markdown: htmlToMarkdown(editor.getHTML()),
    text: editor.getText({ blockSeparator: "\n\n" }),
    selection: {
      from,
      to,
      text: editor.state.doc.textBetween(from, to, "\n"),
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function isEditorContextCurrent(
  editor: Editor,
  pageId: string,
  context?: Pick<AiEditorContext, "pageId" | "documentHash">,
): boolean {
  if (!context || context.pageId !== pageId || !context.documentHash) {
    return false;
  }

  return hashEditorDocument(editor.getJSON()) === context.documentHash;
}

export function collectAiPageAttachments(
  document: unknown,
): AiPageAttachmentRef[] {
  const attachments = new Map<string, AiPageAttachmentRef>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") {
      return;
    }
    const node = value as {
      type?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    const attachmentId = node.attrs?.attachmentId;
    if (typeof attachmentId === "string" && attachmentId) {
      const nameCandidates = [
        node.attrs?.fileName,
        node.attrs?.title,
        node.attrs?.alt,
        node.type,
      ];
      const name =
        nameCandidates.find(
          (candidate) => typeof candidate === "string" && candidate.trim(),
        ) ?? "Attachment";
      attachments.set(attachmentId, {
        id: attachmentId,
        name: String(name),
      });
    }
    node.content?.forEach(visit);
  };

  visit(document);
  return [...attachments.values()];
}
