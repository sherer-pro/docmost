import {
  decryptProtectedValue,
  encryptProtectedValue,
  hashKeyedProtectedValue,
  hashProtectedValue,
  isEncryptedProtectedValue,
  isHashedProtectedValue,
  isKeyedHashedProtectedValue,
  safeStringEqual,
  verifyKeyedProtectedValue,
  verifyHashedProtectedValue,
  wrapHashedProtectedValue,
} from './credential-protection.util';

describe('credential-protection.util', () => {
  it('hashes values with a stable prefix', () => {
    const hash = hashProtectedValue('demo-token');

    expect(hash.startsWith('sha256:')).toBe(true);
    expect(isHashedProtectedValue(hash)).toBe(true);
  });

  it('verifies hashed values and rejects wrong input', () => {
    const hash = hashProtectedValue('token-123');

    expect(verifyHashedProtectedValue('token-123', hash)).toBe(true);
    expect(verifyHashedProtectedValue('other', hash)).toBe(false);
  });

  it('protects low-entropy values with an application-secret keyed hash', () => {
    const appSecret = 'application-secret-for-keyed-hash-tests';
    const protectedValue = hashKeyedProtectedValue('RECOVERY1', appSecret);

    expect(isKeyedHashedProtectedValue(protectedValue)).toBe(true);
    expect(
      verifyKeyedProtectedValue('RECOVERY1', protectedValue, appSecret),
    ).toBe(true);
    expect(
      verifyKeyedProtectedValue('RECOVERY2', protectedValue, appSecret),
    ).toBe(false);
    expect(
      verifyKeyedProtectedValue(
        'RECOVERY1',
        protectedValue,
        'different-application-secret',
      ),
    ).toBe(false);
  });

  it('wraps legacy SHA-256 values without recovering their plaintext', () => {
    const appSecret = 'application-secret-for-keyed-hash-tests';
    const legacyHash = hashProtectedValue('RECOVERY1');
    const wrapped = wrapHashedProtectedValue(legacyHash, appSecret);

    expect(isKeyedHashedProtectedValue(wrapped)).toBe(true);
    expect(verifyKeyedProtectedValue('RECOVERY1', wrapped, appSecret)).toBe(
      true,
    );
    expect(verifyKeyedProtectedValue('RECOVERY2', wrapped, appSecret)).toBe(
      false,
    );
  });

  it('compares strings in constant-time shape and handles length mismatch', () => {
    expect(safeStringEqual('abc', 'abc')).toBe(true);
    expect(safeStringEqual('abc', 'abcd')).toBe(false);
    expect(safeStringEqual('abc', 'abd')).toBe(false);
  });

  it('encrypts and decrypts protected values', () => {
    const secret = 'very-long-secret-value-for-tests';
    const payload = 'totp-base32-secret';

    const encrypted = encryptProtectedValue(payload, secret);
    const decrypted = decryptProtectedValue(encrypted, secret);

    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decrypted).toBe(payload);
    expect(isEncryptedProtectedValue(encrypted)).toBe(true);
    expect(isEncryptedProtectedValue(payload)).toBe(false);
  });

  it('returns plaintext as-is for backward compatibility', () => {
    const plain = 'legacy-plaintext-value';
    const secret = 'another-secret';

    expect(decryptProtectedValue(plain, secret)).toBe(plain);
  });
});
