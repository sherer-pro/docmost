import { Controller, Get, Req } from '@nestjs/common';
import { McpOAuthService } from './mcp-oauth.service';
import { hostWorkspace } from './mcp-oauth-request';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';

@Controller('.well-known')
export class McpOAuthMetadataController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Get('oauth-protected-resource/mcp')
  @SkipTransform()
  resource(@Req() request: any) {
    const urls = this.oauth.urls(hostWorkspace(request));
    return {
      resource: urls.resource,
      authorization_servers: [urls.issuer],
      scopes_supported: ['mcp:read'],
      bearer_methods_supported: ['header'],
      resource_name: 'Docmost read-only MCP',
    };
  }

  @Get('oauth-authorization-server')
  @SkipTransform()
  authorizationServer(@Req() request: any) {
    const { issuer } = this.oauth.urls(hostWorkspace(request));
    return {
      issuer,
      authorization_endpoint: `${issuer}/api/mcp-oauth/authorize`,
      token_endpoint: `${issuer}/api/mcp-oauth/token`,
      registration_endpoint: `${issuer}/api/mcp-oauth/clients`,
      revocation_endpoint: `${issuer}/api/mcp-oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:read'],
      client_id_metadata_document_supported: false,
    };
  }
}
