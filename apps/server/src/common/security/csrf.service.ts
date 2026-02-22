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
   * Resolves the SameSite value for auth/CSRF cookies.
   *
   * Uses `none` only for cloud + HTTPS scenarios (cross-site SSO).
   * Uses `lax` in all other cases as a safe default.
   */
  getSameSite(): 'lax' | 'none' {
    if (this.environmentService.isCloud() && this.environmentService.isHttps()) {
      return 'none';
    }

    return 'lax';
  }

  /**
   * Generates a CSRF token for the double-submit cookie pattern.
   */
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Sets the CSRF cookie that client-side JS reads and mirrors in the header.
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
   * Clears the CSRF cookie when the user session is terminated.
   */
  clearCsrfCookie(res: FastifyReply) {
    res.clearCookie(CsrfService.COOKIE_NAME, {
      path: '/',
      sameSite: this.getSameSite(),
      secure: this.environmentService.isHttps(),
    });
  }
}
