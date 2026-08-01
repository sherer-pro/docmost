jest.mock('./services/auth.service', () => ({
  AuthService: class AuthService {},
}));

jest.mock('../mfa/mfa.service', () => ({
  MfaService: class MfaService {},
}));

import { AuthController } from './auth.controller';
import { BadRequestException } from '@nestjs/common';

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
      { revokeSession: jest.fn() } as any,
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
    const req = { raw: {} } as any;
    const user = { id: 'user-1', workspaceId: 'workspace-1' } as any;

    await controller.logout(user, req, res);

    expect(authCookieService.clearAuthCookies).toHaveBeenCalledWith(res);
  });

  it('rejects password reset when SSO is enforced', async () => {
    const { controller } = createController();

    await expect(
      controller.passwordReset(
        {} as any,
        {} as any,
        { enforceSso: true } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
