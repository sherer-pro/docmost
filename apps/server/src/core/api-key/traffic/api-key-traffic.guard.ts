import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  API_KEY_TRAFFIC_PROFILE,
  type ApiKeyTrafficProfile,
} from './api-key-traffic.decorator';
import { ApiKeyTrafficService } from './api-key-traffic.service';

@Injectable()
export class ApiKeyTrafficGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly traffic: ApiKeyTrafficService,
    private readonly environment: EnvironmentService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const profile = this.reflector.getAllAndOverride<ApiKeyTrafficProfile>(
      API_KEY_TRAFFIC_PROFILE,
      [context.getHandler(), context.getClass()],
    );
    if (!profile) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<any>();
    const response = http.getResponse<any>();
    const apiKeyId = request?.user?.apiKey?.id;
    if (!apiKeyId) return true;
    const path = String(request.raw?.url ?? request.url ?? '').split('?')[0];
    const bulk = profile === 'rag' && this.isBulkRagPath(path);
    const lease = await this.traffic.acquire({
      profile,
      apiKeyId,
      bulk,
      limits:
        profile === 'rag'
          ? this.environment.getRagApiTrafficLimits()
          : this.environment.getMcpTrafficLimits(),
    });
    if (!lease.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(lease.retryAfterMs / 1000),
      );
      response.header?.('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: 429,
          code:
            lease.reason === 'rate'
              ? 'api_key_rate_limited'
              : 'api_key_concurrency_limited',
          message: 'API key request limit exceeded',
        },
        429,
      );
    }

    let released = false;
    const startedAt = Date.now();
    const renewTimer = lease.renewAfterMs
      ? setInterval(
          () => void this.traffic.renew(lease),
          lease.renewAfterMs,
        )
      : undefined;
    renewTimer?.unref();
    const release = (outcome: 'completed' | 'aborted' | 'error') => {
      if (released) return;
      released = true;
      if (renewTimer) clearInterval(renewTimer);
      const rawLength = Number(response.raw?.getHeader?.('content-length'));
      this.traffic.observeRequest(
        profile,
        outcome,
        Date.now() - startedAt,
        Number.isFinite(rawLength) ? rawLength : 0,
      );
      void this.traffic.release(lease);
    };
    response.raw?.once('finish', () =>
      release(response.raw?.statusCode >= 500 ? 'error' : 'completed'),
    );
    response.raw?.once('close', () => release('aborted'));
    request.raw?.once('aborted', () => release('aborted'));
    return true;
  }

  private isBulkRagPath(path: string): boolean {
    return (
      /\/rag\/(?:space\/export|pages\/[^/]+\/export|attachments\/[^/]+\/[^/]+)$/.test(
        path,
      ) || /\/rag\/databases\/[^/]+(?:\/rows)?$/.test(path)
    );
  }
}
