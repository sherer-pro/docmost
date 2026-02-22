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
} as const;

export type AuthRateLimitEndpoint = keyof typeof AUTH_RATE_LIMITS;
