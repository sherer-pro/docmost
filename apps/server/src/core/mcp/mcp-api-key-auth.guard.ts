import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { McpOAuthService } from './oauth/mcp-oauth.service';
import { isObservable, lastValueFrom } from 'rxjs';

@Injectable()
export class McpApiKeyAuthGuard extends ApiKeyAuthGuard {
  constructor(private readonly oauth: McpOAuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const reply = context.switchToHttp().getResponse();
    try {
      const token = /^Bearer (\S+)$/i.exec(
        String(request.headers?.authorization ?? ''),
      )?.[1];
      if (token?.startsWith('dmoa_')) {
        if (!request.raw?.workspace) throw new UnauthorizedException();
        request.user = await this.oauth.authenticate(
          request.raw.workspace,
          token,
        );
        return true;
      }
      const activation = super.canActivate(context);
      return Boolean(
        await (isObservable(activation)
          ? lastValueFrom(activation)
          : activation),
      );
    } catch (error) {
      try {
        const metadata = this.oauth.urls(request.raw?.workspace).metadata;
        reply.header('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="mcp:read"`);
      } catch {
        // OAuth discovery unavailability must not replace an authentication error.
      }
      throw error;
    }
  }

  handleRequest(err: any, user: any) {
    const authenticated = super.handleRequest(err, user);
    if (authenticated.apiKey?.keyType !== 'mcp') {
      throw new UnauthorizedException('MCP API key auth required');
    }
    return authenticated;
  }
}
