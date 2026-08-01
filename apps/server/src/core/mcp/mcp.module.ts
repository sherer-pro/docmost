import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { McpController } from './mcp.controller';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';
import { ApiKeyTrafficModule } from '../api-key/traffic/api-key-traffic.module';

@Module({
  imports: [AiModule, ApiKeyTrafficModule],
  controllers: [McpController],
  providers: [McpApiKeyAuthGuard],
})
export class McpModule {}
