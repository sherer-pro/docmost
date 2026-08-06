import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagContentExportService } from './rag-content-export.service';
import { ExportModule } from '../../integrations/export/export.module';
import { StorageModule } from '../../integrations/storage/storage.module';
import { AiContentPolicyModule } from '../ai-content-policy/ai-content-policy.module';
import { ApiKeyTrafficModule } from '../api-key/traffic/api-key-traffic.module';

@Module({
  imports: [
    ExportModule,
    StorageModule,
    AiContentPolicyModule,
    ApiKeyTrafficModule,
  ],
  controllers: [RagController],
  providers: [RagContentExportService, RagService],
  exports: [RagContentExportService, RagService],
})
export class RagModule {}
