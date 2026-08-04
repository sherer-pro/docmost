import { HttpException } from '@nestjs/common';
import { AuthenticationAssuranceService } from './authentication-assurance.service';
import { SpacePolicyService } from './space-policy.service';

describe('AuthenticationAssuranceService', () => {
  const workspace = {
    id: 'workspace-1',
    enforceSso: true,
    enforceMfa: true,
    settings: {},
  } as any;
  const session = {
    id: 'session-1',
    ssoVerifiedAt: null,
    mfaVerifiedAt: null,
  } as any;

  function createService() {
    const spacePolicy = new SpacePolicyService({} as any);
    const service = new AuthenticationAssuranceService(
      {} as any,
      spacePolicy,
      {} as any,
    );
    return { service, spacePolicy };
  }

  function request(overrides: Record<string, unknown> = {}) {
    return {
      user: { workspace, session },
      params: {},
      query: {},
      body: {},
      ...overrides,
    };
  }

  async function expectAssuranceError(
    promise: Promise<void>,
    expected: Record<string, unknown>,
  ) {
    try {
      await promise;
      throw new Error('Expected assurance error');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(428);
      expect(exception.getResponse()).toMatchObject({
        statusCode: 428,
        code: 'AUTHENTICATION_ASSURANCE_REQUIRED',
        message: 'Additional authentication is required',
        ...expected,
      });
    }
  }

  it('reports session assurance and workspace requirements', () => {
    const { service } = createService();

    expect(service.getAuthenticationAssurance(workspace, session)).toEqual({
      ssoVerified: false,
      mfaVerified: false,
      workspaceRequirements: ['sso', 'mfa'],
      workspaceMissingRequirements: ['sso', 'mfa'],
    });
  });

  it('allows bootstrap routes without workspace assurance', async () => {
    const { service } = createService();

    await expect(
      service.assertRequestScope({ scope: 'bootstrap' }, request()),
    ).resolves.toBeUndefined();
  });

  it('uses workspace policy when a protected route has no scope metadata', async () => {
    const { service } = createService();

    await expectAssuranceError(service.assertRequestScope(undefined, request()), {
      scope: 'workspace',
      spaceId: null,
      requirements: ['sso', 'mfa'],
    });
  });

  it('allows an explicit space override to relax workspace assurance', async () => {
    const { service, spacePolicy } = createService();
    jest.spyOn(spacePolicy, 'resolveSpaceId').mockResolvedValue('space-1');
    jest.spyOn(spacePolicy, 'resolve').mockResolvedValue({
      overrides: {
        enforceSso: false,
        enforceMfa: false,
        disablePublicSharing: null,
      },
      effective: {
        enforceSso: false,
        enforceMfa: false,
        disablePublicSharing: false,
      },
    });

    await expect(
      service.assertRequestScope(
        { scope: 'space', key: 'spaceId' },
        request({ params: { spaceId: 'space-1' } }),
      ),
    ).resolves.toBeUndefined();
  });

  it('returns a space-scoped 428 for an insufficient resource session', async () => {
    const { service, spacePolicy } = createService();
    jest.spyOn(spacePolicy, 'resolveSpaceId').mockResolvedValue('space-1');
    jest.spyOn(spacePolicy, 'resolve').mockResolvedValue({
      overrides: {
        enforceSso: true,
        enforceMfa: true,
        disablePublicSharing: null,
      },
      effective: {
        enforceSso: true,
        enforceMfa: true,
        disablePublicSharing: false,
      },
    });

    await expectAssuranceError(
      service.assertRequestScope(
        { scope: 'space', key: 'spaceId' },
        request({ params: { spaceId: 'space-1' } }),
      ),
      {
        scope: 'space',
        spaceId: 'space-1',
        requirements: ['sso', 'mfa'],
      },
    );
  });

  it('does not apply session assurance to API-key authorization', async () => {
    const { service } = createService();

    await expect(
      service.assertRequestScope(undefined, {
        user: { authType: 'api_key' },
      }),
    ).resolves.toBeUndefined();
  });
});
