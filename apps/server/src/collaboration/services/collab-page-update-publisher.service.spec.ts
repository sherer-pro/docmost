import { validate as isUuid } from 'uuid';
import { COLLAB_PAGE_UPDATE_REDIS_CHANNEL } from '../../common/events/collab-page-update-channel';
import { CollabPageUpdatePublisherService } from './collab-page-update-publisher.service';

describe('CollabPageUpdatePublisherService', () => {
  it('publishes a versioned, deduplicated notification without page content', async () => {
    const publish = jest.fn().mockResolvedValue(1);
    const service = new CollabPageUpdatePublisherService({
      getOrThrow: () => ({ publish }),
    } as never);

    await service.publish({
      pageIds: [
        '550e8400-e29b-41d4-a716-446655440000',
        '550e8400-e29b-41d4-a716-446655440000',
      ],
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, raw] = publish.mock.calls[0];
    expect(channel).toBe(COLLAB_PAGE_UPDATE_REDIS_CHANNEL);
    const message = JSON.parse(raw);
    expect(message).toEqual({
      version: 1,
      origin: expect.any(String),
      pageIds: ['550e8400-e29b-41d4-a716-446655440000'],
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(isUuid(message.origin)).toBe(true);
    expect(raw).not.toContain('content');
  });
});
