import { describe, expect, it } from 'vitest';
import { normalizeFileUrl } from './media-utils';

describe('normalizeFileUrl', () => {
  it('rewrites legacy file URLs through the API prefix', () => {
    expect(normalizeFileUrl('/files/file-id/example.png')).toBe(
      '/api/files/file-id/example.png',
    );
  });

  it('keeps non-file URLs unchanged', () => {
    expect(normalizeFileUrl('/api/files/file-id/example.png')).toBe(
      '/api/files/file-id/example.png',
    );
    expect(normalizeFileUrl('https://example.com/file.png')).toBe(
      'https://example.com/file.png',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeFileUrl('')).toBe('');
  });
});
