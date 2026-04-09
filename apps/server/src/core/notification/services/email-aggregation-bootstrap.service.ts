import { Injectable, OnModuleInit } from '@nestjs/common';
import { EmailAggregationService } from './email-aggregation.service';

@Injectable()
export class EmailAggregationBootstrapService implements OnModuleInit {
  constructor(private readonly emailAggregationService: EmailAggregationService) {}

  /**
   * Registers periodic digest processing on startup.
   */
  async onModuleInit(): Promise<void> {
    await this.emailAggregationService.ensureProcessJobScheduled();
  }
}
