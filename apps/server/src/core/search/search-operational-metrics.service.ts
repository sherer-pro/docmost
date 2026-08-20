import { Injectable, Logger } from '@nestjs/common';

export type SearchEntity = 'pages' | 'attachments' | 'dictionary';

@Injectable()
export class SearchOperationalMetricsService {
  private readonly logger = new Logger(SearchOperationalMetricsService.name);
  private readonly fallbackCounts = new Map<string, number>();

  recordFallback(entity: SearchEntity, error: unknown): void {
    const reason = this.reason(error);
    const key = `${entity}:${reason}`;
    const count = (this.fallbackCounts.get(key) ?? 0) + 1;
    this.fallbackCounts.set(key, count);
    this.logger.warn({
      event: 'typesense_search_fallback',
      entity,
      reason,
      count,
    });
  }

  recordDuration(
    entity: SearchEntity,
    driver: 'typesense' | 'database' | 'database-fallback',
    startedAt: number,
  ): void {
    this.logger.debug({
      event: 'search_completed',
      entity,
      driver,
      durationMs: Date.now() - startedAt,
    });
  }

  private reason(error: unknown): string {
    const cause = (error as { cause?: unknown })?.cause ?? error;
    const candidate = cause as {
      httpStatus?: number;
      status?: number;
      code?: string;
    };
    const status = candidate?.httpStatus ?? candidate?.status;
    if (status === 429) return 'rate_limit';
    if (status === 408) return 'timeout';
    if (status && status >= 500) return 'server_error';
    if (candidate?.code) return candidate.code.toLowerCase().slice(0, 40);
    return 'unavailable';
  }
}
