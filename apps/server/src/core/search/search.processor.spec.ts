import { QueueJob } from '../../integrations/queue/constants';
import { SearchProcessor } from './search.processor';

describe('SearchProcessor', () => {
  it('passes the requested workspace and entity scope to a rebuild', async () => {
    const typesenseIndexService = {
      isEnabled: jest.fn().mockReturnValue(true),
      rebuildAll: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new SearchProcessor(typesenseIndexService as any);

    await processor.process({
      name: QueueJob.TYPESENSE_FLUSH,
      data: {
        workspaceId: 'workspace-1',
        entities: ['attachments'],
      },
    } as any);

    expect(typesenseIndexService.rebuildAll).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      entities: ['attachments'],
    });
  });

  it('does not rebuild while the Typesense driver is disabled', async () => {
    const typesenseIndexService = {
      isEnabled: jest.fn().mockReturnValue(false),
      rebuildAll: jest.fn(),
    };
    const processor = new SearchProcessor(typesenseIndexService as any);

    await processor.process({
      name: QueueJob.TYPESENSE_FLUSH,
      data: {},
    } as any);

    expect(typesenseIndexService.rebuildAll).not.toHaveBeenCalled();
  });
});
