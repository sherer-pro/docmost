export interface AuditState {
  runId: string;
  spaceId: string;
  spaceSlug: string;
  spaceName: string;
  retained: boolean;
  createdAt: string;
}

export interface AttachmentRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface PageRecord {
  id: string;
  slugId: string;
  title: string;
  spaceId: string;
}
