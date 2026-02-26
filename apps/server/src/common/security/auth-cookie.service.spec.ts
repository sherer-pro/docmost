import { AuthCookieService } from './auth-cookie.service';
import { CsrfService } from './csrf.service';

describe('AuthCookieService', () => {
  const cookieExpiresIn = new Date('2030-01-01T00:00:00.000Z');

  const createService = (options?: { https?: boolean; sameSite?: 'lax' | 'none' }) => {
    const environmentService = {
      getCookieExpiresIn: jest.fn().mockReturnValue(cookieExpiresIn),
      isHttps: jest.fn().mockReturnValue(options?.https ?? true),
    };

    const csrfService = {
      getSameSite: jest.fn().mockReturnValue(options?.sameSite ?? 'none'),
      generateToken: jest.fn().mockReturnValue('csrf-token'),
      setCsrfCookie: jest.fn(),
      clearCsrfCookie: jest.fn(),
    } as unknown as jest.Mocked<CsrfService>;

    const service = new AuthCookieService(
      environmentService as any,
      csrfService as any,
    );

    return { service, environmentService, csrfService };
  };

  it('should expose a unified auth cookie options contract', () => {
    const { service } = createService({ https: true, sameSite: 'none' });

    expect(service.getAuthCookieOptions()).toEqual({
      httpOnly: true,
      path: '/',
      expires: cookieExpiresIn,
      secure: true,
      sameSite: 'none',
    });
  });

  it('should set auth and csrf cookies with unified options', () => {
    const { service, csrfService } = createService({ https: false, sameSite: 'lax' });
    const res = {
      setCookie: jest.fn(),
    } as any;

    service.setAuthCookies(res, 'auth-token');

    expect(res.setCookie).toHaveBeenCalledWith('authToken', 'auth-token', {
      httpOnly: true,
      path: '/',
      expires: cookieExpiresIn,
      secure: false,
      sameSite: 'lax',
    });
    expect(csrfService.generateToken).toHaveBeenCalledTimes(1);
    expect(csrfService.setCsrfCookie).toHaveBeenCalledWith(res, 'csrf-token');
  });

  it('should clear auth and csrf cookies symmetrically', () => {
    const { service, csrfService } = createService({ https: true, sameSite: 'none' });
    const res = {
      clearCookie: jest.fn(),
    } as any;

    service.clearAuthCookies(res);

    expect(res.clearCookie).toHaveBeenCalledWith('authToken', {
      path: '/',
      sameSite: 'none',
      secure: true,
    });
    expect(csrfService.clearCsrfCookie).toHaveBeenCalledWith(res);
  });
});
