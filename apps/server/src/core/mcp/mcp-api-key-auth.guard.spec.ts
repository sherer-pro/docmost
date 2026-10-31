import { UnauthorizedException } from '@nestjs/common';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';

describe('McpApiKeyAuthGuard', () => {
  const guard = new McpApiKeyAuthGuard({} as any);

  it('accepts OAuth only through the MCP validator with the host-bound workspace', async () => {
    const actor = { authType: 'mcp_oauth', mcpScope: { id: 'grant-1' } };
    const oauth = {
      authenticate: jest.fn().mockResolvedValue(actor),
      urls: jest.fn(() => ({
        metadata:
          'https://docs.example/.well-known/oauth-protected-resource/mcp',
      })),
    };
    const request = {
      headers: { authorization: 'Bearer dmoa_test' },
      raw: { workspace: { id: 'workspace-1' } },
    };
    const reply = { header: jest.fn() };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => reply,
      }),
    };
    expect(
      await new McpApiKeyAuthGuard(oauth as any).canActivate(context as any),
    ).toBe(true);
    expect(oauth.authenticate).toHaveBeenCalledWith(
      request.raw.workspace,
      'dmoa_test',
    );
    expect((request as any).user).toBe(actor);
  });

  it('advertises the protected resource on rejected OAuth credentials', async () => {
    const oauth = {
      authenticate: jest.fn().mockRejectedValue(new UnauthorizedException()),
      urls: jest.fn(() => ({
        metadata:
          'https://docs.example/.well-known/oauth-protected-resource/mcp',
      })),
    };
    const reply = { header: jest.fn() };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer dmoa_bad' },
          raw: { workspace: { id: 'w' } },
        }),
        getResponse: () => reply,
      }),
    };
    await expect(
      new McpApiKeyAuthGuard(oauth as any).canActivate(context as any),
    ).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('resource_metadata='),
    );
  });

  it('preserves the authentication error when secure OAuth discovery is unavailable', async () => {
    const oauth = { authenticate: jest.fn().mockRejectedValue(new UnauthorizedException()), urls: jest.fn(() => { throw new Error('OAuth requires HTTPS'); }) };
    const reply = { header: jest.fn() };
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer dmoa_bad' }, raw: { workspace: { id: 'w' } } }), getResponse: () => reply }) };
    await expect(new McpApiKeyAuthGuard(oauth as any).canActivate(context as any)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).not.toHaveBeenCalled();
  });

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
