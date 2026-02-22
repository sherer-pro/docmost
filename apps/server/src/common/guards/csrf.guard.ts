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

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

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
}
