import type { Attachment } from '@docmost/db/types/entity.types';
import { createHash } from 'node:crypto';

export function attachmentMetadataVersion(attachment: Attachment) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        attachment.id,
        attachment.pageId,
        attachment.spaceId,
        attachment.filePath,
        attachment.fileName,
        attachment.mimeType,
        String(attachment.fileSize),
        attachment.updatedAt,
        attachment.contentIndexStatus,
        attachment.contentIndexVersion,
        attachment.contentIndexedAt,
      ]),
    )
    .digest('hex');
}

export function attachmentFileVersion(
  metadataVersion: string,
  storageVersion: string,
) {
  return createHash('sha256')
    .update(JSON.stringify([metadataVersion, storageVersion]))
    .digest('hex');
}
