import { IAttachment } from "@/features/attachments/types/attachment.types";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type Translate = (key: string) => string;

export function getDiagramAttachmentSrc(attachment: IAttachment): string {
  const updatedAt = new Date(attachment.updatedAt).getTime();
  const cacheSuffix = Number.isFinite(updatedAt) ? `?t=${updatedAt}` : "";

  return `/api/attachments/files/${attachment.id}/${attachment.fileName}${cacheSuffix}`;
}

export function getDiagramAttachmentIdForSave(
  doc: ProseMirrorNode,
  attachmentId?: string,
): string | undefined {
  if (!attachmentId) {
    return undefined;
  }

  let references = 0;
  doc.descendants((node) => {
    if (node.attrs?.attachmentId === attachmentId) {
      references += 1;
    }
  });

  // A pasted diagram keeps the source attributes. Detach it on first save so
  // editing one node cannot replace the asset rendered by another node.
  return references > 1 ? undefined : attachmentId;
}

export function shouldCreateNewDiagramAttachment(error: unknown): boolean {
  const response = (
    error as { response?: { status?: number; data?: { message?: string } } }
  )?.response;

  return (
    (response?.status === 403 &&
      response.data?.message === "File attachment does not match") ||
    (response?.status === 404 &&
      response.data?.message === "Existing attachment to overwrite not found")
  );
}

export function getDiagramSaveErrorMessage(
  error: unknown,
  t: Translate,
): string {
  const responseMessage = (
    error as { response?: { data?: { message?: string } } }
  )?.response?.data?.message;

  return responseMessage || t("Failed to update data");
}
