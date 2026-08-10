import { IDuplicatePageAttachmentsJob } from '../constants/queue.interface';
import {
  ICommentNotificationJob,
  ICommentResolvedNotificationJob,
} from '../constants/queue.interface';
import { QueueJob } from '../constants';

export const QueueOutboxKind = {
  WORKSPACE_INVITATION_EMAIL: 'workspace_invitation_email',
  WORKSPACE_INVITATION_ACCEPTED_EMAIL: 'workspace_invitation_accepted_email',
  DUPLICATE_PAGE_ATTACHMENTS: 'duplicate_page_attachments',
  PAGE_TEMPLATE_SYNC: 'page_template_sync',
  NOTIFICATION_EMAIL: 'notification_email',
  NOTIFICATION_DISPATCH: 'notification_dispatch',
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

export interface NotificationEmailOutboxPayload {
  notificationId: string;
}

export interface NotificationEmailSecretPayload {
  message: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    notificationId: string;
    notificationUserId: string;
    notificationDeliveryMode: 'immediate';
    notificationFrequency: string;
  };
}

export const NOTIFICATION_EMAIL_DELIVERY_POLICY_HANDLER =
  'NOTIFICATION_EMAIL_DELIVERY_POLICY_HANDLER';

export interface NotificationEmailDeliveryPolicyHandler {
  isNotificationEmailStillDeliverable(
    message: NotificationEmailSecretPayload['message'],
  ): Promise<boolean>;
}

export interface NotificationDispatchOutboxPayload {
  jobName:
    | QueueJob.COMMENT_NOTIFICATION
    | QueueJob.COMMENT_RESOLVED_NOTIFICATION;
  jobData: ICommentNotificationJob | ICommentResolvedNotificationJob;
}

export const PAGE_TEMPLATE_SYNC_HANDLER = 'PAGE_TEMPLATE_SYNC_HANDLER';

export interface PageTemplateSyncOutboxHandler {
  processSyncRunFromOutbox(runId: string): Promise<void>;
}

export interface WorkspaceInvitationEmailSecretPayload {
  inviteToken: string;
}
