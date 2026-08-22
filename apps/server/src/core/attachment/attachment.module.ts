import { Module } from '@nestjs/common';
import { AttachmentService } from './services/attachment.service';
import { AttachmentController } from './attachment.controller';
import { LegacyFilesController } from './legacy-files.controller';
import { StorageModule } from '../../integrations/storage/storage.module';
import { UserModule } from '../user/user.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AttachmentProcessor } from './processors/attachment.processor';
import { TokenModule } from '../auth/token.module';
import { AttachmentFileAccessService } from './services/attachment-file-access.service';
import { AttachmentContentService } from './services/attachment-content.service';
import { ShareModule } from '../share/share.module';
import { AttachmentCleanupService } from './services/attachment-cleanup.service';
import { ATTACHMENT_CLEANUP_HANDLER } from '../../integrations/queue/outbox/queue-outbox.types';

@Module({
  imports: [
    StorageModule,
    UserModule,
    WorkspaceModule,
    TokenModule,
    ShareModule,
  ],
  controllers: [AttachmentController, LegacyFilesController],
  providers: [
    AttachmentService,
    AttachmentContentService,
    AttachmentProcessor,
    AttachmentFileAccessService,
    AttachmentCleanupService,
    {
      provide: ATTACHMENT_CLEANUP_HANDLER,
      useExisting: AttachmentCleanupService,
    },
  ],
  exports: [ATTACHMENT_CLEANUP_HANDLER],
})
export class AttachmentModule {}
