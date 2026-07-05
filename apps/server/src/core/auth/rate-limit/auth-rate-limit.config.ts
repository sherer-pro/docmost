/**
 * Rate-limit configuration for authentication endpoints.
 *
 * Values are tuned so that sensitive operations
 * (login/forgot-password) use stricter quotas, while validation
 * operations (verify-token) use softer limits.
 */
export const AUTH_RATE_LIMITS = {
  login: {
    ip: { limit: 10, windowMs: 10 * 60 * 1000 },
    account: { limit: 5, windowMs: 10 * 60 * 1000 },
  },
  forgotPassword: {
    ip: { limit: 5, windowMs: 15 * 60 * 1000 },
    account: { limit: 3, windowMs: 15 * 60 * 1000 },
  },
  passwordReset: {
    ip: { limit: 10, windowMs: 30 * 60 * 1000 },
    account: { limit: 5, windowMs: 30 * 60 * 1000 },
  },
  verifyToken: {
    ip: { limit: 20, windowMs: 10 * 60 * 1000 },
    account: { limit: 10, windowMs: 10 * 60 * 1000 },
  },
  mfa: {
    ip: { limit: 15, windowMs: 10 * 60 * 1000 },
    account: { limit: 8, windowMs: 10 * 60 * 1000 },
  },
  mfaVerify: {
    ip: { limit: 10, windowMs: 10 * 60 * 1000 },
    account: { limit: 5, windowMs: 10 * 60 * 1000 },
  },
  mfaValidateAccess: {
    ip: { limit: 20, windowMs: 10 * 60 * 1000 },
    account: { limit: 10, windowMs: 10 * 60 * 1000 },
  },
  invitationInfo: {
    ip: { limit: 30, windowMs: 10 * 60 * 1000 },
    account: { limit: 10, windowMs: 10 * 60 * 1000 },
  },
  invitationAccept: {
    ip: { limit: 15, windowMs: 30 * 60 * 1000 },
    account: { limit: 5, windowMs: 30 * 60 * 1000 },
  },
  workspaceCheckHostname: {
    ip: { limit: 30, windowMs: 10 * 60 * 1000 },
    account: { limit: 10, windowMs: 10 * 60 * 1000 },
  },
  shareSearch: {
    ip: { limit: 60, windowMs: 60 * 1000 },
    account: { limit: 120, windowMs: 60 * 1000 },
  },
  shareRead: {
    ip: { limit: 120, windowMs: 60 * 1000 },
    account: { limit: 240, windowMs: 60 * 1000 },
  },
  shareTransclusionLookup: {
    ip: { limit: 60, windowMs: 60 * 1000 },
    account: { limit: 120, windowMs: 60 * 1000 },
  },
} as const;

export type AuthRateLimitEndpoint = keyof typeof AUTH_RATE_LIMITS;
