import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SignupService } from './services/signup.service';
import { TokenModule } from './token.module';
import { AuthRateLimitModule } from './rate-limit/auth-rate-limit.module';
import { MfaModule } from '../mfa/mfa.module';

@Module({
  imports: [TokenModule, WorkspaceModule, MfaModule, AuthRateLimitModule],
  controllers: [AuthController],
  providers: [AuthService, SignupService, JwtStrategy],
  exports: [SignupService],
})
export class AuthModule {}
