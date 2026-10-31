import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthRateLimitService } from '../../auth/rate-limit/auth-rate-limit.service';
import { getClientIpFromFastifyRequest } from '../../../common/security/trusted-proxy.util';
import { McpOAuthError } from './mcp-oauth-validation';

@Injectable()
export class McpOAuthRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: AuthRateLimitService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const reply = context.switchToHttp().getResponse();
    const registration = String(request.raw?.url ?? request.url)
      .split('?')[0]
      .endsWith('/clients');
    const result = await this.limiter.consume({
      endpoint: registration ? 'mcpOAuthRegistration' : 'mcpOAuthExchange',
      scope: 'ip',
      key: `${request.raw?.workspaceId ?? 'none'}:${getClientIpFromFastifyRequest(request) || 'unknown'}`,
      limit: registration ? 10 : 60,
      windowMs: 60_000,
    });
    if (!result.storageAvailable)
      throw new McpOAuthError(
        'temporarily_unavailable',
        'OAuth rate limiter unavailable',
        503,
      );
    if (!result.allowed) {
      reply.header(
        'Retry-After',
        String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
      );
      throw new McpOAuthError(
        'temporarily_unavailable',
        'OAuth request limit exceeded',
        429,
      );
    }
    return true;
  }
}
