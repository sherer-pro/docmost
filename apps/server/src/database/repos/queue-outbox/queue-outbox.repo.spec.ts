import {
  QUEUE_OUTBOX_STATUS,
  QueueOutboxRepo,
} from './queue-outbox.repo';

describe('QueueOutboxRepo', () => {
  it('deduplicates and chunks source pins inside the caller transaction', async () => {
    const inserts: Array<Array<{ outboxId: string; sourceAttachmentId: string }>> = [];
    const insert: Record<string, jest.Mock> = {};
    insert.values = jest.fn((values) => {
      inserts.push(values);
      return insert;
    });
    insert.execute = jest.fn().mockResolvedValue(undefined);
    const trx = { insertInto: jest.fn(() => insert) };
    const repo = new QueueOutboxRepo({} as any);
    const attachmentIds = Array.from(
      { length: 1_001 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    await repo.pinDuplicatePageAttachments(
      '00000000-0000-4000-8000-000000009999',
      [...attachmentIds, attachmentIds[0]],
      trx as any,
    );

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toHaveLength(1_000);
    expect(inserts[1]).toHaveLength(1);
    expect(inserts.flat().map(({ sourceAttachmentId }) => sourceAttachmentId))
      .toEqual(attachmentIds);
  });

  it('redacts payload, dedupe key, and secret in the fenced failed transition', async () => {
    const query: Record<string, jest.Mock> = {};
    query.set = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.executeTakeFirst = jest
      .fn()
      .mockResolvedValue({ numUpdatedRows: BigInt(1) });
    const db = { updateTable: jest.fn(() => query) };
    const repo = new QueueOutboxRepo(db as any);
    const id = '00000000-0000-4000-8000-000000000001';
    const leaseToken = '00000000-0000-4000-8000-000000000002';
    const redactedPayload = {
      redacted: true,
      invitationId: '00000000-0000-4000-8000-000000000003',
    };

    await expect(
      repo.markFailed(id, leaseToken, 'retry_exhausted', redactedPayload),
    ).resolves.toBe(true);

    expect(query.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: QUEUE_OUTBOX_STATUS.FAILED,
        lastErrorCode: 'retry_exhausted',
        secretPayload: null,
        payload: redactedPayload,
        dedupeKey: `failed:${id}`,
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    );
    expect(query.where).toHaveBeenCalledWith(
      'status',
      '=',
      QUEUE_OUTBOX_STATUS.PROCESSING,
    );
    expect(query.where).toHaveBeenCalledWith('leaseToken', '=', leaseToken);
  });

  it('releases duplicate attachment pins only after fenced completion wins', async () => {
    const sequence: string[] = [];
    const update: Record<string, jest.Mock> = {};
    for (const method of ['set', 'where', 'returning']) {
      update[method] = jest.fn(() => update);
    }
    update.executeTakeFirst = jest.fn(async () => {
      sequence.push('outbox-completed');
      return { id: '00000000-0000-4000-8000-000000000001' };
    });
    const deletion: Record<string, jest.Mock> = {};
    deletion.where = jest.fn(() => deletion);
    deletion.execute = jest.fn(async () => {
      sequence.push('pins-released');
    });
    const trx = {
      updateTable: jest.fn(() => update),
      deleteFrom: jest.fn(() => deletion),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: jest.fn((handler) => handler(trx)),
      })),
    };
    const repo = new QueueOutboxRepo(db as any);

    await expect(
      repo.markDuplicatePageAttachmentsCompleted(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).resolves.toBe(true);

    expect(sequence).toEqual(['outbox-completed', 'pins-released']);
    expect(update.where).toHaveBeenCalledWith(
      'status',
      '=',
      QUEUE_OUTBOX_STATUS.PROCESSING,
    );
    expect(update.where).toHaveBeenCalledWith(
      'leaseToken',
      '=',
      '00000000-0000-4000-8000-000000000002',
    );
  });

  it('keeps duplicate attachment pins when fenced completion loses', async () => {
    const update: Record<string, jest.Mock> = {};
    for (const method of ['set', 'where', 'returning']) {
      update[method] = jest.fn(() => update);
    }
    update.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
    const trx = {
      updateTable: jest.fn(() => update),
      deleteFrom: jest.fn(),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: jest.fn((handler) => handler(trx)),
      })),
    };
    const repo = new QueueOutboxRepo(db as any);

    await expect(
      repo.markDuplicatePageAttachmentsCompleted(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).resolves.toBe(false);

    expect(trx.deleteFrom).not.toHaveBeenCalled();
  });
});
