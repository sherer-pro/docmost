import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const HASH_PREFIX = 'sha256:';
const ENCRYPTION_PREFIX = 'enc:v1';

/**
 * Hashes a token/value with SHA-256 and a stable prefix.
 */
export function hashProtectedValue(value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  return `${HASH_PREFIX}${digest}`;
}

/**
 * Returns true when value is in `sha256:<hex>` format.
 */
export function isHashedProtectedValue(value?: string | null): boolean {
  return Boolean(value?.startsWith(HASH_PREFIX));
}

/**
 * Compares two strings in constant time.
 *
 * Returns `false` for unequal lengths.
 */
export function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Verifies input against a stored `sha256:<hex>` value.
 */
export function verifyHashedProtectedValue(
  input: string,
  storedHash: string,
): boolean {
  if (!isHashedProtectedValue(storedHash)) {
    return false;
  }

  const computed = hashProtectedValue(input);
  return safeStringEqual(computed, storedHash);
}

function deriveSymmetricKey(appSecret: string): Buffer {
  return createHash('sha256').update(appSecret, 'utf8').digest();
}

/**
 * Encrypts plain text using AES-256-GCM and app secret derived key.
 */
export function encryptProtectedValue(
  plainText: string,
  appSecret: string,
): string {
  const key = deriveSymmetricKey(appSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts values produced by `encryptProtectedValue`.
 *
 * For backward compatibility, non-encrypted values are returned as-is.
 */
export function decryptProtectedValue(
  value: string,
  appSecret: string,
): string {
  if (!value.startsWith(`${ENCRYPTION_PREFIX}:`)) {
    return value;
  }

  const parts = value.split(':');
  if (parts.length !== 5) {
    throw new Error('Invalid encrypted value format');
  }

  const iv = Buffer.from(parts[2], 'base64');
  const authTag = Buffer.from(parts[3], 'base64');
  const cipherText = Buffer.from(parts[4], 'base64');
  const key = deriveSymmetricKey(appSecret);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(cipherText),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
