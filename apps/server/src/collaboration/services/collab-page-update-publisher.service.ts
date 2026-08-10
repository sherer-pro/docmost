import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import {
  COLLAB_PAGE_UPDATE_PROCESS_ID,
  COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
  CollabPageUpdateMessage,
} from '../../common/events/collab-page-update-channel';

@Injectable()
export class CollabPageUpdatePublisherService {
  constructor(private readonly redisService: RedisService) {}

  async publish(event: {
    pageIds: string[];
    workspaceId: string;
  }): Promise<void> {
    const message: CollabPageUpdateMessage = {
      version: 1,
      origin: COLLAB_PAGE_UPDATE_PROCESS_ID,
      pageIds: Array.from(new Set(event.pageIds)),
      workspaceId: event.workspaceId,
    };
    await this.redisService
      .getOrThrow()
      .publish(COLLAB_PAGE_UPDATE_REDIS_CHANNEL, JSON.stringify(message));
  }
}
