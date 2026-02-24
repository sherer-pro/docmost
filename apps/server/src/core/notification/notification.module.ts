import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationProcessor } from './notification.processor';
import { CommentNotificationService } from './services/comment.notification';
import { PageNotificationService } from './services/page.notification';
import { RecipientResolverService } from './services/recipient-resolver.service';
import { WsModule } from '../../ws/ws.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [WsModule, PushModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationProcessor,
    CommentNotificationService,
    PageNotificationService,
    RecipientResolverService,
  ],
  exports: [NotificationService, RecipientResolverService],
})
export class NotificationModule {}
