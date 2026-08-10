jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { AiAuxRunService } from './ai-aux-run.service';
import { AI_CONCURRENCY_LIMITS } from '../ai.constants';

describe('AiAuxRunService', () => {
  function createAdmissionService(results: Array<Record<string, number>>) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirstOrThrow: jest.fn(async () => results.shift()),
    };
    const db = { selectFrom: jest.fn(() => query) };
    return {
      db,
      service: new AiAuxRunService(
        db as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      ),
    };
  }

  it('uses a BullMQ-safe deterministic job id and a runId-only payload', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const updateQuery: any = {};
    updateQuery.set = jest.fn(() => updateQuery);
    updateQuery.where = jest.fn(() => updateQuery);
    updateQuery.execute = jest.fn().mockResolvedValue(undefined);
    const service = new AiAuxRunService(
      { updateTable: jest.fn(() => updateQuery) } as any,
      {
        getJob: jest.fn().mockResolvedValue(undefined),
        add,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.enqueue({ id: 'run-id', status: 'queued' } as any),
    ).resolves.toBe(true);

    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      { runId: 'run-id' },
      expect.objectContaining({
        jobId: 'ai-aux-run-id',
        attempts: 1,
      }),
    );
    expect(add.mock.calls[0][1]).toEqual({ runId: 'run-id' });
  });

  it('does not add a duplicate while the deterministic job is active', async () => {
    const add = jest.fn();
    const service = new AiAuxRunService(
      {} as any,
      {
        getJob: jest.fn().mockResolvedValue({
          getState: jest.fn().mockResolvedValue('waiting'),
        }),
        add,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.enqueue({ id: 'run-id', status: 'queued' } as any),
    ).resolves.toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  it('admits a run at the configured per-user concurrency limit', async () => {
    const activeBeforeInsert = AI_CONCURRENCY_LIMITS.perUser - 1;
    const { db, service } = createAdmissionService([
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: activeBeforeInsert },
      { count: 0 },
      { count: activeBeforeInsert },
      { count: 0 },
    ]);

    await expect(
      (service as any).assertAdmission(
        db,
        'user-id',
        'workspace-id',
        'space-id',
        100,
        10000,
        100,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a run above the configured per-user concurrency limit', async () => {
    const activeBeforeInsert = AI_CONCURRENCY_LIMITS.perUser;
    const { db, service } = createAdmissionService([
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: activeBeforeInsert },
      { count: 0 },
      { count: activeBeforeInsert },
      { count: 0 },
    ]);

    await expect(
      (service as any).assertAdmission(
        db,
        'user-id',
        'workspace-id',
        'space-id',
        100,
        10000,
        100,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'ai_conversation_busy',
      },
    });
  });

  it('does not return a completed editor result after page access is revoked', async () => {
    const run = {
      id: 'run-id',
      kind: 'editor_transform',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      spaceId: 'space-id',
      pageId: 'page-id',
      clientRequestId: 'request-id',
      commandId: 'replace',
      selectionText: 'selected text',
      selectionFrom: 1,
      selectionTo: 14,
      snapshotHash: 'snapshot-hash',
      status: 'completed',
      sequence: 3,
      responseSnapshot: 'derived secret',
      inputTokens: 1,
      outputTokens: 2,
      cancelRequestedAt: null,
      completedAt: new Date('2026-08-10T10:01:00.000Z'),
      errorCode: null,
      createdAt: new Date('2026-08-10T10:00:00.000Z'),
      updatedAt: new Date('2026-08-10T10:01:00.000Z'),
    };
    const query: any = {
      selectAll: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn(async () => run),
    };
    const service = new AiAuxRunService(
      { selectFrom: jest.fn(() => query) } as any,
      {} as any,
      {} as any,
      {
        assertWritablePage: jest.fn(async () => {
          throw new Error('revoked');
        }),
      } as any,
      {} as any,
      { isPageExcluded: jest.fn(async () => false) } as any,
    );

    await expect(
      service.getEditorAction(
        run.id,
        { id: run.userId } as any,
        { id: run.workspaceId } as any,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'source_access_changed' },
    });
  });
});
