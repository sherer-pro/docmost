import { Injectable, OnModuleInit } from '@nestjs/common';
import { PushAggregationService } from './push-aggregation.service';

@Injectable()
export class PushAggregationBootstrapService implements OnModuleInit {
  constructor(private readonly pushAggregationService: PushAggregationService) {}

  /**
   * Registers a repeatable BullMQ job on module startup.
   */
  async onModuleInit(): Promise<void> {
    await this.pushAggregationService.ensureProcessJobScheduled();
  }
}
