import { SetMetadata } from '@nestjs/common';
import { AuthRateLimitEndpoint } from './auth-rate-limit.config';

export const AUTH_RATE_LIMIT_METADATA = 'auth-rate-limit';

/**
 * Metadata для подключения rate-limit guard к конкретному auth endpoint.
 */
export interface AuthRateLimitMetadata {
  endpoint: AuthRateLimitEndpoint;
  /**
   * Название поля из body, которое будет использовано как account identifier.
   * Пример: email, token, username.
   */
  accountField: string;
}

/**
 * Декоратор задаёт правила endpoint-specific лимитирования.
 */
export const AuthRateLimit = (metadata: AuthRateLimitMetadata) =>
  SetMetadata(AUTH_RATE_LIMIT_METADATA, metadata);
