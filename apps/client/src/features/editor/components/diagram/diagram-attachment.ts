import { IAttachment } from "@/features/attachments/types/attachment.types";

type Translate = (key: string) => string;

export function getDiagramAttachmentSrc(attachment: IAttachment): string {
  const updatedAt = new Date(attachment.updatedAt).getTime();
  const cacheSuffix = Number.isFinite(updatedAt) ? `?t=${updatedAt}` : "";

  return `/api/attachments/files/${attachment.id}/${attachment.fileName}${cacheSuffix}`;
}

export function getDiagramSaveErrorMessage(
  error: unknown,
  t: Translate,
): string {
  const responseMessage = (error as { response?: { data?: { message?: string } } })
    ?.response?.data?.message;

  return responseMessage || t("Failed to update data");
}
