import { HttpStatus } from '@nestjs/common';
import { SsoController } from './sso.controller';

describe('SsoController browser redirects', () => {
  const workspace = { id: 'workspace-id' } as any;
  const request = { raw: { sessionId: 'session-id' } } as any;
  let ssoService: Record<string, jest.Mock>;
  let authCookieService: { setAuthCookies: jest.Mock };
  let controller: SsoController;

  beforeEach(() => {
    ssoService = {
      getWorkspaceOrigin: jest.fn().mockReturnValue('http://docmost.test'),
      getOidcAuthorizeUrl: jest.fn().mockResolvedValue('https://idp.test/auth'),
      getSamlAuthorizeUrl: jest.fn().mockResolvedValue('https://idp.test/saml'),
      completeOidcLogin: jest.fn(),
    };
    authCookieService = { setAuthCookies: jest.fn() };
    controller = new SsoController(
      ssoService as any,
      {} as any,
      authCookieService as any,
    );
  });

  it('uses an explicit 302 for an OIDC authorization redirect', async () => {
    const response = { redirect: jest.fn() } as any;

    await controller.oidcLogin('provider-id', {}, workspace, response);

    expect(response.redirect).toHaveBeenCalledWith(
      'https://idp.test/auth',
      HttpStatus.FOUND,
    );
  });

  it('uses an explicit 302 for a SAML authorization redirect', async () => {
    const response = { redirect: jest.fn() } as any;

    await controller.samlLogin('provider-id', {}, workspace, response);

    expect(response.redirect).toHaveBeenCalledWith(
      'https://idp.test/saml',
      HttpStatus.FOUND,
    );
  });

  it('uses an explicit 302 after a successful OIDC callback', async () => {
    ssoService.completeOidcLogin.mockResolvedValue({
      authToken: 'test-token',
      userHasMfa: false,
      requiresMfaSetup: false,
      returnTo: '/home',
    });
    const response = { redirect: jest.fn() } as any;

    await controller.oidcCallback(
      'provider-id',
      { code: 'code', state: 'state' },
      workspace,
      request,
      response,
    );

    expect(authCookieService.setAuthCookies).toHaveBeenCalledWith(
      response,
      'test-token',
    );
    expect(response.redirect).toHaveBeenCalledWith(
      '/home',
      HttpStatus.FOUND,
    );
  });
});
