import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_CSRF_EXEMPT_KEY } from '../decorators/csrf-exempt.decorator';
import { CsrfService } from '../security/csrf.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { normalizeHostHeader } from '../security/host.util';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly environmentService: EnvironmentService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const method = req.method?.toUpperCase?.() ?? 'GET';

    // CSRF validation is not required for read-only methods.
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isCsrfExempt = this.reflector.getAllAndOverride<boolean>(
      IS_CSRF_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Skip public endpoints and routes explicitly marked as CSRF-exempt.
    if (isPublic || isCsrfExempt) {
      return true;
    }

    if (!this.hasTrustedOrigin(req)) {
      throw new ForbiddenException('CSRF origin validation failed');
    }

    const csrfCookie = req.cookies?.[CsrfService.COOKIE_NAME];
    const csrfHeader = req.headers?.[CsrfService.HEADER_NAME];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

    if (
      !csrfCookie ||
      !csrfToken ||
      typeof csrfToken !== 'string' ||
      csrfCookie !== csrfToken
    ) {
      throw new ForbiddenException('CSRF token validation failed');
    }

    return true;
  }

  private hasTrustedOrigin(req: any): boolean {
    const originHeader = this.firstHeaderValue(req.headers?.origin);
    const refererHeader = this.firstHeaderValue(req.headers?.referer);
    const sourceHeader = originHeader || refererHeader;

    if (!sourceHeader) {
      return true;
    }

    let sourceOrigin: string;
    try {
      sourceOrigin = new URL(sourceHeader).origin;
    } catch {
      return false;
    }

    const trustedOrigins = new Set<string>();
    try {
      trustedOrigins.add(this.environmentService.getAppUrl());
    } catch {
      // Ignore malformed APP_URL here; environment validation reports it on boot.
    }

    const requestHost = normalizeHostHeader(req.headers?.host);
    if (requestHost) {
      const protocol = this.environmentService.isHttps() ? 'https' : 'http';
      trustedOrigins.add(`${protocol}://${requestHost}`);
    }

    return trustedOrigins.has(sourceOrigin);
  }

  private firstHeaderValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          return item.trim();
        }
      }
    }

    return null;
  }
}
