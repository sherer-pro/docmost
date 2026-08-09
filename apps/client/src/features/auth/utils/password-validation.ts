export const MAX_PASSWORD_UTF8_BYTES = 72;

export function isPasswordWithinUtf8Limit(password: string): boolean {
  return new TextEncoder().encode(password).byteLength <= MAX_PASSWORD_UTF8_BYTES;
}
