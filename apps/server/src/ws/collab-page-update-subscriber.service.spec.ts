import { randomUUID } from 'node:crypto';
import {
  COLLAB_PAGE_UPDATE_PROCESS_ID,
  COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
} from '../common/events/collab-page-update-channel';
import { EventName } from '../common/events/event.contants';
import { CollabPageUpdateSubscriberService } from './collab-page-update-subscriber.service';

describe('CollabPageUpdateSubscriberService', () => {
  const subscriber = {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(1),
    removeListener: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  const redisService = {
    getOrThrow: jest.fn(() => ({
      duplicate: jest.fn(() => subscriber),
    })),
  };
  const eventEmitter = {
    emitAsync: jest.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches validated remote page updates once with duplicate ids removed', async () => {
    const service = new CollabPageUpdateSubscriberService(
      redisService as never,
      eventEmitter as never,
    );
    const pageId = randomUUID();
    const workspaceId = randomUUID();

    service.onModuleInit();
    service['handleMessage'](
      COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
      JSON.stringify({
        version: 1,
        origin: randomUUID(),
        pageIds: [pageId, pageId],
        workspaceId,
      }),
    );
    await Promise.resolve();

    expect(subscriber.subscribe).toHaveBeenCalledWith(
      COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
    );
    expect(subscriber.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EventName.PAGE_UPDATED,
      { pageIds: [pageId], workspaceId },
    );
    await service.onModuleDestroy();
    expect(subscriber.removeListener).toHaveBeenCalledWith(
      'message',
      service['handleMessage'],
    );
    expect(subscriber.removeListener).toHaveBeenCalledWith(
      'error',
      service['handleError'],
    );
    expect(subscriber.quit).toHaveBeenCalled();
  });

  it('ignores self-originated and malformed notifications', async () => {
    const service = new CollabPageUpdateSubscriberService(
      redisService as never,
      eventEmitter as never,
    );
    const valid = {
      version: 1,
      origin: COLLAB_PAGE_UPDATE_PROCESS_ID,
      pageIds: [randomUUID()],
      workspaceId: randomUUID(),
    };

    service['handleMessage'](
      COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
      JSON.stringify(valid),
    );
    service['handleMessage'](
      COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
      JSON.stringify({ ...valid, origin: randomUUID(), pageIds: ['bad-id'] }),
    );
    service['handleMessage'](COLLAB_PAGE_UPDATE_REDIS_CHANNEL, '{invalid');
    await Promise.resolve();

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});
