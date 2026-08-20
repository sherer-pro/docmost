import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { EventName } from '../../common/events/event.contants';
import { QueueJob, QueueName } from '../../integrations/queue/constants';

interface UserDisplayNameChangedEvent {
  userId: string;
  workspaceId: string;
}

@Injectable()
export class DatabaseSearchListener {
  constructor(
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly searchQueue: Queue,
  ) {}

  @OnEvent(EventName.USER_DISPLAY_NAME_CHANGED)
  async handleUserDisplayNameChanged(
    event: UserDisplayNameChangedEvent,
  ): Promise<void> {
    await this.searchQueue.add(QueueJob.DATABASE_SEARCH_REBUILD_USER, event);
  }
}
