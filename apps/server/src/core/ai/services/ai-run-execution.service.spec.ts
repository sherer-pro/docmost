import { AiRunExecutionService } from './ai-run-execution.service';

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
    );

    await expect((service as any).claim('run')).resolves.toBe(run);
    await expect((service as any).claim('run')).resolves.toBeUndefined();
    expect(messageUpdates).toEqual(['aiMessages']);
  });
});
