import {
  decryptProtectedValue,
  encryptProtectedValue,
  isEncryptedProtectedValue,
} from '../../common/security/credential-protection.util';
import { up } from '../migrations/20260807T120000-encrypt-sso-provider-credentials';

describe('encrypt SSO provider credentials migration', () => {
  const appSecret = 'migration-test-secret-with-at-least-32-characters';
  const originalAppSecret = process.env.APP_SECRET;

  afterEach(() => {
    if (originalAppSecret === undefined) {
      delete process.env.APP_SECRET;
    } else {
      process.env.APP_SECRET = originalAppSecret;
    }
  });

  it('encrypts plaintext OIDC and LDAP credentials without re-encrypting envelopes', async () => {
    process.env.APP_SECRET = appSecret;
    const alreadyEncrypted = encryptProtectedValue('already-safe', appSecret);
    const rows = [
      {
        id: 'plaintext-provider',
        oidc_client_secret: 'oidc-plaintext',
        ldap_bind_password: 'ldap-plaintext',
      },
      {
        id: 'encrypted-provider',
        oidc_client_secret: alreadyEncrypted,
        ldap_bind_password: null,
      },
    ];
    const updates: Array<{ id: string; values: Record<string, string> }> = [];
    const selectQuery: any = {
      select: jest.fn(() => selectQuery),
      where: jest.fn(() => selectQuery),
      execute: jest.fn().mockResolvedValue(rows),
    };
    const db: any = {
      selectFrom: jest.fn(() => selectQuery),
      updateTable: jest.fn(() => {
        let values: Record<string, string> = {};
        const query: any = {
          set: jest.fn((input: Record<string, string>) => {
            values = input;
            return query;
          }),
          where: jest.fn((_field: string, _operator: string, id: string) => {
            updates.push({ id, values });
            return query;
          }),
          execute: jest.fn(),
        };
        return query;
      }),
    };

    await up(db);

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('plaintext-provider');
    expect(
      isEncryptedProtectedValue(updates[0].values.oidc_client_secret),
    ).toBe(true);
    expect(
      decryptProtectedValue(
        updates[0].values.oidc_client_secret,
        appSecret,
      ),
    ).toBe('oidc-plaintext');
    expect(
      decryptProtectedValue(
        updates[0].values.ldap_bind_password,
        appSecret,
      ),
    ).toBe('ldap-plaintext');
  });

  it('requires the same strong APP_SECRET contract as application startup', async () => {
    delete process.env.APP_SECRET;

    await expect(up({} as any)).rejects.toThrow(
      'APP_SECRET with at least 32 characters is required',
    );
  });
});
