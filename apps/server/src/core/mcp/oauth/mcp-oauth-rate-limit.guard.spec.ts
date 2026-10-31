import { McpOAuthRateLimitGuard } from './mcp-oauth-rate-limit.guard';

describe('MCP OAuth admission', () => {
  const reply = { header: jest.fn() };
  const context = { switchToHttp: () => ({ getRequest: () => ({ url: '/api/mcp-oauth/clients', raw: { workspaceId: 'workspace', socket: { remoteAddress: '127.0.0.1' } }, headers: {} }), getResponse: () => reply }) };

  it('fails closed when the rate-limit store is unavailable', async () => {
    const guard = new McpOAuthRateLimitGuard({ consume: jest.fn().mockResolvedValue({ storageAvailable: false, allowed: true }) } as any);
    await expect(guard.canActivate(context as any)).rejects.toMatchObject({ status: 503 });
  });
  it('returns a bounded retry header when registration is throttled', async () => {
    const guard = new McpOAuthRateLimitGuard({ consume: jest.fn().mockResolvedValue({ storageAvailable: true, allowed: false, retryAfterMs: 1500 }) } as any);
    await expect(guard.canActivate(context as any)).rejects.toMatchObject({ status: 429 });
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '2');
  });
});
