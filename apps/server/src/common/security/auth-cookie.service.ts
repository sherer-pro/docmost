import { Injectable } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CsrfService } from './csrf.service';

@Injectable()
export class AuthCookieService {
  static readonly AUTH_COOKIE_NAME = 'authToken';

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly csrfService: CsrfService,
  ) {}

  /**
   * Returns the shared auth cookie options contract.
   *
   * The same options object is reused across all auth token write paths,
   * so controllers cannot diverge in cookie behavior.
   */
  getAuthCookieOptions() {
    return {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
      sameSite: this.csrfService.getSameSite(),
    } as const;
  }

  /**
   * Sets auth + csrf cookies using one unified flow.
   *
   * CSRF token generation is colocated with auth cookie write,
   * which keeps both cookies in sync for all login-like scenarios.
   */
  setAuthCookies(res: FastifyReply, token: string) {
    res.setCookie(
      AuthCookieService.AUTH_COOKIE_NAME,
      token,
      this.getAuthCookieOptions(),
    );

    this.csrfService.setCsrfCookie(res, this.csrfService.generateToken());
  }

  /**
   * Clears auth + csrf cookies symmetrically.
   *
   * `clearCookie` receives the same key attributes used during set
   * (`path`/`sameSite`/`secure`) to ensure reliable deletion semantics.
   */
  clearAuthCookies(res: FastifyReply) {
    const { path, sameSite, secure } = this.getAuthCookieOptions();

    res.clearCookie(AuthCookieService.AUTH_COOKIE_NAME, {
      path,
      sameSite,
      secure,
    });

    this.csrfService.clearCsrfCookie(res);
  }
}
