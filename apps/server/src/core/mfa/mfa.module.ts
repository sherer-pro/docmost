import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { TokenModule } from '../auth/token.module';
import { AuthRateLimitModule } from '../auth/rate-limit/auth-rate-limit.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TokenModule, AuthRateLimitModule, SessionModule],
  controllers: [MfaController],
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
