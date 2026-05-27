import { Global, Module } from '@nestjs/common';
import { TokenModule } from '../auth/token.module';
import { SessionActivityService } from './session-activity.service';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [TokenModule],
  controllers: [SessionController],
  providers: [SessionService, SessionActivityService],
  exports: [SessionService, SessionActivityService],
})
export class SessionModule {}
