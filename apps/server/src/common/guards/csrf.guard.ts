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

    // CSRF-проверка не нужна для read-only методов.
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

    // Публичные endpoint'ы и явно исключённые маршруты пропускаем.
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
