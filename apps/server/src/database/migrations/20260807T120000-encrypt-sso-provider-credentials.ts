import { type Kysely } from 'kysely';
import {
  encryptProtectedValue,
  isEncryptedProtectedValue,
} from '../../common/security/credential-protection.util';

export async function up(db: Kysely<any>): Promise<void> {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret || appSecret.length < 32) {
    throw new Error(
      'APP_SECRET with at least 32 characters is required for SSO credential migration',
    );
  }

  const providers = await db
    .selectFrom('auth_providers')
    .select(['id', 'oidc_client_secret', 'ldap_bind_password'])
    .where((expression) =>
      expression.or([
        expression('oidc_client_secret', 'is not', null),
        expression('ldap_bind_password', 'is not', null),
      ]),
    )
    .execute();

  for (const provider of providers) {
    const updates: Record<string, string> = {};
    if (
      provider.oidc_client_secret &&
      !isEncryptedProtectedValue(provider.oidc_client_secret)
    ) {
      updates.oidc_client_secret = encryptProtectedValue(
        provider.oidc_client_secret,
        appSecret,
      );
    }
    if (
      provider.ldap_bind_password &&
      !isEncryptedProtectedValue(provider.ldap_bind_password)
    ) {
      updates.ldap_bind_password = encryptProtectedValue(
        provider.ldap_bind_password,
        appSecret,
      );
    }

    if (Object.keys(updates).length > 0) {
      await db
        .updateTable('auth_providers')
        .set(updates)
        .where('id', '=', provider.id)
        .execute();
    }
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Intentionally irreversible: credentials must never be restored as plaintext.
}
