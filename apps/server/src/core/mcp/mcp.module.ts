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

@Module({
  imports: [AiModule, ApiKeyTrafficModule],
  controllers: [McpController, McpOAuthMetadataController, McpOAuthPublicController, McpOAuthAccountController],
  providers: [McpApiKeyAuthGuard, McpOAuthService, McpOAuthRateLimitGuard],
})
export class McpModule {}
