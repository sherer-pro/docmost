import { isAllowedPdfResourceUrl } from './html-pdf-renderer.service';

describe('isAllowedPdfResourceUrl', () => {
  const appUrl = 'https://docs.example.com';

  it('allows same-origin public attachment resources', () => {
    expect(
      isAllowedPdfResourceUrl(
        'https://docs.example.com/api/files/public/file-id/image.png',
        appUrl,
      ),
    ).toBe(true);

    expect(
      isAllowedPdfResourceUrl(
        'https://docs.example.com/api/attachments/files/public/file-id/image.png',
        appUrl,
      ),
    ).toBe(true);
  });

  it('allows bitmap data resources and about:blank', () => {
    expect(isAllowedPdfResourceUrl('about:blank', appUrl)).toBe(true);
    expect(isAllowedPdfResourceUrl('data:image/png;base64,abc', appUrl)).toBe(
      true,
    );
    expect(isAllowedPdfResourceUrl('data:image/jpeg;base64,abc=', appUrl)).toBe(
      true,
    );
  });

  it('blocks active or markup data resources', () => {
    expect(
      isAllowedPdfResourceUrl(
        'data:image/svg+xml,<svg onload=alert(1)></svg>',
        appUrl,
      ),
    ).toBe(false);
    expect(isAllowedPdfResourceUrl('data:text/html,<script></script>', appUrl)).toBe(
      false,
    );
  });

  it('blocks external and private-network resources', () => {
    expect(
      isAllowedPdfResourceUrl('https://cdn.example.org/image.png', appUrl),
    ).toBe(false);
    expect(
      isAllowedPdfResourceUrl(
        'http://169.254.169.254/latest/meta-data/iam/security-credentials',
        appUrl,
      ),
    ).toBe(false);
  });

  it('blocks same-origin non-attachment resources', () => {
    expect(
      isAllowedPdfResourceUrl('https://docs.example.com/window-config.js', appUrl),
    ).toBe(false);
  });
});
