import { FastifyRequest } from 'fastify';

export const ATTACHMENT_TOKEN_COOKIE_PREFIX = 'attachmentToken_';
export const LEGACY_ATTACHMENT_TOKEN_COOKIE = 'attachmentToken';

export function getAttachmentTokenCookieName(pageId: string): string {
  return `${ATTACHMENT_TOKEN_COOKIE_PREFIX}${pageId}`;
}

/**
 * Resolves attachment access token from:
 * 1) `x-attachment-token` header;
 * 2) `Authorization: Bearer ...` header;
 * 3) page-scoped cookie (`attachmentToken_<pageId>`);
 * 4) legacy generic cookie (`attachmentToken`);
 * 5) legacy `jwt` query param (last to avoid stale persisted URLs
 *    overriding newer cookie/header tokens).
 */
export function resolveAttachmentAccessToken(
  req: FastifyRequest,
  pageId: string,
  jwtToken?: string,
): string | undefined {
  const headerToken = req.headers['x-attachment-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice('Bearer '.length).trim();
    if (bearerToken) {
      return bearerToken;
    }
  }

  const cookies = ((req as any).cookies || {}) as Record<string, string>;
  const cookieToken =
    cookies[getAttachmentTokenCookieName(pageId)] ||
    cookies[LEGACY_ATTACHMENT_TOKEN_COOKIE];
  if (cookieToken) {
    return cookieToken;
  }

  if (jwtToken?.trim()) {
    return jwtToken.trim();
  }

  return undefined;
}
