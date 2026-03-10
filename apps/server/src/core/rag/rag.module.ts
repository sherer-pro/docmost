import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { ExportModule } from '../../integrations/export/export.module';
import { StorageModule } from '../../integrations/storage/storage.module';

@Module({
  imports: [ExportModule, StorageModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
