import { Module } from '@nestjs/common';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRateLimitTelemetry } from './auth-rate-limit.telemetry';

@Module({
  providers: [AuthRateLimitService, AuthRateLimitGuard, AuthRateLimitTelemetry],
  exports: [AuthRateLimitService, AuthRateLimitGuard, AuthRateLimitTelemetry],
})
export class AuthRateLimitModule {}
