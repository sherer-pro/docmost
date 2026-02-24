import { Injectable, OnModuleInit } from '@nestjs/common';
import { PushAggregationService } from './push-aggregation.service';

@Injectable()
export class PushAggregationBootstrapService implements OnModuleInit {
  constructor(private readonly pushAggregationService: PushAggregationService) {}

  /**
   * Регистрирует повторяемую BullMQ задачу при старте модуля.
   */
  async onModuleInit(): Promise<void> {
    await this.pushAggregationService.ensureProcessJobScheduled();
  }
}
