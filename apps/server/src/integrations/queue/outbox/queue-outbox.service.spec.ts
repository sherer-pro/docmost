import { createHash } from 'node:crypto';
import {
  decryptProtectedValue,
  encryptProtectedValue,
} from '../../../common/security/credential-protection.util';
import { QueueOutboxKind } from './queue-outbox.types';
import { QueueOutboxService } from './queue-outbox.service';
import { QueueJob } from '../constants';

const APP_SECRET = 'outbox-test-secret-at-least-32-characters';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const INVITATION_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000003';
const PAGE_ID = '00000000-0000-4000-8000-000000000004';
const NEW_PAGE_ID = '00000000-0000-4000-8000-000000000005';
const SPACE_ID = '00000000-0000-4000-8000-000000000006';
const OLD_ATTACHMENT_ID = '00000000-0000-4000-8000-000000000007';
const NEW_ATTACHMENT_ID = '00000000-0000-4000-8000-000000000008';
const TEMPLATE_SYNC_RUN_ID = '00000000-0000-4000-8000-000000000010';

function createSelectQuery(invitation?: Record<string, unknown>) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.executeTakeFirst = jest.fn().mockResolvedValue(invitation);
  return query;
}

function createHarness(invitation?: Record<string, unknown>) {
  const selectQuery = createSelectQuery(invitation);
  const db = { selectFrom: jest.fn(() => selectQuery) };
  const outboxRepo = {
    enqueue: jest.fn().mockResolvedValue('outbox-id'),
    pinDuplicatePageAttachments: jest.fn().mockResolvedValue(undefined),
    hasDuplicatePageAttachmentPins: jest.fn().mockResolvedValue(false),
    purgeCompletedOrCancelledBefore: jest.fn().mockResolvedValue(0),
    purgeFailedKindsBefore: jest.fn().mockResolvedValue(0),
    claimNext: jest.fn(),
    renewLease: jest.fn().mockResolvedValue(true),
    markCompleted: jest.fn().mockResolvedValue(true),
    markDuplicatePageAttachmentsCompleted: jest.fn().mockResolvedValue(true),
    markNotificationEmailCompleted: jest.fn().mockResolvedValue(true),
    markCancelled: jest.fn().mockResolvedValue(true),
    markFailed: jest.fn().mockResolvedValue(true),
    markForRetry: jest.fn().mockResolvedValue(true),
  };
  const environmentService = {
    getAppSecret: jest.fn(() => APP_SECRET),
  };
  const domainService = {
    getUrl: jest.fn(() => 'https://docs.example.test'),
  };
  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const duplicatePageAttachments = {
    process: jest.fn().mockResolvedValue(undefined),
  };
  const pageTemplateSync = {
    processSyncRunFromOutbox: jest.fn().mockResolvedValue(undefined),
  };
  const notificationEmailDeliveryPolicy = {
    isNotificationEmailStillDeliverable: jest.fn().mockResolvedValue(true),
  };
  const attachmentCleanup = {
    processCleanupBatchFromOutbox: jest.fn().mockResolvedValue(undefined),
  };
  const fileImport = {
    processImportFromOutbox: jest.fn().mockResolvedValue(undefined),
  };
  const handlerRegistry = {
    getPageTemplateSync: jest.fn(() => pageTemplateSync),
    getNotificationEmailDelivery: jest.fn(
      () => notificationEmailDeliveryPolicy,
    ),
    getAttachmentCleanup: jest.fn(() => attachmentCleanup),
    getFileImport: jest.fn(() => fileImport),
  };
  const generalQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new QueueOutboxService(
    db as any,
    outboxRepo as any,
    environmentService as any,
    domainService as any,
    mailService as any,
    duplicatePageAttachments as any,
    generalQueue as any,
    notificationQueue as any,
    handlerRegistry as any,
  );

  return {
    service,
    db,
    outboxRepo,
    mailService,
    duplicatePageAttachments,
    pageTemplateSync,
    notificationEmailDeliveryPolicy,
    attachmentCleanup,
    fileImport,
    generalQueue,
    notificationQueue,
  };
}

function invitationEntry(token: string, tokenHash: string) {
  return {
    id: '00000000-0000-4000-8000-000000000009',
    kind: QueueOutboxKind.WORKSPACE_INVITATION_EMAIL,
    payload: {
      workspaceId: WORKSPACE_ID,
      invitationId: INVITATION_ID,
      inviteeEmail: 'invitee@example.test',
      invitedByName: 'Inviter',
      hostname: 'docs',
      tokenHash,
    },
    secretPayload: encryptProtectedValue(
      JSON.stringify({ inviteToken: token }),
      APP_SECRET,
    ),
    attemptCount: 1,
  } as any;
}

describe('QueueOutboxService', () => {
  it('stages attachment tombstones, row deletion, and outbox intent in one transaction', async () => {
    const { service, outboxRepo } = createHarness();
    const select: any = {};
    select.select = jest.fn(() => select);
    select.where = jest.fn(() => select);
    select.execute = jest.fn(async () => [
      { id: OLD_ATTACHMENT_ID, filePath: 'files/old' },
    ]);
    const batchInsert: any = {};
    for (const method of ['values', 'onConflict', 'returning']) {
      batchInsert[method] = jest.fn((callback?: (value: any) => unknown) => {
        if (method === 'onConflict' && callback) {
          const conflict: any = {};
          conflict.columns = jest.fn(() => conflict);
          conflict.doNothing = jest.fn(() => conflict);
          callback(conflict);
        }
        return batchInsert;
      });
    }
    batchInsert.executeTakeFirst = jest.fn(async () => ({ id: 'batch-1' }));
    const itemInsert: any = {
      values: jest.fn(() => itemInsert),
      execute: jest.fn(async () => undefined),
    };
    const deletion: any = {
      where: jest.fn(() => deletion),
      execute: jest.fn(async () => undefined),
    };
    const trx = {
      selectFrom: jest.fn(() => select),
      insertInto: jest
        .fn()
        .mockReturnValueOnce(batchInsert)
        .mockReturnValueOnce(itemInsert),
      deleteFrom: jest.fn(() => deletion),
    };

    await expect(
      service.enqueuePageAttachmentCleanup(
        [PAGE_ID],
        PAGE_ID,
        WORKSPACE_ID,
        trx as any,
      ),
    ).resolves.toBe(true);

    expect(itemInsert.execute).toHaveBeenCalledTimes(1);
    expect(deletion.execute).toHaveBeenCalledTimes(1);
    expect(outboxRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: QueueOutboxKind.ATTACHMENT_CLEANUP,
        dedupeKey: expect.stringMatching(/^attachment-cleanup:/),
      }),
      trx,
    );
  });

  it('pins duplicate attachment sources in the same transaction as the outbox intent', async () => {
    const { service, outboxRepo } = createHarness();
    const trx = {} as any;

    await service.enqueueDuplicatePageAttachments(
      {
        workspaceId: WORKSPACE_ID,
        rootPageId: PAGE_ID,
        newPageId: NEW_PAGE_ID,
        spaceId: SPACE_ID,
        attachmentMappings: [
          {
            oldAttachmentId: OLD_ATTACHMENT_ID,
            newAttachmentId: NEW_ATTACHMENT_ID,
            oldPageId: PAGE_ID,
            newPageId: NEW_PAGE_ID,
          },
        ],
      },
      trx,
    );

    expect(outboxRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS,
      }),
      trx,
    );
    expect(outboxRepo.pinDuplicatePageAttachments).toHaveBeenCalledWith(
      'outbox-id',
      [OLD_ATTACHMENT_ID],
      trx,
    );
  });

  it.each(['page', 'space'] as const)(
    'blocks %s cleanup while a duplicate attachment source is pinned',
    async (scope) => {
      const { service, outboxRepo } = createHarness();
      outboxRepo.hasDuplicatePageAttachmentPins.mockResolvedValueOnce(true);
      const select: any = {};
      select.select = jest.fn(() => select);
      select.where = jest.fn(() => select);
      select.execute = jest.fn(async () => [
        { id: OLD_ATTACHMENT_ID, filePath: 'files/old' },
      ]);
      const trx = {
        selectFrom: jest.fn(() => select),
        insertInto: jest.fn(),
        deleteFrom: jest.fn(),
      };

      const cleanup =
        scope === 'page'
          ? service.enqueuePageAttachmentCleanup(
              [PAGE_ID],
              PAGE_ID,
              WORKSPACE_ID,
              trx as any,
            )
          : service.enqueueSpaceAttachmentCleanup(
              SPACE_ID,
              WORKSPACE_ID,
              trx as any,
            );
      await expect(cleanup).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'page_attachment_copy_in_progress',
        }),
      });

      expect(trx.insertInto).not.toHaveBeenCalled();
      expect(trx.deleteFrom).not.toHaveBeenCalled();
      expect(outboxRepo.enqueue).not.toHaveBeenCalled();
    },
  );

  it('chunks cleanup tombstones below the PostgreSQL bind-parameter limit', async () => {
    const { service } = createHarness();
    const attachments = Array.from({ length: 16_384 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      filePath: `files/${index}`,
    }));
    const select: any = {};
    select.select = jest.fn(() => select);
    select.where = jest.fn(() => select);
    select.execute = jest.fn(async () => attachments);
    const batchInsert: any = {};
    for (const method of ['values', 'onConflict', 'returning']) {
      batchInsert[method] = jest.fn(() => batchInsert);
    }
    batchInsert.executeTakeFirst = jest.fn(async () => ({ id: 'batch-large' }));
    const itemInsert: any = {};
    itemInsert.values = jest.fn(() => itemInsert);
    itemInsert.execute = jest.fn(async () => undefined);
    const deletion: any = {};
    deletion.where = jest.fn(() => deletion);
    deletion.execute = jest.fn(async () => undefined);
    const trx = {
      selectFrom: jest.fn(() => select),
      insertInto: jest.fn((table: string) =>
        table === 'attachmentCleanupBatches' ? batchInsert : itemInsert,
      ),
      deleteFrom: jest.fn(() => deletion),
    };

    await expect(
      service.enqueuePageAttachmentCleanup(
        [PAGE_ID],
        PAGE_ID,
        WORKSPACE_ID,
        trx as any,
      ),
    ).resolves.toBe(true);

    const chunks = itemInsert.values.mock.calls.map(([values]) => values);
    expect(chunks).toHaveLength(17);
    expect(chunks.every((chunk) => chunk.length <= 1_000)).toBe(true);
    expect(chunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(
      attachments.length,
    );
  });

  it('dispatches durable attachment cleanup through the registered handler', async () => {
    const { service, outboxRepo, attachmentCleanup } = createHarness();
    outboxRepo.claimNext.mockResolvedValueOnce({
      id: INVITATION_ID,
      kind: QueueOutboxKind.ATTACHMENT_CLEANUP,
      payload: { batchId: PAGE_ID },
      secretPayload: null,
      attemptCount: 1,
    });

    await service.processAvailable(1);

    expect(
      attachmentCleanup.processCleanupBatchFromOutbox,
    ).toHaveBeenCalledWith(PAGE_ID);
    expect(outboxRepo.markCompleted).toHaveBeenCalledTimes(1);
  });

  it('registers processing and hourly purge as separate fixed repeat jobs', async () => {
    const { service, generalQueue } = createHarness();

    await service.ensurePeriodicSweep();

    expect(generalQueue.add).toHaveBeenCalledWith(
      QueueJob.PROCESS_QUEUE_OUTBOX,
      {},
      expect.objectContaining({
        jobId: 'queue-outbox-periodic-sweep',
        repeat: { every: 15_000 },
      }),
    );
    expect(generalQueue.add).toHaveBeenCalledWith(
      QueueJob.PURGE_QUEUE_OUTBOX,
      {},
      expect.objectContaining({
        jobId: 'queue-outbox-hourly-purge',
        repeat: { every: 60 * 60 * 1000 },
      }),
    );
  });

  it('purges completed and expirable failed delivery rows in bounded batches', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-22T12:00:00.000Z'));
    try {
      const { service, outboxRepo } = createHarness();
      outboxRepo.purgeCompletedOrCancelledBefore
        .mockResolvedValueOnce(1_000)
        .mockResolvedValueOnce(17);
      outboxRepo.purgeFailedKindsBefore
        .mockResolvedValueOnce(1_000)
        .mockResolvedValueOnce(3);

      await expect(service.purgeExpiredTerminalEntries()).resolves.toBe(2_020);

      expect(outboxRepo.purgeCompletedOrCancelledBefore).toHaveBeenCalledTimes(
        2,
      );
      expect(
        outboxRepo.purgeCompletedOrCancelledBefore,
      ).toHaveBeenNthCalledWith(1, new Date('2026-08-15T12:00:00.000Z'), 1_000);
      expect(outboxRepo.purgeFailedKindsBefore).toHaveBeenCalledTimes(2);
      expect(outboxRepo.purgeFailedKindsBefore).toHaveBeenNthCalledWith(
        1,
        new Date('2026-05-24T12:00:00.000Z'),
        [
          QueueOutboxKind.WORKSPACE_INVITATION_EMAIL,
          QueueOutboxKind.WORKSPACE_INVITATION_ACCEPTED_EMAIL,
          QueueOutboxKind.NOTIFICATION_EMAIL,
          QueueOutboxKind.NOTIFICATION_DISPATCH,
        ],
        1_000,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps each hourly terminal purge class at twenty batches', async () => {
    const { service, outboxRepo } = createHarness();
    outboxRepo.purgeCompletedOrCancelledBefore.mockResolvedValue(1_000);
    outboxRepo.purgeFailedKindsBefore.mockResolvedValue(1_000);

    await expect(service.purgeExpiredTerminalEntries()).resolves.toBe(40_000);

    expect(outboxRepo.purgeCompletedOrCancelledBefore).toHaveBeenCalledTimes(
      20,
    );
    expect(outboxRepo.purgeFailedKindsBefore).toHaveBeenCalledTimes(20);
  });

  it('encrypts invitation tokens outside the public payload', async () => {
    const { service, outboxRepo } = createHarness();
    const inviteToken = 'raw-invitation-token';
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');

    await service.enqueueWorkspaceInvitationEmail(
      {
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
        inviteeEmail: 'invitee@example.test',
        invitedByName: 'Inviter',
        hostname: 'docs',
        tokenHash,
        inviteToken,
      },
      {} as any,
    );

    const inserted = outboxRepo.enqueue.mock.calls[0][0];
    expect(inserted.payload).not.toHaveProperty('inviteToken');
    expect(JSON.stringify(inserted.payload)).not.toContain(inviteToken);
    expect(inserted.secretPayload).not.toContain(inviteToken);
    expect(
      JSON.parse(decryptProtectedValue(inserted.secretPayload, APP_SECRET)),
    ).toEqual({ inviteToken });
  });

  it('sends a current invitation directly and completes the entry', async () => {
    const token = 'current-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { service, outboxRepo, mailService, generalQueue } = createHarness({
      workspaceId: WORKSPACE_ID,
      email: 'invitee@example.test',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const entry = invitationEntry(token, tokenHash);
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(mailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.test',
        subject: 'Inviter invited you to Docmost',
      }),
    );
    expect(outboxRepo.markCompleted).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
    );
    expect(generalQueue.add).not.toHaveBeenCalled();
  });

  it('cancels a superseded invitation token without sending mail', async () => {
    const token = 'old-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { service, outboxRepo, mailService } = createHarness({
      workspaceId: WORKSPACE_ID,
      email: 'invitee@example.test',
      tokenHash: createHash('sha256').update('new-token').digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const entry = invitationEntry(token, tokenHash);
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(outboxRepo.markCancelled).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
    );
  });

  it('cancels an expired invitation without sending mail', async () => {
    const token = 'expired-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { service, outboxRepo, mailService } = createHarness({
      workspaceId: WORKSPACE_ID,
      email: 'invitee@example.test',
      tokenHash,
      expiresAt: new Date(Date.now() - 1),
    });
    const entry = invitationEntry(token, tokenHash);
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(outboxRepo.markCancelled).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
    );
  });

  it('fails a mismatched encrypted invitation secret without sending mail', async () => {
    const token = 'stored-token';
    const tokenHash = createHash('sha256')
      .update('different-token')
      .digest('hex');
    const { service, outboxRepo, mailService } = createHarness();
    const entry = invitationEntry(token, tokenHash);
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(outboxRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
      'invitation_secret_hash_mismatch',
      {
        redacted: true,
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
      },
    );
    expect(
      JSON.stringify(outboxRepo.markFailed.mock.calls[0][3]),
    ).not.toContain('invitee@example.test');
  });

  it('marks an unencrypted invitation secret as a terminal failure', async () => {
    const tokenHash = createHash('sha256').update('token').digest('hex');
    const { service, outboxRepo } = createHarness();
    const entry = invitationEntry('token', tokenHash);
    entry.secretPayload = 'plaintext-token';
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(outboxRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
      'missing_encrypted_invitation_secret',
      {
        redacted: true,
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
      },
    );
  });

  it('retries transient duplicate attachment failures', async () => {
    const { service, outboxRepo, duplicatePageAttachments } = createHarness();
    duplicatePageAttachments.process.mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    const entry = {
      id: '00000000-0000-4000-8000-000000000009',
      kind: QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS,
      payload: {
        workspaceId: WORKSPACE_ID,
        rootPageId: PAGE_ID,
        newPageId: NEW_PAGE_ID,
        spaceId: SPACE_ID,
        attachmentMappings: [
          {
            oldAttachmentId: OLD_ATTACHMENT_ID,
            newAttachmentId: NEW_ATTACHMENT_ID,
            oldPageId: PAGE_ID,
            newPageId: NEW_PAGE_ID,
          },
        ],
      },
      secretPayload: null,
      attemptCount: 1,
    } as any;
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(outboxRepo.markForRetry).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
      expect.any(Date),
      'transient_processing_error',
    );
    expect(
      outboxRepo.markDuplicatePageAttachmentsCompleted,
    ).not.toHaveBeenCalled();
  });

  it('keeps source pins through copy and releases them only on fenced completion', async () => {
    const { service, outboxRepo, duplicatePageAttachments } = createHarness();
    let sourcePinned = true;
    const sequence: string[] = [];
    duplicatePageAttachments.process.mockImplementationOnce(async () => {
      expect(sourcePinned).toBe(true);
      sequence.push('copy-converged');
    });
    outboxRepo.markDuplicatePageAttachmentsCompleted.mockImplementationOnce(
      async () => {
        expect(sequence).toEqual(['copy-converged']);
        sourcePinned = false;
        sequence.push('pin-released');
        return true;
      },
    );
    const entry = {
      id: '00000000-0000-4000-8000-000000000009',
      kind: QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS,
      payload: {
        workspaceId: WORKSPACE_ID,
        rootPageId: PAGE_ID,
        newPageId: NEW_PAGE_ID,
        spaceId: SPACE_ID,
        attachmentMappings: [
          {
            oldAttachmentId: OLD_ATTACHMENT_ID,
            newAttachmentId: NEW_ATTACHMENT_ID,
            oldPageId: PAGE_ID,
            newPageId: NEW_PAGE_ID,
          },
        ],
      },
      secretPayload: null,
      attemptCount: 1,
    } as any;
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(sequence).toEqual(['copy-converged', 'pin-released']);
    expect(sourcePinned).toBe(false);
    expect(
      outboxRepo.markDuplicatePageAttachmentsCompleted,
    ).toHaveBeenCalledWith(entry.id, expect.any(String));
    expect(outboxRepo.markCompleted).not.toHaveBeenCalled();
  });

  it('uses bounded exponential retry delays', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    try {
      const { service, outboxRepo, duplicatePageAttachments } = createHarness();
      duplicatePageAttachments.process.mockRejectedValueOnce(
        new Error('storage unavailable'),
      );
      const entry = {
        id: '00000000-0000-4000-8000-000000000009',
        kind: QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS,
        payload: {
          workspaceId: WORKSPACE_ID,
          rootPageId: PAGE_ID,
          newPageId: NEW_PAGE_ID,
          spaceId: SPACE_ID,
          attachmentMappings: [],
        },
        secretPayload: null,
        attemptCount: 3,
      } as any;
      outboxRepo.claimNext.mockResolvedValueOnce(entry);

      await service.processAvailable(1);

      expect(outboxRepo.markForRetry).toHaveBeenCalledWith(
        entry.id,
        expect.any(String),
        new Date('2026-08-09T12:00:20.000Z'),
        'transient_processing_error',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves a sent side effect reclaimable when finalization loses the database', async () => {
    const token = 'current-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { service, outboxRepo, mailService } = createHarness({
      workspaceId: WORKSPACE_ID,
      email: 'invitee@example.test',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const entry = invitationEntry(token, tokenHash);
    outboxRepo.claimNext.mockResolvedValueOnce(entry);
    outboxRepo.markCompleted.mockRejectedValueOnce(
      new Error('database unavailable after send'),
    );

    await expect(service.processAvailable(1)).rejects.toThrow(
      'database unavailable after send',
    );

    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(outboxRepo.markForRetry).not.toHaveBeenCalled();
    expect(outboxRepo.markFailed).not.toHaveBeenCalled();
  });

  it('fails a transient task after the bounded attempt budget', async () => {
    const { service, outboxRepo, duplicatePageAttachments } = createHarness();
    duplicatePageAttachments.process.mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    const entry = {
      id: '00000000-0000-4000-8000-000000000009',
      kind: QueueOutboxKind.DUPLICATE_PAGE_ATTACHMENTS,
      payload: {
        workspaceId: WORKSPACE_ID,
        rootPageId: PAGE_ID,
        newPageId: NEW_PAGE_ID,
        spaceId: SPACE_ID,
        attachmentMappings: [],
      },
      secretPayload: null,
      attemptCount: 20,
    } as any;
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(outboxRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
      'retry_exhausted',
    );
    expect(outboxRepo.markForRetry).not.toHaveBeenCalled();
    expect(
      outboxRepo.markDuplicatePageAttachmentsCompleted,
    ).not.toHaveBeenCalled();
  });

  it('uses an opaque user id in accepted-email deduplication', async () => {
    const { service, outboxRepo } = createHarness();
    await service.enqueueWorkspaceInvitationAcceptedEmail(
      {
        invitationId: INVITATION_ID,
        acceptedUserId: USER_ID,
        recipientEmail: 'inviter@example.test',
        invitedUserName: 'New user',
        invitedUserEmail: 'new-user@example.test',
      },
      {} as any,
    );

    expect(outboxRepo.enqueue.mock.calls[0][0].dedupeKey).toBe(
      `workspace-invitation-accepted-email:${INVITATION_ID}:${USER_ID}`,
    );
  });

  it('redacts acceptance-email personal data on terminal failure', async () => {
    const { service, outboxRepo, mailService } = createHarness();
    mailService.sendEmail.mockRejectedValueOnce(new Error('mail unavailable'));
    const entry = {
      id: '00000000-0000-4000-8000-000000000009',
      kind: QueueOutboxKind.WORKSPACE_INVITATION_ACCEPTED_EMAIL,
      payload: {
        invitationId: INVITATION_ID,
        acceptedUserId: USER_ID,
        recipientEmail: 'inviter@example.test',
        invitedUserName: 'New user',
        invitedUserEmail: 'new-user@example.test',
      },
      secretPayload: null,
      attemptCount: 20,
    } as any;
    outboxRepo.claimNext.mockResolvedValueOnce(entry);

    await service.processAvailable(1);

    expect(outboxRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      expect.any(String),
      'retry_exhausted',
      {
        redacted: true,
        invitationId: INVITATION_ID,
        acceptedUserId: USER_ID,
      },
    );
    const retainedPayload = JSON.stringify(
      outboxRepo.markFailed.mock.calls[0][3],
    );
    expect(retainedPayload).not.toContain('inviter@example.test');
    expect(retainedPayload).not.toContain('new-user@example.test');
    expect(retainedPayload).not.toContain('New user');
  });

  it('enqueues and dispatches synchronized template runs', async () => {
    const { service, outboxRepo, pageTemplateSync } = createHarness();
    await service.enqueuePageTemplateSync(
      { runId: TEMPLATE_SYNC_RUN_ID },
      'dispatch-1',
      {} as any,
    );

    expect(outboxRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: QueueOutboxKind.PAGE_TEMPLATE_SYNC,
        payload: { runId: TEMPLATE_SYNC_RUN_ID },
        dedupeKey: `page-template-sync:${TEMPLATE_SYNC_RUN_ID}:dispatch-1`,
      }),
      expect.anything(),
    );

    outboxRepo.claimNext.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000009',
      kind: QueueOutboxKind.PAGE_TEMPLATE_SYNC,
      payload: { runId: TEMPLATE_SYNC_RUN_ID },
      secretPayload: null,
      attemptCount: 1,
    });
    await service.processAvailable(1);

    expect(pageTemplateSync.processSyncRunFromOutbox).toHaveBeenCalledWith(
      TEMPLATE_SYNC_RUN_ID,
    );
  });

  it('encrypts immediate notification mail and finalizes it with the current lease', async () => {
    const {
      service,
      outboxRepo,
      mailService,
      notificationEmailDeliveryPolicy,
    } = createHarness({
      id: USER_ID,
      readAt: null,
      emailedAt: null,
    });
    const message = {
      to: 'recipient@example.test',
      subject: 'Private subject',
      html: '<p>Private content</p>',
      text: 'Private content',
      notificationId: USER_ID,
      notificationUserId: WORKSPACE_ID,
      notificationDeliveryMode: 'immediate' as const,
      notificationFrequency: 'immediate',
    };

    await service.enqueueNotificationEmail(USER_ID, message, {} as any);
    const inserted = outboxRepo.enqueue.mock.calls[0][0];
    expect(inserted.payload).toEqual({ notificationId: USER_ID });
    expect(JSON.stringify(inserted.payload)).not.toContain(message.to);
    expect(inserted.secretPayload).not.toContain(message.subject);

    outboxRepo.claimNext.mockResolvedValueOnce({
      id: INVITATION_ID,
      kind: QueueOutboxKind.NOTIFICATION_EMAIL,
      payload: { notificationId: USER_ID },
      secretPayload: inserted.secretPayload,
      attemptCount: 1,
    });
    await service.processAvailable(1);

    expect(
      notificationEmailDeliveryPolicy.isNotificationEmailStillDeliverable,
    ).toHaveBeenCalledWith(message);
    expect(mailService.sendEmail).toHaveBeenCalledWith(message);
    expect(outboxRepo.markNotificationEmailCompleted).toHaveBeenCalledWith(
      INVITATION_ID,
      expect.any(String),
      USER_ID,
    );
    expect(outboxRepo.markCompleted).not.toHaveBeenCalled();
  });

  it('cancels an immediate notification email when delivery policy changes before dispatch', async () => {
    const {
      service,
      outboxRepo,
      mailService,
      notificationEmailDeliveryPolicy,
    } = createHarness({
      id: USER_ID,
      readAt: null,
      emailedAt: null,
    });
    notificationEmailDeliveryPolicy.isNotificationEmailStillDeliverable.mockResolvedValue(
      false,
    );
    const message = {
      to: 'recipient@example.test',
      subject: 'Private subject',
      text: 'Private content',
      notificationId: USER_ID,
      notificationUserId: WORKSPACE_ID,
      notificationDeliveryMode: 'immediate' as const,
      notificationFrequency: 'immediate',
    };

    await service.enqueueNotificationEmail(USER_ID, message, {} as any);
    const inserted = outboxRepo.enqueue.mock.calls[0][0];
    outboxRepo.claimNext.mockResolvedValueOnce({
      id: INVITATION_ID,
      kind: QueueOutboxKind.NOTIFICATION_EMAIL,
      payload: { notificationId: USER_ID },
      secretPayload: inserted.secretPayload,
      attemptCount: 1,
    });

    await service.processAvailable(1);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(outboxRepo.markCancelled).toHaveBeenCalledWith(
      INVITATION_ID,
      expect.any(String),
    );
  });

  it('reconciles a durable notification dispatch with a deterministic Redis job id', async () => {
    const { service, outboxRepo, notificationQueue } = createHarness();
    const jobData = {
      eventId: INVITATION_ID,
      commentId: OLD_ATTACHMENT_ID,
      pageId: PAGE_ID,
      spaceId: SPACE_ID,
      workspaceId: WORKSPACE_ID,
      actorId: USER_ID,
      mentionedUserIds: [],
      notifyWatchers: true,
    };
    await service.enqueueNotificationDispatch(
      { jobName: QueueJob.COMMENT_NOTIFICATION, jobData },
      {} as any,
    );
    const inserted = outboxRepo.enqueue.mock.calls[0][0];
    expect(inserted.dedupeKey).toBe(
      `notification-dispatch:${QueueJob.COMMENT_NOTIFICATION}:${INVITATION_ID}`,
    );

    outboxRepo.claimNext.mockResolvedValueOnce({
      id: NEW_ATTACHMENT_ID,
      kind: QueueOutboxKind.NOTIFICATION_DISPATCH,
      payload: inserted.payload,
      secretPayload: null,
      attemptCount: 1,
    });
    await service.processAvailable(1);

    expect(notificationQueue.add).toHaveBeenCalledWith(
      QueueJob.COMMENT_NOTIFICATION,
      jobData,
      { jobId: `notification-dispatch-${INVITATION_ID}` },
    );
    expect(outboxRepo.markCompleted).toHaveBeenCalledWith(
      NEW_ATTACHMENT_ID,
      expect.any(String),
    );
  });

  it('dispatches a durable page-recipient notification', async () => {
    const { service, outboxRepo, notificationQueue } = createHarness();
    const jobData = {
      eventId: INVITATION_ID,
      reason: 'document-changed' as const,
      pageId: PAGE_ID,
      spaceId: SPACE_ID,
      workspaceId: WORKSPACE_ID,
      actorId: USER_ID,
    };
    await service.enqueueNotificationDispatch(
      { jobName: QueueJob.PAGE_RECIPIENT_NOTIFICATION, jobData },
      {} as any,
    );
    const inserted = outboxRepo.enqueue.mock.calls[0][0];
    outboxRepo.claimNext.mockResolvedValueOnce({
      id: NEW_ATTACHMENT_ID,
      kind: QueueOutboxKind.NOTIFICATION_DISPATCH,
      payload: inserted.payload,
      secretPayload: null,
      attemptCount: 1,
    });

    await service.processAvailable(1);

    expect(notificationQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_RECIPIENT_NOTIFICATION,
      { ...jobData, candidateUserIds: undefined },
      { jobId: `notification-dispatch-${INVITATION_ID}` },
    );
    expect(outboxRepo.markCompleted).toHaveBeenCalledWith(
      NEW_ATTACHMENT_ID,
      expect.any(String),
    );
  });
});
