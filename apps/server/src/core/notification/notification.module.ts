import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationProcessor } from './notification.processor';
import { CommentNotificationService } from './services/comment.notification';
import { PageNotificationService } from './services/page.notification';
import { RecipientResolverService } from './services/recipient-resolver.service';
import { PushAggregationService } from './services/push-aggregation.service';
import { PushAggregationBootstrapService } from './services/push-aggregation-bootstrap.service';
import { NotificationDeliveryPolicyService } from './services/notification-delivery-policy.service';
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
    PushAggregationService,
    PushAggregationBootstrapService,
    NotificationDeliveryPolicyService,
  ],
  exports: [
    NotificationService,
    RecipientResolverService,
    PushAggregationService,
    NotificationDeliveryPolicyService,
  ],
})
export class NotificationModule {}
