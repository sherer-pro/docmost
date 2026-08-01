import { UnauthorizedException } from '@nestjs/common';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';

describe('McpApiKeyAuthGuard', () => {
  const guard = new McpApiKeyAuthGuard();

  it('accepts only authenticated MCP API keys', () => {
    const user = {
      authType: 'api_key',
      apiKey: { id: 'key-1', keyType: 'mcp' },
    };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it.each([
    { authType: 'jwt', apiKey: undefined },
    { authType: 'api_key', apiKey: { id: 'key-1', keyType: 'rag' } },
  ])('rejects non-MCP credentials', (user) => {
    expect(() => guard.handleRequest(null, user)).toThrow(
      UnauthorizedException,
    );
  });
});
