import { AttachmentContentService } from './attachment-content.service';

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
});
