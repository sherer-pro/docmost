import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { ExportModule } from '../../integrations/export/export.module';
import { StorageModule } from '../../integrations/storage/storage.module';
import { AiContentPolicyModule } from '../ai-content-policy/ai-content-policy.module';

@Module({
  imports: [ExportModule, StorageModule, AiContentPolicyModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
