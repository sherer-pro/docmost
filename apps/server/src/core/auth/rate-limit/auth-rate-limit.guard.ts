import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import {
  AUTH_RATE_LIMIT_METADATA,
  AuthRateLimitMetadata,
} from './auth-rate-limit.decorator';
import { AUTH_RATE_LIMITS } from './auth-rate-limit.config';
import { AuthRateLimitService } from './auth-rate-limit.service';

/**
 * Guard applies dual rate limiting:
 * 1) by client IP;
 * 2) by account identifier (for example, email/token).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authRateLimitService: AuthRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.get<AuthRateLimitMetadata>(
      AUTH_RATE_LIMIT_METADATA,
      context.getHandler(),
    );

    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const rules = AUTH_RATE_LIMITS[metadata.endpoint];

    const clientIp = this.getClientIp(request);
    const accountIdentifier = this.getAccountIdentifier(request, metadata);

    const ipCheck = await this.authRateLimitService.consume({
      endpoint: metadata.endpoint,
      scope: 'ip',
      key: clientIp,
      limit: rules.ip.limit,
      windowMs: rules.ip.windowMs,
    });

    if (!ipCheck.allowed) {
      throw new HttpException(
        {
          message: 'Too many requests from this IP address',
          retryAfterMs: ipCheck.retryAfterMs,
          limitScope: 'ip',
          endpoint: metadata.endpoint,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const accountCheck = await this.authRateLimitService.consume({
      endpoint: metadata.endpoint,
      scope: 'account',
      key: accountIdentifier,
      limit: rules.account.limit,
      windowMs: rules.account.windowMs,
    });

    if (!accountCheck.allowed) {
      throw new HttpException(
        {
          message: 'Too many requests for this account identifier',
          retryAfterMs: accountCheck.retryAfterMs,
          limitScope: 'account',
          endpoint: metadata.endpoint,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getClientIp(request: FastifyRequest) {
    return request.ip || request.ips?.[0] || 'unknown-ip';
  }

  private getAccountIdentifier(
    request: FastifyRequest,
    metadata: AuthRateLimitMetadata,
  ) {
    const raw = this.readAccountField(request, metadata.accountField);
    if (raw === null) {
      throw new BadRequestException(
        `Missing account identifier field: ${metadata.accountField}`,
      );
    }

    return raw;
  }

  private readAccountField(
    request: FastifyRequest,
    accountField: string,
  ): string | null {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const cookies = (request.cookies ?? {}) as Record<string, unknown>;
    const headers = request.headers;
    const normalizedHeaderName = accountField.toLowerCase();

    const candidates: unknown[] = [
      body[accountField],
      query[accountField],
      cookies[accountField],
      headers[normalizedHeaderName],
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeAccountFieldValue(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private normalizeAccountFieldValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim().length > 0) {
          return item.trim();
        }
      }
    }

    return null;
  }
}
