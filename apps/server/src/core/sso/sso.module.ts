import { Module } from '@nestjs/common';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { AuthModule } from '../auth/auth.module';
import { MfaModule } from '../mfa/mfa.module';
import { AuthRateLimitModule } from '../auth/rate-limit/auth-rate-limit.module';
import { EnvironmentModule } from '../../integrations/environment/environment.module';
import { TokenModule } from '../auth/token.module';

@Module({
  imports: [
    AuthModule,
    MfaModule,
    AuthRateLimitModule,
    EnvironmentModule,
    TokenModule,
  ],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
