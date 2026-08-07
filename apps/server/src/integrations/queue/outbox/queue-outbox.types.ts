import { IDuplicatePageAttachmentsJob } from '../constants/queue.interface';

export const QueueOutboxKind = {
  WORKSPACE_INVITATION_EMAIL: 'workspace_invitation_email',
  WORKSPACE_INVITATION_ACCEPTED_EMAIL: 'workspace_invitation_accepted_email',
  DUPLICATE_PAGE_ATTACHMENTS: 'duplicate_page_attachments',
  PAGE_TEMPLATE_SYNC: 'page_template_sync',
} as const;

export type QueueOutboxKind =
  (typeof QueueOutboxKind)[keyof typeof QueueOutboxKind];

export interface WorkspaceInvitationEmailOutboxPayload {
  workspaceId: string;
  invitationId: string;
  inviteeEmail: string;
  invitedByName: string;
  hostname?: string;
  tokenHash: string;
}

export interface WorkspaceInvitationAcceptedEmailOutboxPayload {
  invitationId: string;
  acceptedUserId: string;
  recipientEmail: string;
  invitedUserName: string;
  invitedUserEmail: string;
}

export type DuplicatePageAttachmentsOutboxPayload =
  IDuplicatePageAttachmentsJob;

export interface PageTemplateSyncOutboxPayload {
  runId: string;
}

export const PAGE_TEMPLATE_SYNC_HANDLER = 'PAGE_TEMPLATE_SYNC_HANDLER';

export interface PageTemplateSyncOutboxHandler {
  processSyncRunFromOutbox(runId: string): Promise<void>;
}

export interface WorkspaceInvitationEmailSecretPayload {
  inviteToken: string;
}
