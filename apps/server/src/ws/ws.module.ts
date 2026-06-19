import { Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { TokenModule } from '../core/auth/token.module';
import { PresenceModule } from '../core/presence/presence.module';

@Module({
  imports: [TokenModule, PresenceModule],
  providers: [WsGateway],
  exports: [WsGateway],
})
export class WsModule {}
