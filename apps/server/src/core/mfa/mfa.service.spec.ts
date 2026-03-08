import { BadRequestException } from '@nestjs/common';
import { MfaService } from './mfa.service';
import {
  encryptProtectedValue,
  isHashedProtectedValue,
} from '../../common/security/credential-protection.util';

describe('MfaService security helpers', () => {
  const appSecret = 'very-strong-app-secret-for-tests-only';

  const createService = () =>
    new MfaService(
      {} as any,
      {} as any,
      {} as any,
      { getAppSecret: () => appSecret } as any,
    );

  it('hashBackupCodes stores backup codes as hashes', () => {
    const service = createService();

    const hashed = (service as any).hashBackupCodes(['ABCD1234', 'ZXCV5678']);

    expect(hashed).toHaveLength(2);
    expect(isHashedProtectedValue(hashed[0])).toBe(true);
    expect(isHashedProtectedValue(hashed[1])).toBe(true);
  });

  it('consumeBackupCode supports legacy plaintext and migrates remaining codes to hashes', () => {
    const service = createService();

    const result = (service as any).consumeBackupCode('abcd1234', [
      'ABCD1234',
      'ZXCV5678',
    ]);

    expect(result.matched).toBe(true);
    expect(result.remaining).toHaveLength(1);
    expect(isHashedProtectedValue(result.remaining[0])).toBe(true);
  });

  it('getTotpSecret decrypts encrypted values and keeps legacy plaintext', () => {
    const service = createService();
    const encrypted = encryptProtectedValue('BASE32SECRET', appSecret);

    expect((service as any).getTotpSecret(encrypted)).toBe('BASE32SECRET');
    expect((service as any).getTotpSecret('LEGACYSECRET')).toBe('LEGACYSECRET');
  });

  it('getTotpSecret rejects invalid encrypted payloads', () => {
    const service = createService();

    expect(() => (service as any).getTotpSecret('enc:v1:broken')).toThrow(
      BadRequestException,
    );
  });
});
