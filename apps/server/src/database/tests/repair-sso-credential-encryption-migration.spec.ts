import {
  decryptProtectedValue,
  encryptProtectedValue,
  isEncryptedProtectedValue,
} from '../../common/security/credential-protection.util';
import { up } from '../migrations/20260810T090000-repair-sso-credential-encryption';

/**
 * Builds a Kysely-like executor that answers raw `sql` queries with fixed rows
 * and records every statement, mirroring how Postgres returns physical
 * snake_case column names.
 */
function createDb(rows: Array<Record<string, unknown>>) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  let selectServed = false;

  const db: any = {
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: (node: any) => {
        const sqlText = (node.sqlFragments ?? [])
          .map((fragment: string, index: number) =>
            index === 0 ? fragment : `$${index}${fragment}`,
          )
          .join('');
        return {
          sql: sqlText,
          parameters: (node.parameters ?? []).map(
            (parameter: any) => parameter.value,
          ),
        };
      },
      executeQuery: async (compiled: any) => {
        statements.push({
          sql: compiled.sql,
          parameters: compiled.parameters,
        });
        if (!selectServed) {
          selectServed = true;
          return { rows };
        }
        return { rows: [] };
      },
      provideConnection: async (consumer: any) => consumer({}),
    }),
  };

  return { db, statements };
}

describe('repair SSO credential encryption migration', () => {
  const appSecret = 'repair-migration-secret-with-32-plus-characters';
  const originalAppSecret = process.env.APP_SECRET;

  afterEach(() => {
    if (originalAppSecret === undefined) {
      delete process.env.APP_SECRET;
    } else {
      process.env.APP_SECRET = originalAppSecret;
    }
  });

  it('encrypts credentials that an earlier migration left in plaintext', async () => {
    process.env.APP_SECRET = appSecret;
    const { db, statements } = createDb([
      {
        id: 'plaintext-provider',
        oidc_client_secret: 'oidc-plaintext',
        ldap_bind_password: 'ldap-plaintext',
      },
    ]);

    await up(db);

    const update = statements.find((statement) =>
      statement.sql.includes('UPDATE auth_providers'),
    );
    expect(update).toBeDefined();
    const [oidcSecret, ldapPassword, id] = update!.parameters as string[];
    expect(id).toBe('plaintext-provider');
    expect(isEncryptedProtectedValue(oidcSecret)).toBe(true);
    expect(decryptProtectedValue(oidcSecret, appSecret)).toBe('oidc-plaintext');
    expect(decryptProtectedValue(ldapPassword, appSecret)).toBe(
      'ldap-plaintext',
    );
  });

  it('leaves already encrypted credentials untouched', async () => {
    process.env.APP_SECRET = appSecret;
    const { db, statements } = createDb([
      {
        id: 'encrypted-provider',
        oidc_client_secret: encryptProtectedValue('already-safe', appSecret),
        ldap_bind_password: null,
      },
    ]);

    await up(db);

    expect(
      statements.some((statement) =>
        statement.sql.includes('UPDATE auth_providers'),
      ),
    ).toBe(false);
  });

  it('keeps the other credential column when only one needs encryption', async () => {
    process.env.APP_SECRET = appSecret;
    const { db, statements } = createDb([
      {
        id: 'mixed-provider',
        oidc_client_secret: encryptProtectedValue('already-safe', appSecret),
        ldap_bind_password: 'ldap-plaintext',
      },
    ]);

    await up(db);

    const update = statements.find((statement) =>
      statement.sql.includes('UPDATE auth_providers'),
    );
    const [oidcSecret, ldapPassword] = update!.parameters as Array<
      string | null
    >;
    expect(oidcSecret).toBeNull();
    expect(decryptProtectedValue(ldapPassword!, appSecret)).toBe(
      'ldap-plaintext',
    );
  });

  it('requires the same strong APP_SECRET contract as application startup', async () => {
    delete process.env.APP_SECRET;

    await expect(up({} as any)).rejects.toThrow(
      'APP_SECRET with at least 32 characters is required',
    );
  });
});
