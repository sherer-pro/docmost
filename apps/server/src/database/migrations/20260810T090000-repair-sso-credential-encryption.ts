import { type Kysely, sql } from 'kysely';
import {
  encryptProtectedValue,
  isEncryptedProtectedValue,
} from '../../common/security/credential-protection.util';

/**
 * Re-runs the SSO credential encryption for installations where
 * `20260807T120000-encrypt-sso-provider-credentials` was applied through the
 * application startup path. That migrator instance carried CamelCasePlugin, so
 * the snake_case row fields the original migration read came back undefined and
 * the provider secrets stayed in plaintext while the migration reported success.
 *
 * Raw SQL is used deliberately: it keeps the repair correct no matter which
 * plugins the migrator instance happens to carry.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret || appSecret.length < 32) {
    throw new Error(
      'APP_SECRET with at least 32 characters is required for SSO credential migration',
    );
  }

  const providers = await sql<{
    id: string;
    oidc_client_secret: string | null;
    ldap_bind_password: string | null;
  }>`
    SELECT id, oidc_client_secret, ldap_bind_password
    FROM auth_providers
    WHERE oidc_client_secret IS NOT NULL
       OR ldap_bind_password IS NOT NULL
  `.execute(db);

  for (const provider of providers.rows) {
    const oidcClientSecret =
      provider.oidc_client_secret &&
      !isEncryptedProtectedValue(provider.oidc_client_secret)
        ? encryptProtectedValue(provider.oidc_client_secret, appSecret)
        : null;
    const ldapBindPassword =
      provider.ldap_bind_password &&
      !isEncryptedProtectedValue(provider.ldap_bind_password)
        ? encryptProtectedValue(provider.ldap_bind_password, appSecret)
        : null;

    if (!oidcClientSecret && !ldapBindPassword) {
      continue;
    }

    await sql`
      UPDATE auth_providers
      SET oidc_client_secret = coalesce(${oidcClientSecret}, oidc_client_secret),
          ldap_bind_password = coalesce(${ldapBindPassword}, ldap_bind_password)
      WHERE id = ${provider.id}
    `.execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Intentionally irreversible: credentials must never be restored as plaintext.
}
