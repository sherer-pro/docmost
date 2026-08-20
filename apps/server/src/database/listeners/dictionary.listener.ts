import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { EventName } from '../../common/events/event.contants';
import { QueueJob, QueueName } from '../../integrations/queue/constants';

interface DictionaryChangedEvent {
  spaceId: string;
  termIds?: string[];
}

@Injectable()
export class DictionaryListener {
  constructor(
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly searchQueue: Queue,
  ) {}

  @OnEvent(EventName.DICTIONARY_CHANGED)
  async handleDictionaryChanged(event: DictionaryChangedEvent): Promise<void> {
    const termIds = [...new Set(event.termIds?.filter(Boolean) ?? [])];
    if (termIds.length > 0) {
      await this.searchQueue.add(QueueJob.DICTIONARY_TERMS_UPDATED, {
        termIds,
      });
      return;
    }
    await this.searchQueue.add(QueueJob.DICTIONARY_SPACE_UPDATED, {
      spaceId: event.spaceId,
    });
  }
}
