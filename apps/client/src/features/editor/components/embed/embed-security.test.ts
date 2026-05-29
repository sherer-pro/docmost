import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sanitizeEmbedUrl,
  sanitizeEmbedUrlForProvider,
} from './embed-url-sanitizer';
import {
  GENERIC_IFRAME_SANDBOX,
  getEmbedIframeSandbox,
  TRUSTED_EMBED_SANDBOX,
} from './embed-sandbox';

describe('sanitizeUrl security regression', () => {
  const originalEmbedAllowedOrigins = process.env.EMBED_ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalEmbedAllowedOrigins === undefined) {
      delete process.env.EMBED_ALLOWED_ORIGINS;
    } else {
      process.env.EMBED_ALLOWED_ORIGINS = originalEmbedAllowedOrigins;
    }
  });

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

  it('rejects relative same-origin embed URLs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(sanitizeEmbedUrl('/api/files/file-id/file.pdf')).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      '[security][embed-url-rejected]',
      expect.objectContaining({ scheme: 'relative' }),
    );

    warnSpy.mockRestore();
  });

  it('uses a stricter sandbox for generic iframe embeds', () => {
    expect(getEmbedIframeSandbox('iframe')).toBe(GENERIC_IFRAME_SANDBOX);
    expect(getEmbedIframeSandbox('iframe')).not.toContain('allow-same-origin');
    expect(getEmbedIframeSandbox('youtube')).toBe(TRUSTED_EMBED_SANDBOX);
  });

  it('rejects generic iframe origins unless deployment allowlists them', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      sanitizeEmbedUrlForProvider('https://example.org/embed/widget', 'iframe'),
    ).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      '[security][embed-url-rejected]',
      expect.objectContaining({
        scheme: 'origin-not-allowed',
        origin: 'https://example.org',
      }),
    );

    warnSpy.mockRestore();
  });

  it('allows configured generic iframe origins', () => {
    process.env.EMBED_ALLOWED_ORIGINS = 'https://example.org';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const safeUrl = 'https://example.org/embed/widget';

    expect(sanitizeEmbedUrlForProvider(safeUrl, 'iframe')).toBe(safeUrl);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('allows known provider frame origins from the shared policy', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const safeUrl = 'https://www.youtube-nocookie.com/embed/video-id';
    const wildcardSafeUrl = 'https://workspace.typeform.com/to/form-id';

    expect(sanitizeEmbedUrlForProvider(safeUrl, 'youtube')).toBe(safeUrl);
    expect(sanitizeEmbedUrlForProvider(wildcardSafeUrl, 'typeform')).toBe(
      wildcardSafeUrl,
    );
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
