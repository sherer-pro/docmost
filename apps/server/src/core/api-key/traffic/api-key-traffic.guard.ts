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
    let renewing = false;
    const startedAt = Date.now();
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
    const failClosed = () => {
      if (released) return;
      this.traffic.observeLeaseLoss(profile);
      release('error');

      const payload = {
        statusCode: 503,
        code: 'api_key_limit_lease_lost',
        message: 'API key traffic lease was lost',
      };
      const raw = response.raw;
      if (!raw?.headersSent && !response.sent) {
        try {
          if (
            typeof response.code === 'function' &&
            typeof response.send === 'function'
          ) {
            response.code(503);
            response.send(payload);
            return;
          }
          raw.statusCode = 503;
          raw.setHeader?.('content-type', 'application/json; charset=utf-8');
          raw.end?.(JSON.stringify(payload));
          return;
        } catch {
          // Fall through to a hard close if the framework already committed.
        }
      }
      if (!raw?.destroyed) raw?.destroy?.();
    };
    const renew = async () => {
      if (released || renewing) return;
      renewing = true;
      try {
        if (!(await this.traffic.renew(lease))) {
          failClosed();
        }
      } catch {
        failClosed();
      } finally {
        renewing = false;
      }
    };
    const renewTimer = lease.renewAfterMs
      ? setInterval(() => void renew(), lease.renewAfterMs)
      : undefined;
    renewTimer?.unref();
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
