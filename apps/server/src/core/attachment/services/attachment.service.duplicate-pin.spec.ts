import { AttachmentService } from './attachment.service';

const SCOPE_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const ATTACHMENT_ID = '00000000-0000-4000-8000-000000000003';

function createSelectQuery(
  rows: Array<{ id: string; workspaceId: string }>,
  events: string[],
) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.forUpdate = jest.fn(() => {
    events.push('lock');
    return query;
  });
  query.execute = jest.fn().mockResolvedValue(rows);
  return query;
}

function createHarness(options?: {
  rows?: Array<{ id: string; workspaceId: string }>;
  commitFailure?: Error;
  stageFailure?: Error;
  stageResult?: boolean;
}) {
  const events: string[] = [];
  const rows =
    options?.rows ??
    [{ id: ATTACHMENT_ID, workspaceId: WORKSPACE_ID }];
  const selectQuery = createSelectQuery(rows, events);
  const trx = { selectFrom: jest.fn(() => selectQuery) };
  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn(async (handler: (trx: unknown) => Promise<unknown>) => {
        const result = await handler(trx);
        if (options?.commitFailure) throw options.commitFailure;
        events.push('commit');
        return result;
      }),
    })),
  };
  const stage = jest.fn(async () => {
    events.push('stage');
    if (options?.stageFailure) throw options.stageFailure;
    return options?.stageResult ?? true;
  });
  const queueOutbox = {
    enqueuePageAttachmentCleanup: stage,
    enqueueSpaceAttachmentCleanup: stage,
    enqueueUserAvatarCleanup: stage,
    kick: jest.fn(() => events.push('kick')),
  };
  const storage = { delete: jest.fn() };
  const service = new AttachmentService(
    storage as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    queueOutbox as any,
  );
  return {
    service,
    storage,
    queueOutbox,
    selectQuery,
    trx,
    events,
  };
}

describe('AttachmentService durable legacy cleanup', () => {
  it.each([
    [
      'page',
      'handleDeletePageAttachments',
      'enqueuePageAttachmentCleanup',
    ],
    [
      'space',
      'handleDeleteSpaceAttachments',
      'enqueueSpaceAttachmentCleanup',
    ],
    [
      'user avatar',
      'handleDeleteUserAvatars',
      'enqueueUserAvatarCleanup',
    ],
  ] as const)(
    'stages the legacy %s job before commit and only then kicks the outbox',
    async (_scope, handler, enqueue) => {
      const { service, storage, queueOutbox, selectQuery, trx, events } =
        createHarness();

      await service[handler](SCOPE_ID);

      expect(selectQuery.forUpdate).toHaveBeenCalledTimes(1);
      if (enqueue === 'enqueuePageAttachmentCleanup') {
        expect(queueOutbox[enqueue]).toHaveBeenCalledWith(
          [SCOPE_ID],
          SCOPE_ID,
          WORKSPACE_ID,
          trx,
        );
      } else {
        expect(queueOutbox[enqueue]).toHaveBeenCalledWith(
          SCOPE_ID,
          WORKSPACE_ID,
          trx,
        );
      }
      expect(events).toEqual(['lock', 'stage', 'commit', 'kick']);
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it('does not touch storage or dispatch before a failed DB commit', async () => {
    const { service, storage, queueOutbox, events } = createHarness({
      commitFailure: new Error('commit failed'),
    });

    await expect(
      service.handleDeletePageAttachments(SCOPE_ID),
    ).rejects.toThrow('commit failed');

    expect(events).toEqual(['lock', 'stage']);
    expect(queueOutbox.kick).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('serializes with a duplicate pin and propagates the conflict', async () => {
    const { service, storage, queueOutbox, selectQuery, events } = createHarness({
      stageFailure: new Error('page_attachment_copy_in_progress'),
    });

    await expect(
      service.handleDeletePageAttachments(SCOPE_ID),
    ).rejects.toThrow('page_attachment_copy_in_progress');

    expect(selectQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['lock', 'stage']);
    expect(queueOutbox.kick).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('treats an already-missing legacy scope as an idempotent success', async () => {
    const { service, storage, queueOutbox, events } = createHarness({ rows: [] });

    await expect(
      service.handleDeletePageAttachments(SCOPE_ID),
    ).resolves.toBeUndefined();

    expect(events).toEqual(['lock', 'commit']);
    expect(queueOutbox.enqueuePageAttachmentCleanup).not.toHaveBeenCalled();
    expect(queueOutbox.kick).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('fails closed when a corrupt legacy scope spans workspaces', async () => {
    const { service, storage, queueOutbox } = createHarness({
      rows: [
        { id: ATTACHMENT_ID, workspaceId: WORKSPACE_ID },
        {
          id: '00000000-0000-4000-8000-000000000004',
          workspaceId: '00000000-0000-4000-8000-000000000005',
        },
      ],
    });

    await expect(
      service.handleDeletePageAttachments(SCOPE_ID),
    ).rejects.toThrow('legacy_attachment_cleanup_workspace_mismatch');

    expect(queueOutbox.enqueuePageAttachmentCleanup).not.toHaveBeenCalled();
    expect(queueOutbox.kick).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('fails closed instead of completing a partially staged cleanup', async () => {
    const { service, storage, queueOutbox, events } = createHarness({
      stageResult: false,
    });

    await expect(
      service.handleDeletePageAttachments(SCOPE_ID),
    ).rejects.toThrow('legacy_attachment_cleanup_not_staged');

    expect(events).toEqual(['lock', 'stage']);
    expect(queueOutbox.kick).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
