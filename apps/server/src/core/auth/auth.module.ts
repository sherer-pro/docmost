import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SignupService } from './services/signup.service';
import { TokenModule } from './token.module';
import { AuthRateLimitService } from './rate-limit/auth-rate-limit.service';
import { AuthRateLimitGuard } from './rate-limit/auth-rate-limit.guard';
import { AuthRateLimitTelemetry } from './rate-limit/auth-rate-limit.telemetry';
import { MfaModule } from '../mfa/mfa.module';

@Module({
  imports: [TokenModule, WorkspaceModule, MfaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SignupService,
    JwtStrategy,
    AuthRateLimitService,
    AuthRateLimitGuard,
    AuthRateLimitTelemetry,
  ],
  exports: [SignupService],
})
export class AuthModule {}
