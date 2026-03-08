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

@Module({
  controllers: [PageController],
  providers: [
    PageService,
    PageHistoryService,
    PageHistoryRecorderService,
    TrashCleanupService,
  ],
  exports: [PageService, PageHistoryService, PageHistoryRecorderService],
  imports: [StorageModule, CollaborationModule, WatcherModule, NotificationModule],
})
export class PageModule {}
