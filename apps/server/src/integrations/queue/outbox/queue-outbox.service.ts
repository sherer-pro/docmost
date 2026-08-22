import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { Queue } from 'bullmq';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { validate as isUuid, v7 as uuid7 } from 'uuid';
import type { JsonValue } from '@docmost/db/types/db';
import { QueueOutboxEntry } from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { QueueOutboxRepo } from '@docmost/db/repos/queue-outbox/queue-outbox.repo';
import {
  decryptProtectedValue,
  encryptProtectedValue,
  isEncryptedProtectedValue,
  safeStringEqual,
} from '../../../common/security/credential-protection.util';
import { EnvironmentService } from '../../environment/environment.service';
import { DomainService } from '../../environment/domain.service';
import { MailService } from '../../mail/mail.service';
import InvitationEmail from '@docmost/transactional/emails/invitation-email';
import InvitationAcceptedEmail from '@docmost/transactional/emails/invitation-accepted-email';
import { QueueJob, QueueName } from '../constants';
import type { PageRecipientNotificationReason } from '../constants/queue.interface';
import { DuplicatePageAttachmentsService } from '../services/duplicate-page-attachments.service';
import {
  DuplicatePageAttachmentsOutboxPayload,
  AttachmentCleanupOutboxPayload,
  FileImportOutboxPayload,
  NotificationEmailOutboxPayload,
  NotificationEmailSecretPayload,
  NotificationDispatchOutboxPayload,
  PageTemplateSyncOutboxPayload,
  QueueOutboxKind,
  WorkspaceInvitationAcceptedEmailOutboxPayload,
  WorkspaceInvitationEmailOutboxPayload,
  WorkspaceInvitationEmailSecretPayload,
} from './queue-outbox.types';
import { QueueOutboxHandlerRegistryService } from './queue-outbox-handler-registry.service';

const OUTBOX_LEASE_MS = 2 * 60 * 1000;
const OUTBOX_LEASE_RENEW_MS = 30 * 1000;
const OUTBOX_BATCH_SIZE = 50;
const OUTBOX_RETRY_BASE_MS = 5 * 1000;
const OUTBOX_RETRY_MAX_MS = 15 * 60 * 1000;
const OUTBOX_MAX_ATTEMPTS = 20;
const ATTACHMENT_CLEANUP_INSERT_CHUNK_SIZE = 1_000;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_FAILED_DELIVERY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const OUTBOX_PURGE_BATCH_SIZE = 1_000;
const OUTBOX_PURGE_MAX_BATCHES_PER_KIND = 20;
const OUTBOX_EXPIRABLE_FAILED_KINDS = [
  QueueOutboxKind.WORKSPACE_INVITATION_EMAIL,
  QueueOutboxKind.WORKSPACE_INVITATION_ACCEPTED_EMAIL,
  QueueOutboxKind.NOTIFICATION_EMAIL,
  QueueOutboxKind.NOTIFICATION_DISPATCH,
] as const;
const PAGE_RECIPIENT_NOTIFICATION_REASONS =
  new Set<PageRecipientNotificationReason>([
    'document-changed',
    'page-assigned',
    'page-stakeholder-added',
    'database-user-assigned',
  ]);

type ProcessingOutcome = 'completed' | 'cancelled';

class PermanentOutboxError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = PermanentOutboxError.name;
  }
}

@Injectable()
export class QueueOutboxService {
  private readonly logger = new Logger(QueueOutboxService.name);
  private processingPromise?: Promise<void>;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly outboxRepo: QueueOutboxRepo,
    private readonly environmentService: EnvironmentService,
    private readonly domainService: DomainService,
    private readonly mailService: MailService,
    private readonly duplicatePageAttachments: DuplicatePageAttachmentsService,
    @InjectQueue(QueueName.GENERAL_QUEUE)
    private readonly generalQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly handlerRegistry: QueueOutboxHandlerRegistryService,
  ) {}

  async enqueueWorkspaceInvitationEmail(
    payload: WorkspaceInvitationEmailOutboxPayload & { inviteToken: string },
    trx: KyselyTransaction,
  ): Promise<void> {
    const { inviteToken, ...publicPayload } = payload;
    const secretPayload = encryptProtectedValue(
      JSON.stringify({
        inviteToken,
      } satisfies WorkspaceInvitationEmailSecretPayload),
      this.environmentService.getAppSecret(),
    );

    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.WORKSPACE_INVITATION_EMAIL,
        payload: publicPayload as unknown as JsonValue,
        secretPayload,
        dedupeKey: `workspace-invitation-email:${payload.invitationId}:${payload.tokenHash}`,
      },
      trx,
    );
  }

  async enqueueWorkspaceInvitationAcceptedEmail(
    payload: WorkspaceInvitationAcceptedEmailOutboxPayload,
    trx: KyselyTransaction,
  ): Promise<void> {
    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.WORKSPACE_INVITATION_ACCEPTED_EMAIL,
        payload: payload as unknown as JsonValue,
        dedupeKey: `workspace-invitation-accepted-email:${payload.invitationId}:${payload.acceptedUserId}`,
      },
      trx,
    );
  }

  async enqueueDuplicatePageAttachments(
    payload: DuplicatePageAttachmentsOutboxPayload,
    trx: KyselyTransaction,
  ): Promise<void> {
    const outboxId = await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS,
        payload: payload as unknown as JsonValue,
        dedupeKey: `duplicate-page-attachments:${payload.rootPageId}:${payload.newPageId}`,
      },
      trx,
    );
    if (!outboxId) {
      throw new Error('duplicate_page_attachment_outbox_not_inserted');
    }
    await this.outboxRepo.pinDuplicatePageAttachments(
      outboxId,
      payload.attachmentMappings.map((mapping) => mapping.oldAttachmentId),
      trx,
    );
  }

  async enqueuePageTemplateSync(
    payload: PageTemplateSyncOutboxPayload,
    dispatchId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.PAGE_TEMPLATE_SYNC,
        payload: payload as unknown as JsonValue,
        dedupeKey: `page-template-sync:${payload.runId}:${dispatchId}`,
      },
      trx,
    );
  }

  async enqueueNotificationEmail(
    notificationId: string,
    message: NotificationEmailSecretPayload['message'],
    trx: KyselyTransaction,
  ): Promise<void> {
    if (
      Object.prototype.hasOwnProperty.call(message, 'template') ||
      message.notificationId !== notificationId ||
      message.notificationDeliveryMode !== 'immediate'
    ) {
      throw new Error('notification_email_message_not_prepared');
    }

    const secretPayload = encryptProtectedValue(
      JSON.stringify({ message } satisfies NotificationEmailSecretPayload),
      this.environmentService.getAppSecret(),
    );
    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.NOTIFICATION_EMAIL,
        payload: { notificationId } satisfies NotificationEmailOutboxPayload,
        secretPayload,
        dedupeKey: `notification-email:${notificationId}`,
      },
      trx,
    );
  }

  async enqueueNotificationDispatch(
    payload: NotificationDispatchOutboxPayload,
    trx: KyselyTransaction,
  ): Promise<void> {
    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.NOTIFICATION_DISPATCH,
        payload: payload as unknown as JsonValue,
        dedupeKey: `notification-dispatch:${payload.jobName}:${payload.jobData.eventId}`,
      },
      trx,
    );
  }

  async enqueuePageAttachmentCleanup(
    pageIds: string[],
    rootPageId: string,
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    if (pageIds.length === 0) return false;
    const attachments = await trx
      .selectFrom('attachments')
      .select(['id', 'filePath'])
      .where('workspaceId', '=', workspaceId)
      .where(sql<boolean>`${sql.ref('pageId')} = any(${pageIds}::uuid[])`)
      .execute();
    return this.stageAttachmentCleanup(
      attachments,
      'page',
      rootPageId,
      workspaceId,
      trx,
    );
  }

  async enqueueSpaceAttachmentCleanup(
    spaceId: string,
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    const attachments = await trx
      .selectFrom('attachments')
      .select(['id', 'filePath'])
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .execute();
    return this.stageAttachmentCleanup(
      attachments,
      'space',
      spaceId,
      workspaceId,
      trx,
    );
  }

  async enqueueUserAvatarCleanup(
    userId: string,
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    const attachments = await trx
      .selectFrom('attachments')
      .select(['id', 'filePath'])
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', '=', userId)
      .where('type', '=', 'avatar')
      .execute();
    return this.stageAttachmentCleanup(
      attachments,
      'user_avatar',
      userId,
      workspaceId,
      trx,
    );
  }

  async enqueueFileImport(
    fileTaskId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.FILE_IMPORT,
        payload: { fileTaskId } satisfies FileImportOutboxPayload,
        dedupeKey: `file-import:${fileTaskId}`,
      },
      trx,
    );
  }

  private async stageAttachmentCleanup(
    attachments: Array<{ id: string; filePath: string }>,
    scopeType: string,
    scopeId: string,
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    if (attachments.length === 0) return false;
    if (
      await this.outboxRepo.hasDuplicatePageAttachmentPins(
        attachments.map(({ id }) => id),
        trx,
      )
    ) {
      throw new ConflictException({
        code: 'page_attachment_copy_in_progress',
        message:
          'Wait for page attachment duplication or operator recovery to finish first',
      });
    }

    const batchId = uuid7();
    const batch = await trx
      .insertInto('attachmentCleanupBatches')
      .values({
        id: batchId,
        workspaceId,
        scopeType,
        scopeId,
        status: 'pending',
        itemCount: attachments.length,
      })
      .onConflict((oc) => oc.columns(['scopeType', 'scopeId']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!batch) return false;

    for (
      let offset = 0;
      offset < attachments.length;
      offset += ATTACHMENT_CLEANUP_INSERT_CHUNK_SIZE
    ) {
      const chunk = attachments.slice(
        offset,
        offset + ATTACHMENT_CLEANUP_INSERT_CHUNK_SIZE,
      );
      await trx
        .insertInto('attachmentCleanupItems')
        .values(
          chunk.map((attachment) => ({
            batchId,
            attachmentId: attachment.id,
            filePath: attachment.filePath,
            status: 'pending',
          })),
        )
        .execute();
    }
    await trx
      .deleteFrom('attachments')
      .where(
        sql<boolean>`${sql.ref('id')} = any(${attachments.map(({ id }) => id)}::uuid[])`,
      )
      .execute();
    await this.outboxRepo.enqueue(
      {
        kind: QueueOutboxKind.ATTACHMENT_CLEANUP,
        payload: { batchId } satisfies AttachmentCleanupOutboxPayload,
        dedupeKey: `attachment-cleanup:${batchId}`,
      },
      trx,
    );
    return true;
  }

  kick(): void {
    void this.generalQueue
      .add(
        QueueJob.PROCESS_QUEUE_OUTBOX,
        {},
        {
          jobId: 'queue-outbox-kick',
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch(() => {
        this.logger.warn(
          'Failed to queue an immediate outbox sweep; the periodic sweep will retry',
        );
      });
  }

  async ensurePeriodicSweep(): Promise<void> {
    await Promise.all([
      this.generalQueue.add(
        QueueJob.PROCESS_QUEUE_OUTBOX,
        {},
        {
          jobId: 'queue-outbox-periodic-sweep',
          repeat: { every: 15_000 },
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 10,
        },
      ),
      this.generalQueue.add(
        QueueJob.PURGE_QUEUE_OUTBOX,
        {},
        {
          jobId: 'queue-outbox-hourly-purge',
          repeat: { every: 60 * 60 * 1000 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: 10,
        },
      ),
    ]);
  }

  async purgeExpiredTerminalEntries(): Promise<number> {
    const completedBefore = new Date(Date.now() - OUTBOX_RETENTION_MS);
    const failedDeliveryBefore = new Date(
      Date.now() - OUTBOX_FAILED_DELIVERY_RETENTION_MS,
    );
    let total = 0;
    let deleted = 0;
    let batches = 0;

    do {
      deleted = await this.outboxRepo.purgeCompletedOrCancelledBefore(
        completedBefore,
        OUTBOX_PURGE_BATCH_SIZE,
      );
      total += deleted;
      batches += 1;
    } while (
      deleted === OUTBOX_PURGE_BATCH_SIZE &&
      batches < OUTBOX_PURGE_MAX_BATCHES_PER_KIND
    );

    batches = 0;
    do {
      deleted = await this.outboxRepo.purgeFailedKindsBefore(
        failedDeliveryBefore,
        OUTBOX_EXPIRABLE_FAILED_KINDS,
        OUTBOX_PURGE_BATCH_SIZE,
      );
      total += deleted;
      batches += 1;
    } while (
      deleted === OUTBOX_PURGE_BATCH_SIZE &&
      batches < OUTBOX_PURGE_MAX_BATCHES_PER_KIND
    );

    return total;
  }

  async processAvailable(limit = OUTBOX_BATCH_SIZE): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = this.processBatch(limit).finally(() => {
      this.processingPromise = undefined;
    });
    return this.processingPromise;
  }

  private async processBatch(limit: number): Promise<void> {
    for (let index = 0; index < limit; index += 1) {
      const leaseToken = uuid7();
      const entry = await this.outboxRepo.claimNext(
        leaseToken,
        OUTBOX_LEASE_MS,
      );
      if (!entry) {
        return;
      }
      await this.processClaimedEntry(entry, leaseToken);
    }
  }

  private async processClaimedEntry(
    entry: QueueOutboxEntry,
    leaseToken: string,
  ): Promise<void> {
    const lease = this.startLeaseRenewal(entry.id, leaseToken);
    let outcome: ProcessingOutcome | undefined;
    let processingError: unknown;

    try {
      outcome = await this.dispatch(entry);
    } catch (error) {
      processingError = error;
    }

    await lease.stop();
    if (lease.isLost()) {
      this.logger.warn(
        `Outbox entry ${entry.id} lost its lease before finalization`,
      );
      return;
    }

    if (!processingError && outcome) {
      const finalized =
        outcome === 'completed'
          ? entry.kind === QueueOutboxKind.NOTIFICATION_EMAIL
            ? await this.outboxRepo.markNotificationEmailCompleted(
                entry.id,
                leaseToken,
                this.parseNotificationEmail(entry.payload).notificationId,
              )
            : entry.kind === QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS
              ? await this.outboxRepo.markDuplicatePageAttachmentsCompleted(
                  entry.id,
                  leaseToken,
                )
              : await this.outboxRepo.markCompleted(entry.id, leaseToken)
          : await this.outboxRepo.markCancelled(entry.id, leaseToken);
      if (!finalized) {
        this.logger.warn(
          `Outbox entry ${entry.id} was not finalized because its lease changed`,
        );
      }
      return;
    }

    if (processingError instanceof PermanentOutboxError) {
      const finalized = await this.markEntryFailed(
        entry,
        leaseToken,
        processingError.code,
      );
      if (!finalized) {
        this.logger.warn(
          `Outbox entry ${entry.id} was not failed because its lease changed`,
        );
        return;
      }
      this.logger.error(
        `Outbox entry ${entry.id} failed permanently with code ${processingError.code}`,
      );
      return;
    }

    if (entry.attemptCount >= OUTBOX_MAX_ATTEMPTS) {
      const finalized = await this.markEntryFailed(
        entry,
        leaseToken,
        'retry_exhausted',
      );
      if (!finalized) {
        this.logger.warn(
          `Outbox entry ${entry.id} was not failed because its lease changed`,
        );
        return;
      }
      this.logger.error(
        `Outbox entry ${entry.id} exhausted its processing attempts`,
      );
      return;
    }

    const retryDelay = Math.min(
      OUTBOX_RETRY_BASE_MS * 2 ** Math.min(entry.attemptCount - 1, 16),
      OUTBOX_RETRY_MAX_MS,
    );
    const returnedToPending = await this.outboxRepo.markForRetry(
      entry.id,
      leaseToken,
      new Date(Date.now() + retryDelay),
      'transient_processing_error',
    );
    if (!returnedToPending) {
      this.logger.warn(
        `Outbox entry ${entry.id} was not retried because its lease changed`,
      );
      return;
    }
    this.logger.warn(
      `Outbox entry ${entry.id} returned to pending after a transient failure`,
    );
  }

  private startLeaseRenewal(
    id: string,
    leaseToken: string,
  ): {
    isLost: () => boolean;
    stop: () => Promise<void>;
  } {
    let stopped = false;
    let lost = false;
    let timer: NodeJS.Timeout | undefined;
    let renewal = Promise.resolve();

    const schedule = () => {
      if (stopped || lost) return;
      timer = setTimeout(() => {
        renewal = (async () => {
          try {
            const renewed = await this.outboxRepo.renewLease(
              id,
              leaseToken,
              OUTBOX_LEASE_MS,
            );
            if (!renewed) {
              lost = true;
              return;
            }
          } catch {
            lost = true;
            return;
          }
          schedule();
        })();
      }, OUTBOX_LEASE_RENEW_MS);
    };

    schedule();
    return {
      isLost: () => lost,
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await renewal;
      },
    };
  }

  private markEntryFailed(
    entry: QueueOutboxEntry,
    leaseToken: string,
    errorCode: string,
  ): Promise<boolean> {
    const redactedPayload = this.redactFailedDeliveryPayload(entry);
    return redactedPayload === undefined
      ? this.outboxRepo.markFailed(entry.id, leaseToken, errorCode)
      : this.outboxRepo.markFailed(
          entry.id,
          leaseToken,
          errorCode,
          redactedPayload,
        );
  }

  private redactFailedDeliveryPayload(
    entry: QueueOutboxEntry,
  ): JsonValue | undefined {
    if (
      entry.kind !== QueueOutboxKind.WORKSPACE_INVITATION_EMAIL &&
      entry.kind !== QueueOutboxKind.WORKSPACE_INVITATION_ACCEPTED_EMAIL
    ) {
      return undefined;
    }

    const payload =
      typeof entry.payload === 'object' &&
      entry.payload !== null &&
      !Array.isArray(entry.payload)
        ? (entry.payload as Record<string, unknown>)
        : {};
    const redacted: Record<string, JsonValue> = { redacted: true };
    for (const key of ['workspaceId', 'invitationId', 'acceptedUserId']) {
      if (typeof payload[key] === 'string' && isUuid(payload[key])) {
        redacted[key] = payload[key];
      }
    }
    return redacted;
  }

  private async dispatch(entry: QueueOutboxEntry): Promise<ProcessingOutcome> {
    switch (entry.kind) {
      case QueueOutboxKind.WORKSPACE_INVITATION_EMAIL:
        return this.processWorkspaceInvitationEmail(entry);
      case QueueOutboxKind.WORKSPACE_INVITATION_ACCEPTED_EMAIL:
        return this.processWorkspaceInvitationAcceptedEmail(entry.payload);
      case QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS:
        await this.duplicatePageAttachments.process(
          this.parseDuplicatePageAttachments(entry.payload),
        );
        return 'completed';
      case QueueOutboxKind.PAGE_TEMPLATE_SYNC: {
        const payload = this.parsePageTemplateSync(entry.payload);
        const handler = this.handlerRegistry.getPageTemplateSync();
        await handler.processSyncRunFromOutbox(payload.runId);
        return 'completed';
      }
      case QueueOutboxKind.NOTIFICATION_EMAIL:
        return this.processNotificationEmail(entry);
      case QueueOutboxKind.NOTIFICATION_DISPATCH: {
        const payload = this.parseNotificationDispatch(entry.payload);
        await this.notificationQueue.add(payload.jobName, payload.jobData, {
          jobId: `notification-dispatch-${payload.jobData.eventId}`,
        });
        return 'completed';
      }
      case QueueOutboxKind.ATTACHMENT_CLEANUP: {
        const payload = this.parseAttachmentCleanup(entry.payload);
        await this.handlerRegistry
          .getAttachmentCleanup()
          .processCleanupBatchFromOutbox(payload.batchId);
        return 'completed';
      }
      case QueueOutboxKind.FILE_IMPORT: {
        const payload = this.parseFileImport(entry.payload);
        await this.handlerRegistry
          .getFileImport()
          .processImportFromOutbox(payload.fileTaskId);
        return 'completed';
      }
      default:
        throw new PermanentOutboxError('unknown_outbox_kind');
    }
  }

  private async processNotificationEmail(
    entry: QueueOutboxEntry,
  ): Promise<ProcessingOutcome> {
    const payload = this.parseNotificationEmail(entry.payload);
    const secret = this.parseNotificationEmailSecret(entry.secretPayload);
    if (secret.message.notificationId !== payload.notificationId) {
      throw new PermanentOutboxError('notification_email_id_mismatch');
    }

    const deliveryPolicy = this.handlerRegistry.getNotificationEmailDelivery();
    if (
      !(await deliveryPolicy.isNotificationEmailStillDeliverable(
        secret.message,
      ))
    ) {
      return 'cancelled';
    }

    const notification = await this.db
      .selectFrom('notifications')
      .select(['id', 'readAt', 'emailedAt'])
      .where('id', '=', payload.notificationId)
      .executeTakeFirst();
    if (!notification || notification.readAt || notification.emailedAt) {
      return 'cancelled';
    }

    await this.mailService.sendEmail(secret.message);
    return 'completed';
  }

  private async processWorkspaceInvitationEmail(
    entry: QueueOutboxEntry,
  ): Promise<ProcessingOutcome> {
    const payload = this.parseWorkspaceInvitationEmail(entry.payload);
    const secret = this.parseInvitationSecret(entry.secretPayload);
    const computedTokenHash = createHash('sha256')
      .update(secret.inviteToken)
      .digest('hex');
    if (!safeStringEqual(computedTokenHash, payload.tokenHash)) {
      throw new PermanentOutboxError('invitation_secret_hash_mismatch');
    }

    const invitation = await this.db
      .selectFrom('workspaceInvitations')
      .select(['email', 'workspaceId', 'tokenHash', 'expiresAt'])
      .where('id', '=', payload.invitationId)
      .executeTakeFirst();
    if (
      !invitation ||
      invitation.workspaceId !== payload.workspaceId ||
      invitation.email !== payload.inviteeEmail ||
      !invitation.tokenHash ||
      !safeStringEqual(invitation.tokenHash, payload.tokenHash) ||
      (invitation.expiresAt !== null && invitation.expiresAt <= new Date())
    ) {
      return 'cancelled';
    }

    const inviteLink = `${this.domainService.getUrl(payload.hostname)}/invites/${payload.invitationId}?token=${secret.inviteToken}`;
    await this.mailService.sendEmail({
      to: payload.inviteeEmail,
      subject: `${payload.invitedByName} invited you to Docmost`,
      template: InvitationEmail({ inviteLink }),
    });
    return 'completed';
  }

  private async processWorkspaceInvitationAcceptedEmail(
    rawPayload: unknown,
  ): Promise<ProcessingOutcome> {
    const payload = this.parseWorkspaceInvitationAcceptedEmail(rawPayload);
    await this.mailService.sendEmail({
      to: payload.recipientEmail,
      subject: `${payload.invitedUserName} has accepted your Docmost invite`,
      template: InvitationAcceptedEmail({
        invitedUserName: payload.invitedUserName,
        invitedUserEmail: payload.invitedUserEmail,
      }),
    });
    return 'completed';
  }

  private parseWorkspaceInvitationEmail(
    rawPayload: unknown,
  ): WorkspaceInvitationEmailOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_invitation_payload',
    );
    return {
      workspaceId: this.requireUuid(
        payload.workspaceId,
        'invalid_invitation_payload',
      ),
      invitationId: this.requireUuid(
        payload.invitationId,
        'invalid_invitation_payload',
      ),
      inviteeEmail: this.requireString(
        payload.inviteeEmail,
        'invalid_invitation_payload',
      ),
      invitedByName: this.requireString(
        payload.invitedByName,
        'invalid_invitation_payload',
      ),
      hostname: this.optionalString(
        payload.hostname,
        'invalid_invitation_payload',
      ),
      tokenHash: this.requireString(
        payload.tokenHash,
        'invalid_invitation_payload',
      ),
    };
  }

  private parseWorkspaceInvitationAcceptedEmail(
    rawPayload: unknown,
  ): WorkspaceInvitationAcceptedEmailOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_invitation_accepted_payload',
    );
    return {
      invitationId: this.requireUuid(
        payload.invitationId,
        'invalid_invitation_accepted_payload',
      ),
      acceptedUserId: this.requireUuid(
        payload.acceptedUserId,
        'invalid_invitation_accepted_payload',
      ),
      recipientEmail: this.requireString(
        payload.recipientEmail,
        'invalid_invitation_accepted_payload',
      ),
      invitedUserName: this.requireString(
        payload.invitedUserName,
        'invalid_invitation_accepted_payload',
      ),
      invitedUserEmail: this.requireString(
        payload.invitedUserEmail,
        'invalid_invitation_accepted_payload',
      ),
    };
  }

  private parseInvitationSecret(
    secretPayload: string | null,
  ): WorkspaceInvitationEmailSecretPayload {
    if (!isEncryptedProtectedValue(secretPayload)) {
      throw new PermanentOutboxError('missing_encrypted_invitation_secret');
    }

    try {
      const decrypted = decryptProtectedValue(
        secretPayload!,
        this.environmentService.getAppSecret(),
      );
      const secret = this.requireRecord(
        JSON.parse(decrypted),
        'invalid_invitation_secret',
      );
      return {
        inviteToken: this.requireString(
          secret.inviteToken,
          'invalid_invitation_secret',
        ),
      };
    } catch (error) {
      if (error instanceof PermanentOutboxError) {
        throw error;
      }
      throw new PermanentOutboxError('invalid_invitation_secret');
    }
  }

  private parseDuplicatePageAttachments(
    rawPayload: unknown,
  ): DuplicatePageAttachmentsOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_duplicate_attachments_payload',
    );
    if (!Array.isArray(payload.attachmentMappings)) {
      throw new PermanentOutboxError('invalid_duplicate_attachments_payload');
    }

    return {
      workspaceId: this.requireUuid(
        payload.workspaceId,
        'invalid_duplicate_attachments_payload',
      ),
      rootPageId: this.requireUuid(
        payload.rootPageId,
        'invalid_duplicate_attachments_payload',
      ),
      newPageId: this.requireUuid(
        payload.newPageId,
        'invalid_duplicate_attachments_payload',
      ),
      spaceId: this.requireUuid(
        payload.spaceId,
        'invalid_duplicate_attachments_payload',
      ),
      attachmentMappings: payload.attachmentMappings.map((rawMapping) => {
        const mapping = this.requireRecord(
          rawMapping,
          'invalid_duplicate_attachments_payload',
        );
        return {
          oldAttachmentId: this.requireUuid(
            mapping.oldAttachmentId,
            'invalid_duplicate_attachments_payload',
          ),
          newAttachmentId: this.requireUuid(
            mapping.newAttachmentId,
            'invalid_duplicate_attachments_payload',
          ),
          oldPageId: this.requireUuid(
            mapping.oldPageId,
            'invalid_duplicate_attachments_payload',
          ),
          newPageId: this.requireUuid(
            mapping.newPageId,
            'invalid_duplicate_attachments_payload',
          ),
        };
      }),
    };
  }

  private parsePageTemplateSync(
    rawPayload: unknown,
  ): PageTemplateSyncOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_page_template_sync_payload',
    );
    return {
      runId: this.requireUuid(
        payload.runId,
        'invalid_page_template_sync_payload',
      ),
    };
  }

  private parseAttachmentCleanup(
    rawPayload: unknown,
  ): AttachmentCleanupOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_attachment_cleanup_payload',
    );
    return {
      batchId: this.requireUuid(
        payload.batchId,
        'invalid_attachment_cleanup_payload',
      ),
    };
  }

  private parseFileImport(rawPayload: unknown): FileImportOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_file_import_payload',
    );
    return {
      fileTaskId: this.requireUuid(
        payload.fileTaskId,
        'invalid_file_import_payload',
      ),
    };
  }

  private parseNotificationEmail(
    rawPayload: unknown,
  ): NotificationEmailOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_notification_email_payload',
    );
    return {
      notificationId: this.requireUuid(
        payload.notificationId,
        'invalid_notification_email_payload',
      ),
    };
  }

  private parseNotificationEmailSecret(
    secretPayload: string | null,
  ): NotificationEmailSecretPayload {
    if (!isEncryptedProtectedValue(secretPayload)) {
      throw new PermanentOutboxError('missing_notification_email_secret');
    }

    try {
      const decrypted = decryptProtectedValue(
        secretPayload!,
        this.environmentService.getAppSecret(),
      );
      const secret = this.requireRecord(
        JSON.parse(decrypted),
        'invalid_notification_email_secret',
      );
      const message = this.requireRecord(
        secret.message,
        'invalid_notification_email_secret',
      );
      const notificationDeliveryMode = this.requireString(
        message.notificationDeliveryMode,
        'invalid_notification_email_secret',
      );
      if (notificationDeliveryMode !== 'immediate') {
        throw new PermanentOutboxError('invalid_notification_email_secret');
      }
      return {
        message: {
          to: this.requireString(
            message.to,
            'invalid_notification_email_secret',
          ),
          subject: this.requireString(
            message.subject,
            'invalid_notification_email_secret',
          ),
          text: this.optionalString(
            message.text,
            'invalid_notification_email_secret',
          ),
          html: this.optionalString(
            message.html,
            'invalid_notification_email_secret',
          ),
          notificationId: this.requireUuid(
            message.notificationId,
            'invalid_notification_email_secret',
          ),
          notificationUserId: this.requireUuid(
            message.notificationUserId,
            'invalid_notification_email_secret',
          ),
          notificationDeliveryMode,
          notificationFrequency: this.requireString(
            message.notificationFrequency,
            'invalid_notification_email_secret',
          ),
        },
      };
    } catch (error) {
      if (error instanceof PermanentOutboxError) {
        throw error;
      }
      throw new PermanentOutboxError('invalid_notification_email_secret');
    }
  }

  private parseNotificationDispatch(
    rawPayload: unknown,
  ): NotificationDispatchOutboxPayload {
    const payload = this.requireRecord(
      rawPayload,
      'invalid_notification_dispatch_payload',
    );
    const jobName = this.requireString(
      payload.jobName,
      'invalid_notification_dispatch_payload',
    );
    const jobData = this.requireRecord(
      payload.jobData,
      'invalid_notification_dispatch_payload',
    );
    const common = {
      eventId: this.requireUuid(
        jobData.eventId,
        'invalid_notification_dispatch_payload',
      ),
      pageId: this.requireUuid(
        jobData.pageId,
        'invalid_notification_dispatch_payload',
      ),
      spaceId: this.requireUuid(
        jobData.spaceId,
        'invalid_notification_dispatch_payload',
      ),
      workspaceId: this.requireUuid(
        jobData.workspaceId,
        'invalid_notification_dispatch_payload',
      ),
      actorId: this.requireUuid(
        jobData.actorId,
        'invalid_notification_dispatch_payload',
      ),
    };

    if (jobName === QueueJob.PAGE_RECIPIENT_NOTIFICATION) {
      const rawReason = this.requireString(
        jobData.reason,
        'invalid_notification_dispatch_payload',
      );
      if (
        !PAGE_RECIPIENT_NOTIFICATION_REASONS.has(
          rawReason as PageRecipientNotificationReason,
        )
      ) {
        throw new PermanentOutboxError('invalid_notification_dispatch_payload');
      }
      if (
        jobData.candidateUserIds !== undefined &&
        !Array.isArray(jobData.candidateUserIds)
      ) {
        throw new PermanentOutboxError('invalid_notification_dispatch_payload');
      }
      return {
        jobName,
        jobData: {
          ...common,
          reason: rawReason as PageRecipientNotificationReason,
          candidateUserIds: Array.isArray(jobData.candidateUserIds)
            ? jobData.candidateUserIds.map((id) =>
                this.requireUuid(id, 'invalid_notification_dispatch_payload'),
              )
            : undefined,
        },
      };
    }

    const commentCommon = {
      ...common,
      commentId: this.requireUuid(
        jobData.commentId,
        'invalid_notification_dispatch_payload',
      ),
    };

    if (jobName === QueueJob.COMMENT_RESOLVED_NOTIFICATION) {
      return {
        jobName,
        jobData: {
          ...commentCommon,
          commentCreatorId: this.requireUuid(
            jobData.commentCreatorId,
            'invalid_notification_dispatch_payload',
          ),
        },
      };
    }
    if (jobName === QueueJob.COMMENT_NOTIFICATION) {
      if (
        !Array.isArray(jobData.mentionedUserIds) ||
        typeof jobData.notifyWatchers !== 'boolean'
      ) {
        throw new PermanentOutboxError('invalid_notification_dispatch_payload');
      }
      return {
        jobName,
        jobData: {
          ...commentCommon,
          parentCommentId:
            jobData.parentCommentId === undefined ||
            jobData.parentCommentId === null
              ? undefined
              : this.requireUuid(
                  jobData.parentCommentId,
                  'invalid_notification_dispatch_payload',
                ),
          mentionedUserIds: jobData.mentionedUserIds.map((id) =>
            this.requireUuid(id, 'invalid_notification_dispatch_payload'),
          ),
          notifyWatchers: jobData.notifyWatchers,
        },
      };
    }
    throw new PermanentOutboxError('invalid_notification_dispatch_job');
  }

  private requireRecord(
    value: unknown,
    errorCode: string,
  ): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new PermanentOutboxError(errorCode);
    }
    return value as Record<string, unknown>;
  }

  private requireString(value: unknown, errorCode: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new PermanentOutboxError(errorCode);
    }
    return value;
  }

  private optionalString(
    value: unknown,
    errorCode: string,
  ): string | undefined {
    if (value === undefined || value === null) return undefined;
    return this.requireString(value, errorCode);
  }

  private requireUuid(value: unknown, errorCode: string): string {
    const id = this.requireString(value, errorCode);
    if (!isUuid(id)) {
      throw new PermanentOutboxError(errorCode);
    }
    return id;
  }
}
