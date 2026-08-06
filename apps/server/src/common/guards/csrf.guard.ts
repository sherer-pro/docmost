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
import {
  getWorkspaceHostnameFromCloudHost,
  normalizeHostHeader,
} from '../security/host.util';
import { safeStringEqual } from '../security/credential-protection.util';

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
      typeof csrfCookie !== 'string' ||
      typeof csrfToken !== 'string' ||
      !safeStringEqual(csrfCookie, csrfToken)
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
      return false;
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL(sourceHeader);
    } catch {
      return false;
    }

    try {
      if (
        sourceUrl.origin === new URL(this.environmentService.getAppUrl()).origin
      ) {
        return true;
      }
    } catch {
      // Ignore malformed APP_URL here; environment validation reports it on boot.
    }

    if (!this.environmentService.isCloud()) {
      return false;
    }

    const requestHost = normalizeHostHeader(req.headers?.host);
    const sourceHost = normalizeHostHeader(sourceUrl.host);
    const subdomainHost = this.environmentService.getSubdomainHost();
    const requestWorkspace = getWorkspaceHostnameFromCloudHost(
      req.headers?.host,
      subdomainHost,
    );
    const sourceWorkspace = getWorkspaceHostnameFromCloudHost(
      sourceUrl.host,
      subdomainHost,
    );
    const expectedProtocol = this.environmentService.isHttps()
      ? 'https:'
      : 'http:';

    if (!requestHost || !sourceHost || !requestWorkspace || !sourceWorkspace) {
      return false;
    }

    return (
      sourceUrl.protocol === expectedProtocol &&
      sourceHost === requestHost &&
      sourceWorkspace === requestWorkspace
    );
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
