import { Module } from '@nestjs/common';
import { ApiKeyRepo } from '../repos/api-key/api-key.repo';

@Module({
  providers: [ApiKeyRepo],
  exports: [ApiKeyRepo],
})
export class ApiKeyPersistenceModule {}
