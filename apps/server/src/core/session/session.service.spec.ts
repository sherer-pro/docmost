import { SessionService } from './session.service';

describe('SessionService authentication assurance', () => {
  function createService() {
    const tokenService = {
      generateAccessToken: jest.fn().mockResolvedValue('access-token'),
    };
    const userSessionRepo = {
      insertSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
      findActiveById: jest.fn(),
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

  it('validates that a session belongs to the expected principal', async () => {
    const { service, userSessionRepo } = createService();
    userSessionRepo.findActiveById.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(
      service.isSessionActive('session-1', 'user-1', 'workspace-1'),
    ).resolves.toBe(true);
    await expect(
      service.isSessionActive('session-1', 'user-2', 'workspace-1'),
    ).resolves.toBe(false);
  });
});
