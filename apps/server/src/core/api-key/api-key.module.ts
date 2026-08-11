import { Module } from '@nestjs/common';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { TokenModule } from '../auth/token.module';
import { AiModule } from '../ai/ai.module';
import { ApiKeyValidationModule } from './api-key-validation.module';
import { ApiKeyPersistenceModule } from '../../database/persistence/api-key-persistence.module';

@Module({
  imports: [
    TokenModule,
    AiModule,
    ApiKeyValidationModule,
    ApiKeyPersistenceModule,
  ],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
