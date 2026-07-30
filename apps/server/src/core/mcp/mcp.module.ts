import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { McpController } from './mcp.controller';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';

@Module({
  imports: [AiModule],
  controllers: [McpController],
  providers: [McpApiKeyAuthGuard],
})
export class McpModule {}
