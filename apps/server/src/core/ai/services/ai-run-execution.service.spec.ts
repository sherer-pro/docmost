jest.mock('../tools/ai-tool-registry.service', () => ({
  AI_AGENT_MAX_MODEL_STEPS: 8,
  AI_AGENT_MAX_TOOL_CALLS: 16,
  AI_AGENT_MAX_RUN_MODEL_STEPS: 32,
  AI_AGENT_MAX_RUN_TOOL_CALLS: 64,
  AI_TOOL_RESULTS_TOTAL_MAX_BYTES: 128 * 1024,
  AI_WRITE_PROPOSAL_TTL_MS: 60 * 60 * 1000,
  AiToolRegistryService: class AiToolRegistryService {},
}));

import {
  AiRunExecutionService,
  getEmptyResponseFallbackLimits,
} from './ai-run-execution.service';

describe('getEmptyResponseFallbackLimits', () => {
  it('uses a conservative one-time retry budget for empty provider responses', () => {
    expect(
      getEmptyResponseFallbackLimits({
        contextWindow: 131_072,
        maxOutputTokens: 16_384,
      }),
    ).toEqual({ contextWindow: 32_768, maxOutputTokens: 4_096 });

    expect(
      getEmptyResponseFallbackLimits({
        contextWindow: 8_192,
        maxOutputTokens: 2_048,
      }),
    ).toEqual({ contextWindow: 8_192, maxOutputTokens: 2_048 });
  });
});

describe('AiRunExecutionService claim', () => {
  it('allows only one worker to claim the same queued run', async () => {
    const run = {
      id: 'run',
      assistantMessageId: 'assistant',
      status: 'running',
      sequence: 1,
    };
    let claimed = false;
    const messageUpdates: string[] = [];
    const trx = {
      updateTable: jest.fn((table: string) => {
        const query: any = {
          set: jest.fn(() => query),
          where: jest.fn(() => query),
          returningAll: jest.fn(() => query),
          executeTakeFirst: jest.fn(async () => {
            if (table !== 'aiRuns' || claimed) return undefined;
            claimed = true;
            return run;
          }),
          execute: jest.fn(async () => {
            messageUpdates.push(table);
          }),
        };
        return query;
      }),
    };
    const service = new AiRunExecutionService(
      {
        transaction: () => ({
          execute: (callback: (value: typeof trx) => unknown) => callback(trx),
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect((service as any).claim('run')).resolves.toBe(run);
    await expect((service as any).claim('run')).resolves.toBeUndefined();
    expect(messageUpdates).toEqual(['aiMessages']);
  });

  it('persists partial reasoning when a running attempt is cancelled', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const run = {
      id: 'run',
      assistantMessageId: 'assistant',
      userId: 'user',
      status: 'running',
      sequence: 1,
    };
    let runPatch: Record<string, unknown> = {};
    let messagePatch: Record<string, unknown> = {};
    const trx = {
      updateTable: jest.fn((table: string) => {
        const query: any = {
          set: jest.fn((patch) => {
            if (table === 'aiRuns') runPatch = patch;
            if (table === 'aiMessages') messagePatch = patch;
            return query;
          }),
          where: jest.fn(() => query),
          returningAll: jest.fn(() => query),
          executeTakeFirst: jest.fn(async () =>
            table === 'aiRuns'
              ? {
                  ...run,
                  ...runPatch,
                  sequence: 2,
                  completedAt: now,
                }
              : undefined,
          ),
          execute: jest.fn(async () => undefined),
        };
        return query;
      }),
    };
    const events = { emitStatus: jest.fn() };
    const service = new AiRunExecutionService(
      {
        transaction: () => ({
          execute: (callback: (value: typeof trx) => unknown) => callback(trx),
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      events as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).cancel(run, 'partial answer', 'partial reasoning');

    expect(runPatch).toMatchObject({
      responseSnapshot: 'partial answer',
      reasoningSnapshot: 'partial reasoning',
    });
    expect(messagePatch).toMatchObject({
      content: 'partial answer',
      reasoning: 'partial reasoning',
      status: 'cancelled',
    });
    expect(events.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      2,
      'cancelled',
      { finishReason: 'cancelled' },
    );
  });

  it('persists partial reasoning when a running attempt fails', async () => {
    const run = {
      id: 'run',
      assistantMessageId: 'assistant',
      userId: 'user',
      status: 'running',
      sequence: 1,
    };
    let runPatch: Record<string, unknown> = {};
    let messagePatch: Record<string, unknown> = {};
    const trx = {
      updateTable: jest.fn((table: string) => {
        const query: any = {
          set: jest.fn((patch) => {
            if (table === 'aiRuns') runPatch = patch;
            if (table === 'aiMessages') messagePatch = patch;
            return query;
          }),
          where: jest.fn(() => query),
          returningAll: jest.fn(() => query),
          executeTakeFirst: jest.fn(async () =>
            table === 'aiRuns'
              ? {
                  ...run,
                  ...runPatch,
                  status: 'failed',
                  sequence: 2,
                }
              : undefined,
          ),
          execute: jest.fn(async () => undefined),
        };
        return query;
      }),
    };
    const events = { emitStatus: jest.fn() };
    const service = new AiRunExecutionService(
      {
        transaction: () => ({
          execute: (callback: (value: typeof trx) => unknown) => callback(trx),
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      events as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).fail(
      run,
      'partial answer',
      'partial reasoning',
      'provider_error',
      'AI generation failed',
    );

    expect(runPatch).toMatchObject({
      responseSnapshot: 'partial answer',
      reasoningSnapshot: 'partial reasoning',
      status: 'failed',
    });
    expect(messagePatch).toMatchObject({
      content: 'partial answer',
      reasoning: 'partial reasoning',
      status: 'failed',
    });
    expect(events.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
      2,
      'failed',
      {
        errorCode: 'provider_error',
        errorMessage: 'AI generation failed',
      },
    );
  });
});
