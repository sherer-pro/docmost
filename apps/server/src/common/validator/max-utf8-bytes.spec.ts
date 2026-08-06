import { maxUtf8Bytes } from './max-utf8-bytes';

describe('maxUtf8Bytes', () => {
  it('enforces the bcrypt limit in bytes rather than characters', () => {
    expect(maxUtf8Bytes('a'.repeat(72), 72)).toBe(true);
    expect(maxUtf8Bytes('a'.repeat(73), 72)).toBe(false);
    expect(maxUtf8Bytes('\u00e9'.repeat(36), 72)).toBe(true);
    expect(maxUtf8Bytes('\u00e9'.repeat(37), 72)).toBe(false);
  });
});
