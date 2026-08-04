import { Module } from '@nestjs/common';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { TokenModule } from '../auth/token.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TokenModule, AiModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
