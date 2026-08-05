import { describe, expect, it } from 'vitest';
import { buildAttachmentFileUrl, normalizeFileUrl } from './media-utils';
import { isInternalFileUrl } from './utils';

describe('buildAttachmentFileUrl', () => {
  it('builds the canonical attachment route', () => {
    expect(buildAttachmentFileUrl('file-id', 'example.png')).toBe(
      '/api/attachments/files/file-id/example.png',
    );
  });
});

describe('normalizeFileUrl', () => {
  it('rewrites legacy private file URLs to the canonical route', () => {
    expect(normalizeFileUrl('/files/file-id/example.png')).toBe(
      '/api/attachments/files/file-id/example.png',
    );
    expect(normalizeFileUrl('/api/files/file-id/example.png')).toBe(
      '/api/attachments/files/file-id/example.png',
    );
  });

  it('rewrites legacy public file URLs to the canonical route', () => {
    expect(normalizeFileUrl('/files/public/file-id/example.png')).toBe(
      '/api/attachments/files/public/file-id/example.png',
    );
    expect(normalizeFileUrl('/api/files/public/file-id/example.png')).toBe(
      '/api/attachments/files/public/file-id/example.png',
    );
  });

  it('keeps canonical and external URLs unchanged', () => {
    expect(
      normalizeFileUrl('/api/attachments/files/file-id/example.png'),
    ).toBe('/api/attachments/files/file-id/example.png');
    expect(normalizeFileUrl('https://example.com/file.png')).toBe(
      'https://example.com/file.png',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeFileUrl('')).toBe('');
  });
});

describe('isInternalFileUrl', () => {
  it.each([
    '/api/attachments/files/file-id/example.png',
    '/attachments/files/file-id/example.png',
    '/api/files/file-id/example.png',
    '/files/file-id/example.png',
  ])('recognizes %s as an internal file URL', (url) => {
    expect(isInternalFileUrl(url)).toBe(true);
  });
});
