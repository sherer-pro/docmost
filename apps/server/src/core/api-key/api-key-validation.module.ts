import { Module } from '@nestjs/common';
import { ApiKeyValidationService } from './api-key-validation.service';
import { ApiKeyPersistenceModule } from '../../database/persistence/api-key-persistence.module';

@Module({
  imports: [ApiKeyPersistenceModule],
  providers: [ApiKeyValidationService],
  exports: [ApiKeyValidationService],
})
export class ApiKeyValidationModule {}
