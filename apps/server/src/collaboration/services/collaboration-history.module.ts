import { Module } from '@nestjs/common';
import { CollabHistoryService } from './collab-history.service';

@Module({
  providers: [CollabHistoryService],
  exports: [CollabHistoryService],
})
export class CollaborationHistoryModule {}
