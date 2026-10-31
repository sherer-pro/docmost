jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Reflector } from '@nestjs/core';
import { TransformHttpResponseInterceptor } from '../../../common/interceptors/http-response.interceptor';
import { API_PREFIX_EXCLUDES } from '../../../common/config/api-prefix-excludes';
import { McpOAuthPublicController } from './mcp-oauth.controller';
import { McpOAuthMetadataController } from './mcp-oauth-metadata.controller';
import { McpOAuthRateLimitGuard } from './mcp-oauth-rate-limit.guard';
import { McpOAuthService } from './mcp-oauth.service';

describe('MCP OAuth raw HTTP contracts', () => {
  let app: NestFastifyApplication;
  const oauth = {
    begin: jest.fn(async () => 'https://docs.example.test/mcp/authorize?request=synthetic'),
    urls: () => ({ issuer: 'https://docs.example.test', resource: 'https://docs.example.test/mcp' }),
    register: jest.fn(async () => ({ client_id: 'registered-client', token_endpoint_auth_method: 'none' })),
    token: jest.fn(async () => ({ access_token: 'synthetic-placeholder', token_type: 'Bearer', expires_in: 900 })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [McpOAuthPublicController, McpOAuthMetadataController], providers: [Reflector, { provide: McpOAuthService, useValue: oauth }] }).overrideGuard(McpOAuthRateLimitGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api', { exclude: API_PREFIX_EXCLUDES });
    app.useGlobalInterceptors(new TransformHttpResponseInterceptor(module.get(Reflector)));
    app.getHttpAdapter().getInstance().addHook('onRequest', async (request: any) => { request.raw.workspace = { id: 'workspace-1' }; });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app.close(); });

  it('serves discovery at the root as protocol JSON without the application envelope', async () => {
    const resource = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
    expect(resource.statusCode).toBe(200);
    expect(resource.json()).toMatchObject({ resource: 'https://docs.example.test/mcp', authorization_servers: ['https://docs.example.test'] });
    expect(resource.json()).not.toHaveProperty('data');
    const metadata = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(metadata.json()).toMatchObject({ token_endpoint: 'https://docs.example.test/api/mcp-oauth/token', code_challenge_methods_supported: ['S256'] });
  });

  it('returns raw registration and non-cacheable token responses under the API prefix', async () => {
    const registration = await app.inject({ method: 'POST', url: '/api/mcp-oauth/clients', payload: { client_name: 'Test' } });
    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toEqual({ client_id: 'registered-client', token_endpoint_auth_method: 'none' });
    const token = await app.inject({ method: 'POST', url: '/api/mcp-oauth/token', payload: { grant_type: 'authorization_code' } });
    expect(token.statusCode).toBe(200);
    expect(token.headers['cache-control']).toBe('no-store');
    expect(token.json()).toEqual({ access_token: 'synthetic-placeholder', token_type: 'Bearer', expires_in: 900 });
  });

  it('redirects a valid authorization request with an explicit 302 status', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/mcp-oauth/authorize' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://docs.example.test/mcp/authorize?request=synthetic');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});
