import { Module } from '@nestjs/common';
import { WsModule } from '../../ws/ws.module';
import { SearchModule } from '../search/search.module';
import { AiContentPolicyController } from './ai-content-policy.controller';
import { AiContentPolicyService } from './ai-content-policy.service';

@Module({
  imports: [SearchModule, WsModule],
  controllers: [AiContentPolicyController],
  providers: [AiContentPolicyService],
  exports: [AiContentPolicyService],
})
export class AiContentPolicyModule {}
