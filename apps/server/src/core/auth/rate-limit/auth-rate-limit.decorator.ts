import { SetMetadata } from '@nestjs/common';
import { AuthRateLimitEndpoint } from './auth-rate-limit.config';

export const AUTH_RATE_LIMIT_METADATA = 'auth-rate-limit';

/**
 * Metadata for attaching the rate-limit guard to a specific auth endpoint.
 */
export interface AuthRateLimitMetadata {
  endpoint: AuthRateLimitEndpoint;
  /**
   * Name of the body field that will be used as the account identifier.
   * Example: email, token, username.
   */
  accountField: string;
}

/**
 * Decorator defines endpoint-specific rate-limiting rules.
 */
export const AuthRateLimit = (metadata: AuthRateLimitMetadata) =>
  SetMetadata(AUTH_RATE_LIMIT_METADATA, metadata);
