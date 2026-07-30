import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';

@Injectable()
export class McpApiKeyAuthGuard extends ApiKeyAuthGuard {
  handleRequest(err: any, user: any) {
    const authenticated = super.handleRequest(err, user);
    if (authenticated.apiKey?.keyType !== 'mcp') {
      throw new UnauthorizedException('MCP API key auth required');
    }
    return authenticated;
  }
}
