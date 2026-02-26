jest.mock('./services/auth.service', () => ({
  AuthService: class AuthService {},
}));

jest.mock('../mfa/mfa.service', () => ({
  MfaService: class MfaService {},
}));

import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const createController = () => {
    const authCookieService = {
      clearAuthCookies: jest.fn(),
      setAuthCookies: jest.fn(),
    };

    const controller = new AuthController(
      {} as any,
      authCookieService as any,
      {} as any,
    );

    return { controller, authCookieService };
  };

  it('should be defined', () => {
    const { controller } = createController();
    expect(controller).toBeDefined();
  });

  it('should clear auth cookies on logout via unified service', async () => {
    const { controller, authCookieService } = createController();
    const res = {} as any;

    await controller.logout(res);

    expect(authCookieService.clearAuthCookies).toHaveBeenCalledWith(res);
  });
});
