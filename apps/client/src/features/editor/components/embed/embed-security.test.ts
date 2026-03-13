import { describe, expect, it, vi } from 'vitest';
import { sanitizeEmbedUrl } from './embed-url-sanitizer';

describe('sanitizeUrl security regression', () => {
  it.each([
    'javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<svg onload=alert(1)>',
  ])('rejects unsafe URL scheme: %s', (unsafeUrl) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(sanitizeEmbedUrl(unsafeUrl)).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      '[security][embed-url-rejected]',
      expect.any(Object),
    );

    warnSpy.mockRestore();
  });

  it('allows safe https URLs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const safeUrl = 'https://example.org/embed/widget';

    expect(sanitizeEmbedUrl(safeUrl)).toBe(safeUrl);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
