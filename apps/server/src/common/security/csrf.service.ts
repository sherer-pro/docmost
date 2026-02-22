import { Injectable } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Injectable()
export class CsrfService {
  static readonly HEADER_NAME = 'x-csrf-token';
  static readonly COOKIE_NAME = 'csrfToken';

  constructor(private readonly environmentService: EnvironmentService) {}

  /**
   * Возвращает sameSite для auth/csrf cookie:
   * - `none` только в cloud + https сценарии (кросс-сайтовый SSO);
   * - `lax` во всех остальных случаях как безопасный дефолт.
   */
  getSameSite(): 'lax' | 'none' {
    if (this.environmentService.isCloud() && this.environmentService.isHttps()) {
      return 'none';
    }

    return 'lax';
  }

  /**
   * Генерирует CSRF-токен для double-submit cookie pattern.
   */
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Устанавливает CSRF-cookie, доступную клиентскому JS для отправки в заголовке.
   */
  setCsrfCookie(res: FastifyReply, token: string) {
    res.setCookie(CsrfService.COOKIE_NAME, token, {
      httpOnly: false,
      path: '/',
      sameSite: this.getSameSite(),
      secure: this.environmentService.isHttps(),
      expires: this.environmentService.getCookieExpiresIn(),
    });
  }

  /**
   * Очищает CSRF-cookie при завершении сессии.
   */
  clearCsrfCookie(res: FastifyReply) {
    res.clearCookie(CsrfService.COOKIE_NAME, {
      path: '/',
      sameSite: this.getSameSite(),
      secure: this.environmentService.isHttps(),
    });
  }
}
