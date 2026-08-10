import {
  ATTACHMENT_CONTENT_INDEX_VERSION,
  AttachmentContentService,
} from './attachment-content.service';

describe('AttachmentContentService recovery scheduling', () => {
  it('retries DB-derived pending work after Redis becomes available', async () => {
    jest.useFakeTimers();
    try {
      const updateQuery: any = {
        set: jest.fn(() => updateQuery),
        where: jest.fn(() => updateQuery),
        returning: jest.fn(() => updateQuery),
        execute: jest.fn().mockResolvedValue([]),
      };
      const selectQuery: any = {
        select: jest.fn(() => selectQuery),
        distinct: jest.fn(() => selectQuery),
        where: jest.fn(() => selectQuery),
        execute: jest.fn().mockResolvedValue([{ workspaceId: 'workspace-1' }]),
      };
      const db = {
        updateTable: jest.fn(() => updateQuery),
        selectFrom: jest.fn(() => selectQuery),
      } as any;
      const attachmentQueue = {
        add: jest
          .fn()
          .mockRejectedValueOnce(new Error('synthetic Redis outage'))
          .mockResolvedValue(undefined),
      } as any;
      const service = new AttachmentContentService(
        {} as any,
        db,
        attachmentQueue,
        {} as any,
      );

      await service.onApplicationBootstrap();
      expect(attachmentQueue.add).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(attachmentQueue.add).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('discovers workspaces with ready content from an older extraction version', async () => {
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      returning: jest.fn(() => updateQuery),
      execute: jest.fn().mockResolvedValue([]),
    };
    const selectQuery: any = {
      select: jest.fn(() => selectQuery),
      distinct: jest.fn(() => selectQuery),
      where: jest.fn(() => selectQuery),
      execute: jest.fn().mockResolvedValue([{ workspaceId: 'workspace-1' }]),
    };
    const db = {
      updateTable: jest.fn(() => updateQuery),
      selectFrom: jest.fn(() => selectQuery),
    } as any;
    const attachmentQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new AttachmentContentService(
      {} as any,
      db,
      attachmentQueue as any,
      {} as any,
    );

    await service.onApplicationBootstrap();
    await service.onModuleDestroy();

    const versionPredicate = selectQuery.where.mock.calls.find(
      ([predicate]: [unknown]) => typeof predicate === 'function',
    )?.[0] as ((eb: any) => unknown) | undefined;
    const eb: any = (column: string, operator: string, value: unknown) => ({
      column,
      operator,
      value,
    });
    eb.and = (expressions: unknown[]) => expressions;
    eb.or = (expressions: unknown[]) => expressions;
    expect(versionPredicate).toBeDefined();
    const expression = JSON.stringify(versionPredicate?.(eb));
    expect(expression).toContain('ready');
    expect(expression).toContain(String(ATTACHMENT_CONTENT_INDEX_VERSION));
  });
});
