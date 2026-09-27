import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { PushEndpointPolicyService } from './push-endpoint-policy.service';
import { PushTransportService } from './push-transport.service';

@Module({
  controllers: [PushController],
  providers: [PushService, PushEndpointPolicyService, PushTransportService],
  exports: [PushService],
})
export class PushModule {}
