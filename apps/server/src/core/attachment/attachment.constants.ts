export enum AttachmentType {
  Avatar = 'avatar',
  WorkspaceIcon = 'workspace-icon',
  SpaceIcon = 'space-icon',
  File = 'file',
}

export const validImageExtensions = ['.jpg', '.png', '.jpeg'];
export const MAX_AVATAR_SIZE = '10MB';

/** Attachment formats whose text is extracted for full-text search. */
export const CONTENT_INDEXABLE_EXTENSIONS = ['.pdf', '.docx'] as const;

export const inlineFileExtensions = [
  '.jpg',
  '.png',
  '.jpeg',
  '.pdf',
  '.mp4',
  '.mov',
];
