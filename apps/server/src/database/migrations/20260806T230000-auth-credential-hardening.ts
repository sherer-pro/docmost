import { type Kysely } from 'kysely';
import {
  encryptProtectedValue,
  hashKeyedProtectedValue,
  hashProtectedValue,
  isEncryptedProtectedValue,
  isHashedProtectedValue,
  isKeyedHashedProtectedValue,
  wrapHashedProtectedValue,
} from '../../common/security/credential-protection.util';

const FORGOT_PASSWORD_TOKEN_TYPE = 'forgot-password';

export async function up(db: Kysely<any>): Promise<void> {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret || appSecret.length < 32) {
    throw new Error(
      'APP_SECRET with at least 32 characters is required for credential migration',
    );
  }

  await db.schema
    .alterTable('user_mfa')
    .addColumn('last_used_totp_counter', 'bigint')
    .execute();

  await db
    .deleteFrom('user_tokens')
    .where('expires_at', '<', new Date())
    .execute();

  const resetTokens = await db
    .selectFrom('user_tokens')
    .select(['id', 'token'])
    .where('type', '=', FORGOT_PASSWORD_TOKEN_TYPE)
    .execute();

  for (const resetToken of resetTokens) {
    if (isHashedProtectedValue(resetToken.token)) {
      continue;
    }

    await db
      .updateTable('user_tokens')
      .set({ token: hashProtectedValue(resetToken.token) })
      .where('id', '=', resetToken.id)
      .execute();
  }

  const mfaRows = await db
    .selectFrom('user_mfa')
    .select(['id', 'secret', 'backup_codes'])
    .execute();

  for (const mfa of mfaRows) {
    const secret =
      mfa.secret && !isEncryptedProtectedValue(mfa.secret)
        ? encryptProtectedValue(mfa.secret, appSecret)
        : mfa.secret;
    const backupCodes = (mfa.backup_codes ?? []).map((code: string) => {
      if (isKeyedHashedProtectedValue(code)) {
        return code;
      }
      if (isHashedProtectedValue(code)) {
        return wrapHashedProtectedValue(code, appSecret);
      }
      return hashKeyedProtectedValue(code.trim().toUpperCase(), appSecret);
    });

    await db
      .updateTable('user_mfa')
      .set({
        secret,
        backup_codes: backupCodes,
        updated_at: new Date(),
      })
      .where('id', '=', mfa.id)
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('user_mfa')
    .dropColumn('last_used_totp_counter')
    .execute();
}
