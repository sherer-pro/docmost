import { Editor } from "@tiptap/core";

const CANONICAL_ATTACHMENT_FILE_PREFIX = "/api/attachments/files/";

export function buildAttachmentFileUrl(
  attachmentId: string,
  fileName: string,
): string {
  return `${CANONICAL_ATTACHMENT_FILE_PREFIX}${attachmentId}/${fileName}`;
}

export function normalizeFileUrl(src: string): string {
  if (!src) {
    return "";
  }

  if (src.startsWith("/api/files/public/")) {
    return src.replace(
      "/api/files/public/",
      `${CANONICAL_ATTACHMENT_FILE_PREFIX}public/`,
    );
  }

  if (src.startsWith("/api/files/")) {
    return src.replace("/api/files/", CANONICAL_ATTACHMENT_FILE_PREFIX);
  }

  if (src.startsWith("/files/public/")) {
    return src.replace(
      "/files/public/",
      `${CANONICAL_ATTACHMENT_FILE_PREFIX}public/`,
    );
  }

  if (src.startsWith("/files/")) {
    return src.replace("/files/", CANONICAL_ATTACHMENT_FILE_PREFIX);
  }

  return src;
}

export type UploadFn = (
  file: File,
  editor: Editor,
  pos: number,
  pageId: string,
  // only applicable to file attachments
  allowMedia?: boolean,
) => void;

export interface MediaUploadOptions {
  validateFn?: (file: File, allowMedia?: boolean) => void;
  onUpload: (file: File, pageId: string) => Promise<any>;
}
