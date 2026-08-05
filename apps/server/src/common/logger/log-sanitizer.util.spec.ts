import { sanitizeUrlForLogging } from './log-sanitizer.util';

describe('sanitizeUrlForLogging', () => {
  it('removes query values while retaining parameter names', () => {
    const sanitized = sanitizeUrlForLogging(
      '/api/files/public/file/name?jwt=secret-token&download=true&jwt=other',
    );

    expect(sanitized).toBe('/api/files/public/file/name?jwt&download');
    expect(sanitized).not.toContain('secret-token');
    expect(sanitized).not.toContain('other');
  });

  it('removes origins, credentials, and fragments from absolute URLs', () => {
    expect(
      sanitizeUrlForLogging(
        'https://user:password@example.com/private/path?token=value#fragment',
      ),
    ).toBe('/private/path?token');
  });

  it('handles non-string and malformed values without exposing query data', () => {
    expect(sanitizeUrlForLogging(undefined)).toBeUndefined();
    expect(sanitizeUrlForLogging('/path?token=%')).toBe('/path?token');
  });
});
