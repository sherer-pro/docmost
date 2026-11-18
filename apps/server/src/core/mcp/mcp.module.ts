import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { McpController } from './mcp.controller';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';
import { ApiKeyTrafficModule } from '../api-key/traffic/api-key-traffic.module';
import { McpOAuthService } from './oauth/mcp-oauth.service';
import { McpOAuthRateLimitGuard } from './oauth/mcp-oauth-rate-limit.guard';
import { McpOAuthPublicController } from './oauth/mcp-oauth.controller';
import { McpOAuthMetadataController } from './oauth/mcp-oauth-metadata.controller';
import { McpOAuthAccountController } from './oauth/mcp-oauth-account.controller';
import { ApiKeyValidationModule } from '../api-key/api-key-validation.module';
import { TokenModule } from '../auth/token.module';
import { PageModule } from '../page/page.module';
import { CommentModule } from '../comment/comment.module';
import { AttachmentModule } from '../attachment/attachment.module';
import { AiContentPolicyModule } from '../ai-content-policy/ai-content-policy.module';
import { CollaborationClientModule } from '../../collaboration/client/collaboration-client.module';
import { McpWriteService } from './mcp-write.service';

@Module({
  imports: [
    AiModule,
    ApiKeyTrafficModule,
    ApiKeyValidationModule,
    TokenModule,
    PageModule,
    CommentModule,
    AttachmentModule,
    AiContentPolicyModule,
    CollaborationClientModule,
  ],
  controllers: [
    McpController,
    McpOAuthMetadataController,
    McpOAuthPublicController,
    McpOAuthAccountController,
  ],
  providers: [
    McpApiKeyAuthGuard,
    McpOAuthService,
    McpOAuthRateLimitGuard,
    McpWriteService,
  ],
})
export class McpModule {}
