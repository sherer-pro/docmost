import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { SsoService } from './sso.service';
import { isEnforcementReadyProvider } from './sso-provider.util';

describe('SsoService security helpers', () => {
  const appSecret = 'very-strong-app-secret-for-sso-tests';

  const createService = (
    db: any = {},
    overrides: {
      userRepo?: unknown;
      assuranceService?: unknown;
      tokenService?: unknown;
      endpointPolicy?: unknown;
    } = {},
  ) =>
    new SsoService(
      db,
      (overrides.userRepo ?? {}) as any,
      {} as any,
      {} as any,
      {
        getAppSecret: () => appSecret,
        isDevelopment: () => false,
        getSsoAllowedEndpoints: () => '',
      } as any,
      { getUrl: () => 'https://docs.example.com' } as any,
      (overrides.endpointPolicy ?? { assertAllowed: jest.fn() }) as any,
      {} as any,
      (overrides.assuranceService ?? {}) as any,
      (overrides.tokenService ?? {}) as any,
    );

  it('requires an endpoint-policy-approved alternative provider for enforced SSO', async () => {
    const provider = {
      type: 'oidc',
      oidcIssuer: 'https://blocked.example.com',
      oidcClientId: 'client-id',
      oidcClientSecret: 'encrypted-secret',
      verifiedAt: new Date(),
      lastSuccessfulLoginAt: new Date(),
    } as any;
    const endpointPolicy = {
      assertAllowed: jest
        .fn()
        .mockRejectedValue(new Error('Endpoint is not allowed')),
    };
    const service = createService({}, { endpointPolicy });

    await expect(
      (service as any).hasAllowedEnforcementReadyProvider([provider]),
    ).resolves.toBe(false);
  });

  it('protects enforced SSO when a provider update invalidates verification', async () => {
    const current = {
      id: 'provider-id',
      workspaceId: 'workspace-id',
      type: 'oidc',
      name: 'Provider',
      isEnabled: true,
      oidcIssuer: 'https://idp.example.com',
      oidcClientId: 'client-id',
      oidcClientSecret: 'encrypted-secret',
      verifiedAt: new Date(),
      lastSuccessfulLoginAt: new Date(),
    } as any;
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      returningAll: jest.fn(() => updateQuery),
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({
        ...current,
        oidcIssuer: 'https://new-idp.example.com',
        verifiedAt: null,
      }),
    };
    const trx = { updateTable: jest.fn(() => updateQuery) };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (transaction: any) => unknown) => callback(trx),
      })),
    };
    const service = createService(db);
    jest
      .spyOn(service as any, 'requireProvider')
      .mockResolvedValue(current);
    const availabilityCheck = jest
      .spyOn(service as any, 'assertSsoWillRemainAvailable')
      .mockResolvedValue(undefined);

    await service.updateProvider(
      {
        providerId: current.id,
        oidcIssuer: 'https://new-idp.example.com',
      },
      current.workspaceId,
    );

    expect(availabilityCheck).toHaveBeenCalledWith(
      current.workspaceId,
      current.id,
      trx,
    );
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedAt: null, lastErrorCode: null }),
    );
  });

  it('encrypts provider secrets and redacts them from responses', () => {
    const service = createService();
    const encrypted = (service as any).encryptSecret('client-secret');

    expect(encrypted).not.toContain('client-secret');
    expect((service as any).decryptSecret(encrypted)).toBe('client-secret');
    expect(
      (service as any).sanitizeProvider({
        oidcClientSecret: encrypted,
        ldapBindPassword: encrypted,
      }),
    ).toMatchObject({
      oidcClientSecret: '********',
      ldapBindPassword: '********',
    });
  });

  it('does not allow an unverified OIDC email to create a new link', async () => {
    const service = createService();
    const client = {
      userinfo: jest.fn().mockRejectedValue(new Error('not available')),
    };
    const tokenSet = {
      access_token: 'access-token',
      claims: () => ({
        sub: 'external-user',
        email: 'user@example.com',
        email_verified: false,
      }),
    };

    const identity = await (service as any).identityFromOidc(client, tokenSet);

    expect(identity.emailVerified).toBe(false);
    expect(() =>
      (service as any).assertEmailVerifiedForLinking(identity),
    ).toThrow(UnauthorizedException);
  });

  it('keeps email verification bound to the claim source', async () => {
    const service = createService();
    const client = {
      userinfo: jest.fn().mockResolvedValue({
        sub: 'external-user',
        email: 'other@example.com',
        email_verified: true,
      }),
    };
    const tokenSet = {
      access_token: 'access-token',
      claims: () => ({
        sub: 'external-user',
        email: 'user@example.com',
        email_verified: false,
      }),
    };

    const identity = await (service as any).identityFromOidc(client, tokenSet);

    expect(identity).toMatchObject({
      email: 'user@example.com',
      emailVerified: false,
    });
  });

  it('escapes every RFC4515 special character in LDAP usernames', () => {
    const service = createService();

    expect((service as any).escapeLdapFilterValue('a*(b)\\\0')).toBe(
      'a\\2a\\28b\\29\\5c\\00',
    );
  });

  it('requires an LDAP username placeholder before enabling a provider', () => {
    const service = createService();

    expect(() =>
      (service as any).validateProviderConfiguration({
        type: 'ldap',
        ldapUrl: 'ldaps://directory.example.com',
        ldapBindDn: 'cn=service,dc=example,dc=com',
        ldapBindPassword: 'encrypted',
        ldapBaseDn: 'dc=example,dc=com',
        ldapUserSearchFilter: '(mail=user@example.com)',
      }),
    ).toThrow(BadRequestException);
  });

  it('does not treat a truncated group list as an authoritative snapshot', () => {
    const service = createService();
    const externalGroups = Array.from({ length: 101 }, (_, index) => ({
      id: `group-${String(index).padStart(3, '0')}`,
      name: `Group ${index}`,
    }));

    const snapshot = (service as any).prepareGroupSyncSnapshot(externalGroups);

    expect(snapshot.groups).toHaveLength(100);
    expect(snapshot.completeSnapshot).toBe(false);
    expect(snapshot.groups[0].id).toBe('group-000');
  });

  it('enforces workspace email domains for just-in-time signup', () => {
    const service = createService();

    expect(() =>
      (service as any).assertSignupDomainAllowed('user@other.example', {
        emailDomains: ['example.com'],
      }),
    ).toThrow(ForbiddenException);
  });

  it('binds SAML request lookup to the matching login state', async () => {
    const where = jest.fn();
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn((...args: any[]) => {
        where(...args);
        return query;
      }),
      executeTakeFirst: jest.fn().mockResolvedValue({
        requestValue: 'request-value',
      }),
    };
    const db = {
      selectFrom: jest.fn(() => query),
    };
    const service = createService(db);
    const cache = (service as any).createSamlCacheProvider(
      'provider-id',
      'state-hash',
    );

    await expect(cache.getAsync('request-id')).resolves.toBe('request-value');
    expect(where).toHaveBeenCalledWith('stateHash', '=', 'state-hash');
    expect(where).toHaveBeenCalledWith('requestId', '=', 'request-id');
  });

  it('claims a login state with one atomic conditional update', async () => {
    const where = jest.fn();
    const query: any = {
      set: jest.fn(() => query),
      where: jest.fn((...args: any[]) => {
        where(...args);
        return query;
      }),
      returningAll: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue({ id: 'state-id' }),
    };
    const db = {
      updateTable: jest.fn(() => query),
    };
    const service = createService(db);

    await expect(
      (service as any).claimLoginState(
        'raw-state',
        'provider-id',
        'workspace-id',
      ),
    ).resolves.toMatchObject({ id: 'state-id' });

    expect(db.updateTable).toHaveBeenCalledWith('ssoLoginStates');
    expect(where).toHaveBeenCalledWith('consumedAt', 'is', null);
    expect(query.returningAll).toHaveBeenCalledTimes(1);
  });

  it('rejects a consumed or missing login state', async () => {
    const query: any = {
      set: jest.fn(() => query),
      where: jest.fn(() => query),
      returningAll: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    };
    const service = createService({ updateTable: jest.fn(() => query) });

    await expect(
      (service as any).claimLoginState(
        'replayed-state',
        'provider-id',
        'workspace-id',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects step-up when the external identity belongs to another user', async () => {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue({ userId: 'other-user' }),
    };
    const service = createService({ selectFrom: jest.fn(() => query) });

    await expect(
      (service as any).assertStepUpIdentity(
        { id: 'provider-1' },
        { id: 'workspace-1' },
        {
          providerUserId: 'external-1',
          email: 'user@example.com',
          emailVerified: true,
        },
        'expected-user',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts an unlinked verified identity only for the same user', async () => {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    };
    const expectedUser = {
      id: 'expected-user',
      deletedAt: null,
      deactivatedAt: null,
    };
    const service = createService(
      { selectFrom: jest.fn(() => query) },
      {
        userRepo: {
          findByEmail: jest.fn().mockResolvedValue(expectedUser),
        },
      },
    );

    await expect(
      (service as any).assertStepUpIdentity(
        { id: 'provider-1' },
        { id: 'workspace-1' },
        {
          providerUserId: 'external-1',
          email: 'user@example.com',
          emailVerified: true,
        },
        'expected-user',
      ),
    ).resolves.toBe(expectedUser);
  });

  it('requires the current cookie session to match the step-up state', async () => {
    const service = createService({}, {
      tokenService: {
        verifyJwt: jest.fn().mockResolvedValue({
          sub: 'other-user',
          workspaceId: 'workspace-1',
          sessionId: 'session-1',
        }),
      },
    });

    await expect(
      (service as any).assertCurrentSessionBinding(
        { cookies: { authToken: 'access-token' } },
        'workspace-1',
        'expected-user',
        'session-1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts only safe relative return paths', () => {
    const service = createService();

    expect((service as any).safeReturnTo('/s/docs/page?tab=1')).toBe(
      '/s/docs/page?tab=1',
    );
    expect((service as any).safeReturnTo('https://evil.example')).toBe('/home');
    expect((service as any).safeReturnTo('//evil.example')).toBe('/home');
    expect((service as any).safeReturnTo('/safe\\evil')).toBe('/home');
    expect((service as any).safeReturnTo('/safe\r\nLocation: evil')).toBe(
      '/home',
    );
    expect((service as any).safeReturnTo('/%5c%5cevil.example')).toBe('/home');
    expect((service as any).safeReturnTo('/%2f%2fevil.example')).toBe('/home');
    expect((service as any).safeReturnTo('/safe%0d%0aLocation:evil')).toBe(
      '/home',
    );
    expect((service as any).safeReturnTo('/%')).toBe('/home');
  });

  it('transfers an SSO-owned group membership to another active provider', async () => {
    const deletedTables: string[] = [];
    const updatedIds: string[] = [];
    const createDeleteQuery = (table: string) => {
      const query: any = {
        where: jest.fn(() => query),
        execute: jest.fn(async () => {
          deletedTables.push(table);
        }),
      };
      return query;
    };
    const selectQuery: any = {
      innerJoin: jest.fn(() => selectQuery),
      select: jest.fn(() => selectQuery),
      where: jest.fn(() => selectQuery),
      orderBy: jest.fn(() => selectQuery),
      executeTakeFirst: jest.fn().mockResolvedValue({ id: 'successor-id' }),
    };
    const createUpdateQuery = () => {
      const query: any = {
        set: jest.fn(() => query),
        where: jest.fn((field: string, _operator: string, value: string) => {
          if (field === 'id') updatedIds.push(value);
          return query;
        }),
        execute: jest.fn(),
      };
      return query;
    };
    const trx = {
      deleteFrom: jest.fn((table: string) => createDeleteQuery(table)),
      selectFrom: jest.fn(() => selectQuery),
      updateTable: jest.fn(() => createUpdateQuery()),
    };
    const service = createService();

    await (service as any).releaseProviderGroupMembership(
      {
        id: 'membership-id',
        userId: 'user-id',
        groupId: 'group-id',
        ownsGroupMembership: true,
      },
      trx,
    );

    expect(deletedTables).toEqual(['authProviderGroupMemberships']);
    expect(updatedIds).toContain('successor-id');
    expect(selectQuery.where).toHaveBeenCalledWith(
      'authProviders.isEnabled',
      '=',
      true,
    );
  });

  it('preserves a manual group membership when SSO tracking is removed', async () => {
    const deletedTables: string[] = [];
    const createDeleteQuery = (table: string) => {
      const query: any = {
        where: jest.fn(() => query),
        execute: jest.fn(async () => {
          deletedTables.push(table);
        }),
      };
      return query;
    };
    const trx = {
      deleteFrom: jest.fn((table: string) => createDeleteQuery(table)),
    };
    const service = createService();

    await (service as any).releaseProviderGroupMembership(
      {
        id: 'membership-id',
        userId: 'user-id',
        groupId: 'group-id',
        ownsGroupMembership: false,
      },
      trx,
    );

    expect(deletedTables).toEqual(['authProviderGroupMemberships']);
  });

  it('never maps an external group that no administrator configured', async () => {
    const groupUserInserts: unknown[] = [];
    const trx: any = {
      // Minimal executor so the advisory-lock raw query can run against the mock.
      getExecutor: () => ({
        transformQuery: (node: unknown) => node,
        compileQuery: () => ({ sql: '', parameters: [] }),
        executeQuery: async () => ({ rows: [] }),
      }),
      selectFrom: jest.fn((table: string) => {
        const query: any = {
          select: jest.fn(() => query),
          selectAll: jest.fn(() => query),
          where: jest.fn(() => query),
          forShare: jest.fn(() => query),
          orderBy: jest.fn(() => query),
          executeTakeFirst: jest.fn(async () =>
            table === 'authProviders'
              ? { isEnabled: true, groupSync: true, deletedAt: null }
              : undefined,
          ),
          execute: jest.fn(async () => []),
        };
        return query;
      }),
      insertInto: jest.fn((table: string) => {
        const query: any = {
          values: jest.fn((value: unknown) => {
            groupUserInserts.push({ table, value });
            return query;
          }),
          onConflict: jest.fn(() => query),
          returning: jest.fn(() => query),
          returningAll: jest.fn(() => query),
          execute: jest.fn(),
          executeTakeFirst: jest.fn(),
        };
        return query;
      }),
      updateTable: jest.fn(() => {
        const query: any = {
          set: jest.fn(() => query),
          where: jest.fn(() => query),
          execute: jest.fn(),
        };
        return query;
      }),
      deleteFrom: jest.fn(() => {
        const query: any = {
          where: jest.fn(() => query),
          execute: jest.fn(),
        };
        return query;
      }),
    };
    const db: any = {
      transaction: () => ({
        execute: (callback: (t: unknown) => unknown) => callback(trx),
      }),
    };
    const service = createService(db);

    await (service as any).syncGroups(
      { id: 'provider-1', workspaceId: 'workspace-1', groupSync: true },
      { id: 'user-1' },
      [{ id: 'Admins', name: 'Admins' }],
    );

    // No mapping exists, so no group is created and no membership is granted.
    expect(groupUserInserts).toHaveLength(0);
    expect(trx.insertInto).not.toHaveBeenCalledWith('groups');
  });

  it('requires verification and a real login before SSO can be enforced', () => {
    const base = {
      type: 'oidc' as const,
      oidcIssuer: 'https://idp.example.com',
      oidcClientId: 'client',
      oidcClientSecret: 'enc:v1:secret',
    };

    expect(
      isEnforcementReadyProvider({
        ...base,
        verifiedAt: null,
        lastSuccessfulLoginAt: null,
      } as any),
    ).toBe(false);
    expect(
      isEnforcementReadyProvider({
        ...base,
        verifiedAt: new Date(),
        lastSuccessfulLoginAt: null,
      } as any),
    ).toBe(false);
    expect(
      isEnforcementReadyProvider({
        ...base,
        verifiedAt: new Date(),
        lastSuccessfulLoginAt: new Date(),
      } as any),
    ).toBe(true);
  });

  it('rejects a base64-invalid SAML signing certificate', () => {
    const service = createService();

    expect(() =>
      (service as any).testSamlProvider({
        samlCertificate: [
          '-----BEGIN CERTIFICATE-----',
          'not base64!!!',
          '-----END CERTIFICATE-----',
        ].join('\n'),
      }),
    ).toThrow(BadRequestException);
  });
});
