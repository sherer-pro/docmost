import { FastifyRequest } from 'fastify';

export const ATTACHMENT_TOKEN_COOKIE_PREFIX = 'attachmentToken_';
export const LEGACY_ATTACHMENT_TOKEN_COOKIE = 'attachmentToken';

export type AttachmentAccessTokenSource =
  | 'x-attachment-token'
  | 'authorization'
  | 'page-cookie'
  | 'legacy-cookie'
  | 'query';

export interface AttachmentAccessTokenResolution {
  token?: string;
  source?: AttachmentAccessTokenSource;
}

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
export function resolveAttachmentAccessTokenDetails(
  req: FastifyRequest,
  pageId: string,
  jwtToken?: string,
): AttachmentAccessTokenResolution {
  const headerToken = req.headers['x-attachment-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return { token: headerToken.trim(), source: 'x-attachment-token' };
  }

  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice('Bearer '.length).trim();
    if (bearerToken) {
      return { token: bearerToken, source: 'authorization' };
    }
  }

  const cookies = ((req as any).cookies || {}) as Record<string, string>;
  const pageCookieToken = cookies[getAttachmentTokenCookieName(pageId)];
  if (pageCookieToken) {
    return { token: pageCookieToken, source: 'page-cookie' };
  }

  const legacyCookieToken = cookies[LEGACY_ATTACHMENT_TOKEN_COOKIE];
  if (legacyCookieToken) {
    return { token: legacyCookieToken, source: 'legacy-cookie' };
  }

  if (jwtToken?.trim()) {
    return { token: jwtToken.trim(), source: 'query' };
  }

  return {};
}

export function resolveAttachmentAccessToken(
  req: FastifyRequest,
  pageId: string,
  jwtToken?: string,
): string | undefined {
  return resolveAttachmentAccessTokenDetails(req, pageId, jwtToken).token;
}
