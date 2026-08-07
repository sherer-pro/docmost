import { Module } from '@nestjs/common';
import { PageService } from './services/page.service';
import { PageController } from './page.controller';
import { PageHistoryService } from './services/page-history.service';
import { TrashCleanupService } from './services/trash-cleanup.service';
import { PageHistoryRecorderService } from './services/page-history-recorder.service';
import { StorageModule } from '../../integrations/storage/storage.module';
import { CollaborationModule } from '../../collaboration/collaboration.module';
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
    PageTemplateService,
    {
      provide: PAGE_TEMPLATE_SYNC_HANDLER,
      useExisting: PageTemplateService,
    },
  ],
  exports: [PageService, PageHistoryService, PageHistoryRecorderService],
  imports: [
    StorageModule,
    CollaborationModule,
    WatcherModule,
    NotificationModule,
    LabelModule,
    TransclusionModule,
    PageAccessModule,
  ],
})
export class PageModule {}
