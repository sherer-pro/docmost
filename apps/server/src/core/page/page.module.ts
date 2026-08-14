import { Module } from '@nestjs/common';
import { PageService } from './services/page.service';
import { PageController } from './page.controller';
import { PageHistoryService } from './services/page-history.service';
import { TrashCleanupService } from './services/trash-cleanup.service';
import { PageHistoryRecorderService } from './services/page-history-recorder.service';
import { StorageModule } from '../../integrations/storage/storage.module';
import { CollaborationClientModule } from '../../collaboration/client/collaboration-client.module';
import { CollaborationHistoryModule } from '../../collaboration/services/collaboration-history.module';
import { WatcherModule } from '../watcher/watcher.module';
import { NotificationModule } from '../notification/notification.module';
import { LabelModule } from '../label/label.module';
import { BacklinkService } from './services/backlink.service';
import { TransclusionModule } from './transclusion/transclusion.module';
import { LinkPreviewService } from './services/link-preview.service';
import { PageTemplateController } from './page-template.controller';
import { PageTemplateService } from './services/page-template.service';
import { PageAccessModule } from '../page-access/page-access.module';
import { PageAccessMutationService } from './services/page-access-mutation.service';
import { PAGE_TEMPLATE_SYNC_HANDLER } from '../../integrations/queue/outbox/queue-outbox.types';
import { PageTemplateRuntimeService } from './services/page-template-runtime.service';
import { PageTemplateContentService } from './services/page-template-content.service';
import { PageTemplateOperationService } from './services/page-template-operation.service';
import { PageTemplatePublicationService } from './services/page-template-publication.service';
import { PageTemplateInstanceService } from './services/page-template-instance.service';
import { PageTemplateSyncService } from './services/page-template-sync.service';
import { PageEmbedCommandService } from './services/page-embed-command.service';
import { LegacyPageEmbedMigrationService } from './services/legacy-page-embed-migration.service';

@Module({
  controllers: [PageController, PageTemplateController],
  providers: [
    PageService,
    PageHistoryService,
    PageHistoryRecorderService,
    PageAccessMutationService,
    TrashCleanupService,
    BacklinkService,
    LinkPreviewService,
    PageTemplateContentService,
    PageTemplateOperationService,
    PageTemplatePublicationService,
    PageTemplateInstanceService,
    PageTemplateSyncService,
    PageEmbedCommandService,
    LegacyPageEmbedMigrationService,
    PageTemplateService,
    PageTemplateRuntimeService,
    {
      provide: PAGE_TEMPLATE_SYNC_HANDLER,
      useExisting: PageTemplateRuntimeService,
    },
  ],
  exports: [
    PageService,
    PageHistoryService,
    PageHistoryRecorderService,
    PAGE_TEMPLATE_SYNC_HANDLER,
  ],
  imports: [
    StorageModule,
    CollaborationClientModule,
    CollaborationHistoryModule,
    WatcherModule,
    NotificationModule,
    LabelModule,
    TransclusionModule,
    PageAccessModule,
  ],
})
export class PageModule {}
