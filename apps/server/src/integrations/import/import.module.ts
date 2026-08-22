import { Module } from '@nestjs/common';
import { ImportService } from './services/import.service';
import { ImportController } from './import.controller';
import { StorageModule } from '../storage/storage.module';
import { FileImportTaskService } from './services/file-import-task.service';
import { FileTaskProcessor } from './processors/file-task.processor';
import { ImportAttachmentService } from './services/import-attachment.service';
import { FileTaskController } from './file-task.controller';
import { PageModule } from '../../core/page/page.module';
import { FileTaskQueryService } from './services/file-task-query.service';
import { DocmostArchiveImportService } from './services/docmost-archive-import.service';
import { TransclusionModule } from '../../core/page/transclusion/transclusion.module';
import { FILE_IMPORT_OUTBOX_HANDLER } from '../queue/outbox/queue-outbox.types';

@Module({
  providers: [
    ImportService,
    FileImportTaskService,
    FileTaskProcessor,
    ImportAttachmentService,
    FileTaskQueryService,
    DocmostArchiveImportService,
    {
      provide: FILE_IMPORT_OUTBOX_HANDLER,
      useExisting: FileImportTaskService,
    },
  ],
  exports: [
    ImportService,
    ImportAttachmentService,
    FILE_IMPORT_OUTBOX_HANDLER,
  ],
  controllers: [ImportController, FileTaskController],
  imports: [StorageModule, PageModule, TransclusionModule],
})
export class ImportModule {}
