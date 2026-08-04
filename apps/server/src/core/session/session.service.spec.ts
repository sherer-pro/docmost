import { SessionService } from './session.service';

describe('SessionService authentication assurance', () => {
  function createService() {
    const tokenService = {
      generateAccessToken: jest.fn().mockResolvedValue('access-token'),
    };
    const userSessionRepo = {
      insertSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
    };
    const environmentService = {
      getCookieExpiresIn: jest
        .fn()
        .mockReturnValue(new Date('2027-01-01T00:00:00.000Z')),
      getTrustedProxies: jest.fn().mockReturnValue([]),
    };
    return {
      service: new SessionService(
        tokenService as any,
        userSessionRepo as any,
        environmentService as any,
      ),
      tokenService,
      userSessionRepo,
    };
  }

  it('persists SSO and MFA assurance transferred through the MFA token flow', async () => {
    const { service, userSessionRepo, tokenService } = createService();
    const user = { id: 'user-1', workspaceId: 'workspace-1' } as any;

    await expect(
      service.createSessionAndToken(user, undefined, {
        ssoAuthProviderId: 'provider-1',
        mfaVerified: true,
      }),
    ).resolves.toBe('access-token');

    expect(userSessionRepo.insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        ssoAuthProviderId: 'provider-1',
        ssoVerifiedAt: expect.any(Date),
        mfaVerifiedAt: expect.any(Date),
      }),
    );
    expect(tokenService.generateAccessToken).toHaveBeenCalledWith(
      user,
      'session-1',
    );
  });
});
