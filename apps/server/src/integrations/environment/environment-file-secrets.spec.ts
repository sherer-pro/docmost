import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEnvironmentFileSecrets } from './environment-file-secrets';

describe('Environment file secrets', () => {
  let directory: string;
  const originalAppSecret = process.env.APP_SECRET;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'docmost-env-secret-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (originalAppSecret === undefined) {
      delete process.env.APP_SECRET;
    } else {
      process.env.APP_SECRET = originalAppSecret;
    }
  });

  it('loads a secret and removes exactly one trailing newline', () => {
    const filePath = join(directory, 'app-secret');
    writeFileSync(filePath, `${'a'.repeat(32)}\n\n`, 'utf8');
    const config = { APP_SECRET_FILE: filePath };

    expect(resolveEnvironmentFileSecrets(config)).toEqual([]);
    expect(config).toMatchObject({ APP_SECRET: `${'a'.repeat(32)}\n` });
    expect(process.env.APP_SECRET).toBe(`${'a'.repeat(32)}\n`);
  });

  it('rejects configuring a direct value and file together', () => {
    const filePath = join(directory, 'app-secret');
    writeFileSync(filePath, 'b'.repeat(32), 'utf8');

    expect(
      resolveEnvironmentFileSecrets({
        APP_SECRET: 'a'.repeat(32),
        APP_SECRET_FILE: filePath,
      }),
    ).toEqual(['APP_SECRET and APP_SECRET_FILE cannot be configured together']);
  });

  it('rejects an empty required secret file', () => {
    const filePath = join(directory, 'app-secret');
    writeFileSync(filePath, '', 'utf8');

    expect(
      resolveEnvironmentFileSecrets({ APP_SECRET_FILE: filePath }),
    ).toEqual(['APP_SECRET_FILE must not be empty']);
  });

  it('rejects an unreadable secret file', () => {
    expect(
      resolveEnvironmentFileSecrets({
        APP_SECRET_FILE: join(directory, 'missing'),
      }),
    ).toEqual(['APP_SECRET_FILE must point to a readable file']);
  });

  it('rejects an empty optional secret file', () => {
    const filePath = join(directory, 'smtp-password');
    writeFileSync(filePath, '', 'utf8');
    const config = { SMTP_PASSWORD_FILE: filePath };

    expect(resolveEnvironmentFileSecrets(config)).toEqual([
      'SMTP_PASSWORD_FILE must not be empty',
    ]);
  });

  it('rejects an absent optional secret file', () => {
    expect(
      resolveEnvironmentFileSecrets({
        SMTP_PASSWORD_FILE: '/run/secrets/docmost_smtp_password',
      }),
    ).toEqual(['SMTP_PASSWORD_FILE must point to a readable file']);
  });
});
