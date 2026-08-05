import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { PageModule } from './page/page.module';
import { AttachmentModule } from './attachment/attachment.module';
import { CommentModule } from './comment/comment.module';
import { SearchModule } from './search/search.module';
import { SpaceModule } from './space/space.module';
import { GroupModule } from './group/group.module';
import { CaslModule } from './casl/casl.module';
import { DomainMiddleware } from '../common/middlewares/domain.middleware';
import { ShareModule } from './share/share.module';
import { NotificationModule } from './notification/notification.module';
import { WatcherModule } from './watcher/watcher.module';
import { MfaModule } from './mfa/mfa.module';
import { PushModule } from './push/push.module';
import { DatabaseFeatureModule } from './database/database.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { RagModule } from './rag/rag.module';
import { PageAccessModule } from './page-access/page-access.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { SessionModule } from './session/session.module';
import { FavoriteModule } from './favorite/favorite.module';
import { LabelModule } from './label/label.module';
import { TransclusionModule } from './page/transclusion/transclusion.module';
import { PresenceModule } from './presence/presence.module';
import { AiModule } from './ai/ai.module';
import { McpModule } from './mcp/mcp.module';
import { SsoModule } from './sso/sso.module';
import { SpacePolicyModule } from './space-policy/space-policy.module';

@Module({
  imports: [
    SpacePolicyModule,
    UserModule,
    AuthModule,
    WorkspaceModule,
    PageModule,
    AttachmentModule,
    CommentModule,
    SearchModule,
    SpaceModule,
    GroupModule,
    CaslModule,
    ShareModule,
    NotificationModule,
    WatcherModule,
    MfaModule,
    PushModule,
    DatabaseFeatureModule,
    ApiKeyModule,
    RagModule,
    PageAccessModule,
    DictionaryModule,
    SessionModule,
    FavoriteModule,
    LabelModule,
    TransclusionModule,
    PresenceModule,
    AiModule,
    McpModule,
    SsoModule,
  ],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DomainMiddleware)
      .exclude(
        { path: 'auth/setup', method: RequestMethod.POST },
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
