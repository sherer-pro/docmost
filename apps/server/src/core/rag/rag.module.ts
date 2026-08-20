import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagContentExportService } from './rag-content-export.service';
import { ExportModule } from '../../integrations/export/export.module';
import { StorageModule } from '../../integrations/storage/storage.module';
import { AiContentPolicyModule } from '../ai-content-policy/ai-content-policy.module';
import { ApiKeyTrafficModule } from '../api-key/traffic/api-key-traffic.module';
import { KnowledgeProjectionService } from './knowledge-projection.service';
import { DictionaryModule } from '../dictionary/dictionary.module';

@Module({
  imports: [
    ExportModule,
    StorageModule,
    AiContentPolicyModule,
    ApiKeyTrafficModule,
    DictionaryModule,
  ],
  controllers: [RagController],
  providers: [KnowledgeProjectionService, RagContentExportService, RagService],
  exports: [KnowledgeProjectionService, RagContentExportService, RagService],
})
export class RagModule {}
