import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { TokenModule } from '../auth/token.module';
import { UserRepo } from '@docmost/db/repos/user/user.repo';

@Module({
  imports: [TokenModule],
  controllers: [MfaController],
  providers: [MfaService, UserRepo],
  exports: [MfaService],
})
export class MfaModule {}
