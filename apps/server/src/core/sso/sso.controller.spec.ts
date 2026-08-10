import { HttpStatus, NotFoundException } from '@nestjs/common';
import { SsoController, SSO_PROVIDER_ID_PIPE } from './sso.controller';

describe('SsoController browser redirects', () => {
  const workspace = { id: 'workspace-id' } as any;
  const request = { raw: { sessionId: 'session-id' }, cookies: {} } as any;
  let ssoService: Record<string, jest.Mock>;
  let authCookieService: { setAuthCookies: jest.Mock };
  let controller: SsoController;

  const createResponse = () =>
    ({
      redirect: jest.fn(),
      setCookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as any;

  beforeEach(() => {
    ssoService = {
      getWorkspaceOrigin: jest.fn().mockReturnValue('http://docmost.test'),
      getOidcAuthorizeUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://idp.test/auth', state: 'state-1' }),
      getSamlAuthorizeUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://idp.test/saml', state: 'state-2' }),
      completeOidcLogin: jest.fn(),
      completeSamlLogin: jest.fn(),
    };
    authCookieService = { setAuthCookies: jest.fn() };
    controller = new SsoController(
      ssoService as any,
      {} as any,
      authCookieService as any,
    );
  });

  it('uses an explicit 302 for an OIDC authorization redirect', async () => {
    const response = createResponse();

    await controller.oidcLogin('provider-id', {}, workspace, response);

    expect(response.redirect).toHaveBeenCalledWith(
      'https://idp.test/auth',
      HttpStatus.FOUND,
    );
  });

  it('uses an explicit 302 for a SAML authorization redirect', async () => {
    const response = createResponse();

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
    const response = createResponse();

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
    expect(response.redirect).toHaveBeenCalledWith('/home', HttpStatus.FOUND);
  });

  describe('login-state cookie binding', () => {
    it('stores the issued OIDC state in a host-only http-only cookie', async () => {
      const response = createResponse();

      await controller.oidcLogin('provider-id', {}, workspace, response);

      expect(response.setCookie).toHaveBeenCalledWith(
        'ssoLoginState',
        'state-1',
        expect.objectContaining({
          httpOnly: true,
          path: '/api/sso',
          sameSite: 'lax',
          secure: false,
        }),
      );
    });

    it('marks the SAML cookie cross-site only on a secure origin', async () => {
      ssoService.getWorkspaceOrigin.mockReturnValue('https://docmost.test');
      const response = createResponse();

      await controller.samlLogin('provider-id', {}, workspace, response);

      expect(response.setCookie).toHaveBeenCalledWith(
        'ssoLoginState',
        'state-2',
        expect.objectContaining({ sameSite: 'none', secure: true }),
      );
    });

    it('forwards the cookie value as the OIDC browser binding', async () => {
      ssoService.completeOidcLogin.mockResolvedValue({
        authToken: 'token',
        userHasMfa: false,
        requiresMfaSetup: false,
      });
      const response = createResponse();

      await controller.oidcCallback(
        'provider-id',
        { code: 'code', state: 'state' },
        workspace,
        { ...request, cookies: { ssoLoginState: 'state' } } as any,
        response,
      );

      expect(ssoService.completeOidcLogin).toHaveBeenCalledWith(
        'provider-id',
        workspace,
        'http://docmost.test',
        { code: 'code', state: 'state' },
        expect.anything(),
        { value: 'state', enforced: true },
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        'ssoLoginState',
        expect.objectContaining({ path: '/api/sso' }),
      );
    });

    it('still enforces the binding for OIDC when the cookie is missing', async () => {
      ssoService.completeOidcLogin.mockResolvedValue({ userHasMfa: false });
      const response = createResponse();

      await controller.oidcCallback(
        'provider-id',
        { code: 'code', state: 'state' },
        workspace,
        request,
        response,
      );

      expect(ssoService.completeOidcLogin).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { value: undefined, enforced: true },
      );
    });

    it('relaxes the SAML binding only where the cookie cannot be returned', async () => {
      ssoService.completeSamlLogin.mockResolvedValue({ userHasMfa: false });
      const response = createResponse();

      await controller.samlCallback(
        'provider-id',
        { RelayState: 'state', SAMLResponse: 'response' },
        workspace,
        request,
        response,
      );

      expect(ssoService.completeSamlLogin).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { value: undefined, enforced: false },
      );

      ssoService.getWorkspaceOrigin.mockReturnValue('https://docmost.test');
      await controller.samlCallback(
        'provider-id',
        { RelayState: 'state', SAMLResponse: 'response' },
        workspace,
        request,
        response,
      );

      expect(ssoService.completeSamlLogin).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { value: undefined, enforced: true },
      );
    });
  });

  describe('provider id validation', () => {
    it('rejects a malformed provider id before it reaches the database', async () => {
      await expect(
        SSO_PROVIDER_ID_PIPE.transform('not-a-uuid', { type: 'param' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        SSO_PROVIDER_ID_PIPE.transform('019fe8b8-7f02-72c9-b365-dd69e8f4ae87', {
          type: 'param',
        }),
      ).resolves.toBe('019fe8b8-7f02-72c9-b365-dd69e8f4ae87');
    });
  });
});
