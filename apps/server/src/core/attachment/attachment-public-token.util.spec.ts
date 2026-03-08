import {
  getAttachmentTokenCookieName,
  LEGACY_ATTACHMENT_TOKEN_COOKIE,
  resolveAttachmentAccessToken,
} from './attachment-public-token.util';

describe('attachment-public-token.util', () => {
  const pageId = 'page-1';

  it('builds page-scoped cookie name', () => {
    expect(getAttachmentTokenCookieName(pageId)).toBe('attachmentToken_page-1');
  });

  it('prefers cookie/header over legacy jwt query token', () => {
    const req = {
      headers: {},
      cookies: {
        [getAttachmentTokenCookieName(pageId)]: 'cookie-token',
      },
    } as any;

    expect(resolveAttachmentAccessToken(req, pageId, 'query-token')).toBe(
      'cookie-token',
    );
  });

  it('falls back to page cookie and then legacy cookie', () => {
    const req = {
      headers: {},
      cookies: {
        [getAttachmentTokenCookieName(pageId)]: 'page-cookie-token',
        [LEGACY_ATTACHMENT_TOKEN_COOKIE]: 'legacy-cookie-token',
      },
    } as any;

    expect(resolveAttachmentAccessToken(req, pageId)).toBe('page-cookie-token');

    const reqWithLegacyOnly = {
      headers: {},
      cookies: {
        [LEGACY_ATTACHMENT_TOKEN_COOKIE]: 'legacy-cookie-token',
      },
    } as any;

    expect(resolveAttachmentAccessToken(reqWithLegacyOnly, pageId)).toBe(
      'legacy-cookie-token',
    );
  });

  it('accepts bearer and x-attachment-token headers', () => {
    const reqWithHeader = {
      headers: {
        'x-attachment-token': 'header-token',
      },
      cookies: {},
    } as any;
    expect(resolveAttachmentAccessToken(reqWithHeader, pageId)).toBe(
      'header-token',
    );

    const reqWithBearer = {
      headers: {
        authorization: 'Bearer bearer-token',
      },
      cookies: {},
    } as any;
    expect(resolveAttachmentAccessToken(reqWithBearer, pageId)).toBe(
      'bearer-token',
    );
  });

  it('uses legacy query jwt token when no header/cookie token exists', () => {
    const req = {
      headers: {},
      cookies: {},
    } as any;

    expect(resolveAttachmentAccessToken(req, pageId, 'query-token')).toBe(
      'query-token',
    );
  });
});
