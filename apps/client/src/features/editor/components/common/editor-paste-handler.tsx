import { uploadImageAction } from "@/features/editor/components/image/upload-image-action.tsx";
import { uploadVideoAction } from "@/features/editor/components/video/upload-video-action.tsx";
import { uploadAttachmentAction } from "../attachment/upload-attachment-action";
import { createMentionAction } from "@/features/editor/components/link/internal-link-paste.ts";
import { createLinkPreviewAction } from "@/features/editor/components/link-preview/link-preview-action";
import { INTERNAL_LINK_REGEX } from "@/lib/constants.ts";
import { Editor } from "@tiptap/core";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export interface HandlePasteOptions {
  plainTextRequested?: boolean;
}

export const handlePaste = (
  editor: Editor,
  event: ClipboardEvent,
  pageId: string,
  creatorId?: string,
  options?: HandlePasteOptions,
) => {
  const clipboardData = event.clipboardData.getData("text/plain");

  if (INTERNAL_LINK_REGEX.test(clipboardData)) {
    // we have to do this validation here to allow the default link extension to takeover if needs be
    event.preventDefault();
    const url = clipboardData.trim();
    const { from: pos, empty } = editor.state.selection;
    const match = INTERNAL_LINK_REGEX.exec(url);
    const currentPageMatch = INTERNAL_LINK_REGEX.exec(window.location.href);

    // pasted link must be from the same workspace/domain and must not be on a selection
    if (!empty || match[2] !== window.location.host) {
      // allow the default link extension to handle this
      return false;
    }

    // for now, we only support internal links from the same space
    // compare space name
    if (currentPageMatch[4].toLowerCase() !== match[4].toLowerCase()) {
      return false;
    }

    const anchorId = match[6] ? match[6].split("#")[0] : undefined;
    const urlWithoutAnchor = anchorId
      ? url.substring(0, url.indexOf("#"))
      : url;
    createMentionAction(
      urlWithoutAnchor,
      editor.view,
      pos,
      creatorId,
      anchorId,
    );
    return true;
  }

  if (event.clipboardData?.files.length) {
    event.preventDefault();
    for (const file of event.clipboardData.files) {
      const pos = editor.state.selection.from;
      uploadImageAction(file, editor, pos, pageId);
      uploadVideoAction(file, editor, pos, pageId);
      uploadAttachmentAction(file, editor, pos, pageId);
    }
    return true;
  }

    // Convert plain URL into a preview card only for regular paste actions.
  // For plain-text paste (Ctrl/Cmd+Shift+V or context menu "Paste as text"),
  // keep default behavior and skip preview insertion.
  const trimmedClipboardData = clipboardData.trim();
  const isPlainTextPaste =
    options?.plainTextRequested === true ||
    (event as ClipboardEvent & { shiftKey?: boolean }).shiftKey === true;
  const hasSelection = !editor.state.selection.empty;

  if (
    !isPlainTextPaste &&
    !hasSelection &&
    isHttpUrl(trimmedClipboardData)
  ) {
    event.preventDefault();
    void createLinkPreviewAction(editor, trimmedClipboardData).then((inserted) => {
      if (!inserted) {
        editor.chain().focus().insertContent(trimmedClipboardData).run();
      }
    });

    return true;
  }

  return false;
};

export const handleFileDrop = (
  editor: Editor,
  event: DragEvent,
  moved: boolean,
  pageId: string,
) => {
  if (!moved && event.dataTransfer?.files.length) {
    event.preventDefault();

    for (const file of event.dataTransfer.files) {
      const coordinates = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });

      uploadImageAction(file, editor, coordinates?.pos ?? 0 - 1, pageId);
      uploadVideoAction(file, editor, coordinates?.pos ?? 0 - 1, pageId);
      uploadAttachmentAction(file, editor, coordinates?.pos ?? 0 - 1, pageId);
    }
    return true;
  }
  return false;
};
