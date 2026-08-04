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

    const authService = {
      passwordReset: jest.fn().mockResolvedValue({
        requiresLogin: true,
      }),
    };
    const controller = new AuthController(
      authService as any,
      authCookieService as any,
      {} as any,
      { revokeSession: jest.fn() } as any,
    );

    return { controller, authCookieService, authService };
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

  it('delegates targeted password reset enforcement to the auth service', async () => {
    const { controller, authService } = createController();
    const dto = { spaceSlug: 'eligible-space' } as any;
    const workspace = { enforceSso: true } as any;

    await expect(
      controller.passwordReset({} as any, dto, workspace),
    ).resolves.toEqual({ requiresLogin: true });
    expect(authService.passwordReset).toHaveBeenCalledWith(dto, workspace);
  });
});
