import { Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { TokenModule } from '../core/auth/token.module';
import { PresenceModule } from '../core/presence/presence.module';
import { CollabPageUpdateSubscriberService } from './collab-page-update-subscriber.service';

@Module({
  imports: [TokenModule, PresenceModule],
  providers: [WsGateway, CollabPageUpdateSubscriberService],
  exports: [WsGateway],
})
export class WsModule {}
