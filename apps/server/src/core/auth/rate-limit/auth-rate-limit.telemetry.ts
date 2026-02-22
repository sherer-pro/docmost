import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthRateLimitExceededEvent } from './auth-rate-limit.service';

export type AuthRateLimitAlertHook = (
  event: AuthRateLimitExceededEvent,
) => Promise<void> | void;

/**
 * Обработчик telemetry-событий лимитирования.
 *
 * Позволяет подключать alert hooks программно (например, отправка в Slack/SIEM)
 * без изменения guard/service.
 */
@Injectable()
export class AuthRateLimitTelemetry {
  private readonly logger = new Logger(AuthRateLimitTelemetry.name);

  private readonly alertHooks = new Set<AuthRateLimitAlertHook>();

  registerAlertHook(hook: AuthRateLimitAlertHook) {
    this.alertHooks.add(hook);
  }

  @OnEvent('auth.rate_limit.exceeded')
  async onAuthRateLimitExceeded(event: AuthRateLimitExceededEvent) {
    this.logger.warn(
      `Telemetry auth.rate_limit.exceeded endpoint=${event.endpoint} scope=${event.scope} retryAfterMs=${event.retryAfterMs}`,
    );

    for (const hook of this.alertHooks) {
      await hook(event);
    }
  }
}
