import {
  decryptProtectedValue,
  encryptProtectedValue,
  hashProtectedValue,
  isHashedProtectedValue,
  safeStringEqual,
  verifyHashedProtectedValue,
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
  });

  it('returns plaintext as-is for backward compatibility', () => {
    const plain = 'legacy-plaintext-value';
    const secret = 'another-secret';

    expect(decryptProtectedValue(plain, secret)).toBe(plain);
  });
});
