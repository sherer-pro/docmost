import { createHash } from 'node:crypto';
import {
  decryptProtectedValue,
  encryptProtectedValue,
} from '../../../common/security/credential-protection.util';
import { QueueOutboxKind } from './queue-outbox.types';
import { QueueOutboxService } from './queue-outbox.service';

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
    purgeCompletedBefore: jest.fn().mockResolvedValue(0),
    claimNext: jest.fn(),
    renewLease: jest.fn().mockResolvedValue(true),
    markCompleted: jest.fn().mockResolvedValue(true),
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
  const moduleRef = { get: jest.fn(() => pageTemplateSync) };
  const generalQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new QueueOutboxService(
    db as any,
    outboxRepo as any,
    environmentService as any,
    domainService as any,
    mailService as any,
    duplicatePageAttachments as any,
    generalQueue as any,
    moduleRef as any,
  );

  return {
    service,
    db,
    outboxRepo,
    mailService,
    duplicatePageAttachments,
    pageTemplateSync,
    generalQueue,
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
});
