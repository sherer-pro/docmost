import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function runMcpOAuthAcceptance({
  api,
  fetchApi,
  actors,
  space,
  parent,
  test,
  baseURL,
  sql,
  exactSecrets,
  fixture,
}) {
  const resource = `${baseURL}/mcp`;
  const callback = 'http://127.0.0.1:47777/callback';
  const publicRequest = async (path, body, options = {}) =>
    fetch(`${baseURL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://mcp-client.example.test',
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...options,
    });
  const body = async (response, status) => {
    assert.equal(
      response.status,
      status,
      `OAuth HTTP status at ${new URL(response.url).pathname}`,
    );
    return response.json();
  };
  let client;
  const begin = async (
    actor = actors.editor,
    allow = true,
    selectedSpace = space.id,
  ) => {
    const verifier = randomBytes(48).toString('base64url');
    exactSecrets.add(verifier);
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      resource,
      scope: 'mcp:read',
      state: 'synthetic-state',
    });
    const started = await publicRequest(`/api/mcp-oauth/authorize?${params}`);
    assert.equal(started.status, 302);
    const requestId = new URL(started.headers.get('location')).searchParams.get(
      'request',
    );
    const consent = await api(
      actor,
      `/mcp-oauth/account/consent?requestId=${requestId}`,
    );
    assert.equal(consent.redirectUri, callback);
    const decided = await api(actor, '/mcp-oauth/account/consent', 'POST', {
      requestId,
      allow,
      ...(allow ? { spaceId: selectedSpace } : {}),
    });
    const redirect = new URL(decided.redirectUri);
    assert.equal(redirect.searchParams.get('state'), 'synthetic-state');
    if (!allow) {
      assert.equal(redirect.searchParams.get('error'), 'access_denied');
      return { requestId };
    }
    const code = redirect.searchParams.get('code');
    exactSecrets.add(code);
    return { verifier, code, requestId };
  };
  const exchange = async (authorization, overrides = {}, status = 200) => {
    const result = await body(
      await publicRequest('/api/mcp-oauth/token', {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: callback,
        code: authorization.code,
        code_verifier: authorization.verifier,
        resource,
        ...overrides,
      }),
      status,
    );
    if (result.access_token) {
      exactSecrets.add(result.access_token);
      exactSecrets.add(result.refresh_token);
    }
    return result;
  };
  const rpc = async (token, method, params = {}, id = 1) => {
    const response = await publicRequest(
      '/mcp',
      { jsonrpc: '2.0', method, id, params },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
      },
    );
    if (!response.ok) return { response };
    const text = await response.text();
    const payload = text.startsWith('{')
      ? JSON.parse(text)
      : JSON.parse(
          text
            .split('\n')
            .find((line) => line.startsWith('data: '))
            .slice(6),
        );
    return { response, payload };
  };
  let initial;
  let grantId;
  await test('MCP OAuth discovery, explicit consent and PKCE preserve API key compatibility', async () => {
    assert.equal(
      (await api(actors.admin, '/mcp-oauth/account/settings')).enabled,
      false,
    );
    await body(
      await publicRequest('/api/mcp-oauth/clients', {
        client_name: 'Synthetic MCP client',
        redirect_uris: [callback],
      }),
      403,
    );
    assert.equal(
      (
        await fetchApi(actors.reader, '/mcp-oauth/account/settings', 'PATCH', {
          enabled: true,
        })
      ).status(),
      403,
    );
    await api(actors.admin, '/mcp-oauth/account/settings', 'PATCH', {
      enabled: true,
    });
    const metadata = await body(
      await publicRequest('/.well-known/oauth-protected-resource/mcp'),
      200,
    );
    assert.equal(metadata.resource, resource);
    const server = await body(
      await publicRequest('/.well-known/oauth-authorization-server'),
      200,
    );
    assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
    const denied = await publicRequest('/mcp', {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    });
    assert.equal(denied.status, 401);
    assert(
      denied.headers
        .get('www-authenticate')
        .includes(
          metadata.resource.replace(
            '/mcp',
            '/.well-known/oauth-protected-resource/mcp',
          ),
        ),
    );
    const registration = await publicRequest('/api/mcp-oauth/clients', {
      client_name: 'Synthetic MCP client',
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
    });
    assert.equal(registration.headers.get('access-control-allow-origin'), '*');
    assert.equal(
      registration.headers.get('access-control-allow-credentials'),
      null,
    );
    client = await body(registration, 201);
    const bad = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://attacker.example/callback',
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: 'a'.repeat(43),
      resource,
    });
    assert.equal(
      (await publicRequest(`/api/mcp-oauth/authorize?${bad}`)).status,
      400,
    );
    bad.set('redirect_uri', callback);
    bad.set('code_challenge_method', 'plain');
    assert.equal(
      (await publicRequest(`/api/mcp-oauth/authorize?${bad}`)).status,
      400,
    );
    const authorization = await begin();
    await exchange(authorization, { code_verifier: 'x'.repeat(43) }, 400);
    initial = await exchange(authorization);
    assert.equal(initial.token_type, 'Bearer');
    assert.equal(initial.expires_in, 900);
    const listed = await rpc(initial.access_token, 'tools/list');
    assert.equal(listed.response.status, 200);
    assert(listed.payload.result.tools.some((tool) => tool.name === 'getPage'));
    assert(
      listed.payload.result.tools.every(
        (tool) => tool.annotations.readOnlyHint,
      ),
    );
    const key = await api(actors.admin, '/api-keys/create', 'POST', {
      spaceId: space.id,
      keyType: 'mcp',
      allowedCapabilities: ['page.content.read'],
      name: 'OAuth compatibility',
    });
    const keyToken = key.token;
    assert.equal(typeof keyToken, 'string');
    exactSecrets.add(keyToken);
    assert.equal((await rpc(keyToken, 'tools/list')).response.status, 200);
    await api(actors.admin, '/api-keys/revoke', 'POST', { apiKeyId: key.id });
    const replay = await exchange(authorization, {}, 400);
    assert.equal(replay.error, 'invalid_grant');
    assert.equal(
      (await rpc(initial.access_token, 'tools/list')).response.status,
      401,
    );
  });
  await test('MCP SDK discovers OAuth, registers a public client and completes PKCE without API keys', async () => {
    let information, tokens, verifier, authorizationCode;
    const provider = {
      redirectUrl: callback,
      clientMetadata: { client_name: 'Synthetic SDK MCP', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp:read' },
      state: () => 'sdk-synthetic-state',
      clientInformation: () => information,
      saveClientInformation: (value) => { information = value; },
      tokens: () => tokens,
      saveTokens: (value) => { tokens = value; exactSecrets.add(value.access_token); if (value.refresh_token) exactSecrets.add(value.refresh_token); },
      saveCodeVerifier: (value) => { verifier = value; exactSecrets.add(value); },
      codeVerifier: () => verifier,
      redirectToAuthorization: async (url) => {
        const response = await fetch(url, { redirect: 'manual' });
        assert.equal(response.status, 302);
        const requestId = new URL(response.headers.get('location')).searchParams.get('request');
        const decided = await api(actors.editor, '/mcp-oauth/account/consent', 'POST', { requestId, spaceId: space.id, allow: true });
        const callbackURL = new URL(decided.redirectUri);
        assert.equal(callbackURL.searchParams.get('state'), 'sdk-synthetic-state');
        authorizationCode = callbackURL.searchParams.get('code'); exactSecrets.add(authorizationCode);
      },
    };
    assert.equal(await auth(provider, { serverUrl: resource }), 'REDIRECT');
    assert.equal(await auth(provider, { serverUrl: resource, authorizationCode }), 'AUTHORIZED');
    const sdk = new Client({ name: 'isolated-oauth-audit', version: '1.0.0' });
    try {
      await sdk.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider }));
      assert((await sdk.listTools()).tools.some((tool) => tool.name === 'getPage'));
      const read = await sdk.callTool({ name: 'getPage', arguments: { pageId: parent.id } });
      assert(!read.isError);
    } finally { await sdk.close(); }
    const connection = (await api(actors.editor, '/mcp-oauth/account/connections')).find((item) => item.clientName === 'Synthetic SDK MCP');
    await api(actors.editor, '/mcp-oauth/account/disconnect', 'POST', { id: connection.id });
  });

  await test('MCP OAuth is single-space read-only and rechecks page access and live capabilities', async () => {
    initial = await exchange(await begin());
    const listed = await api(actors.editor, '/mcp-oauth/account/connections');
    grantId = listed.find((item) => !item.revokedAt).id;
    assert.equal(
      (
        await fetchApi(actors.reader, '/mcp-oauth/account/disconnect', 'POST', {
          id: grantId,
        })
      ).status(),
      404,
    );
    const ordinary = await publicRequest('/api/users/me', undefined, {
      headers: { Authorization: `Bearer ${initial.access_token}` },
    });
    assert.equal(ordinary.status, 401);
    assert.equal(
      (
        await publicRequest('/api/rag/scope', undefined, {
          headers: { Authorization: `Bearer ${initial.access_token}` },
        })
      ).status,
      401,
    );
    const read = await rpc(initial.access_token, 'tools/call', {
      name: 'getPage',
      arguments: { pageId: parent.id },
    });
    assert(!read.payload.result.isError);
    const write = await rpc(initial.access_token, 'tools/call', {
      name: 'proposeDatabaseCells',
      arguments: {},
    });
    assert(write.payload.result.isError);
    const hidden = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'OAUTH_PRIVATE_SENTINEL',
    });
    await api(
      actors.admin,
      `/pages/${hidden.id}/actions/access/close-user`,
      'POST',
      { userId: actors.editor.id },
    );
    const privateRead = await rpc(initial.access_token, 'tools/call', {
      name: 'getPage',
      arguments: { pageId: hidden.id },
    });
    assert(privateRead.payload.result.isError);
    assert(
      !JSON.stringify(privateRead.payload).includes('OAUTH_PRIVATE_SENTINEL'),
    );
    const before = await api(actors.admin, '/ai/tool-policy');
    await api(actors.admin, '/ai/tool-policy', 'PATCH', {
      enabled: false,
      allowedCapabilities: before.allowedCapabilities,
    });
    try {
      assert(
        (
          await rpc(initial.access_token, 'tools/call', {
            name: 'getPage',
            arguments: { pageId: parent.id },
          })
        ).payload.result.isError,
      );
    } finally {
      await api(actors.admin, '/ai/tool-policy', 'PATCH', {
        enabled: before.enabled,
        allowedCapabilities: before.allowedCapabilities,
      });
    }
  });
  await test('MCP OAuth refresh rotation, replay and user disconnect revoke the complete grant', async () => {
    const rotated = await body(
      await publicRequest('/api/mcp-oauth/token', {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: initial.refresh_token,
        resource,
      }),
      200,
    );
    exactSecrets.add(rotated.access_token);
    exactSecrets.add(rotated.refresh_token);
    assert.equal(
      (await rpc(rotated.access_token, 'tools/list')).response.status,
      200,
    );
    assert.equal(
      (
        await body(
          await publicRequest('/api/mcp-oauth/token', {
            grant_type: 'refresh_token',
            client_id: client.client_id,
            refresh_token: initial.refresh_token,
            resource,
          }),
          400,
        )
      ).error,
      'invalid_grant',
    );
    assert.equal(
      (await rpc(rotated.access_token, 'tools/list')).response.status,
      401,
    );
    initial = await exchange(await begin());
    const connections = await api(
      actors.editor,
      '/mcp-oauth/account/connections',
    );
    grantId = connections.find((item) => !item.revokedAt).id;
    await api(actors.editor, '/mcp-oauth/account/disconnect', 'POST', {
      id: grantId,
    });
    assert.equal(
      (await rpc(initial.access_token, 'tools/list')).response.status,
      401,
    );
    const denial = await begin(actors.editor, false);
    assert.equal(
      (
        await fetchApi(actors.editor, '/mcp-oauth/account/consent', 'POST', {
          requestId: denial.requestId,
          allow: true,
          spaceId: space.id,
        })
      ).status(),
      400,
    );
  });
  await test('MCP OAuth form-encoded exchange is one-use under concurrent requests', async () => {
    const authorization = await begin();
    const fields = {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: callback,
      code: authorization.code,
      code_verifier: authorization.verifier,
      resource,
    };
    const responses = await Promise.all(
      [0, 1].map(() =>
        fetch(`${baseURL}/api/mcp-oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields),
        }),
      ),
    );
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 400],
    );
    const accepted = await responses
      .find((response) => response.status === 200)
      .json();
    exactSecrets.add(accepted.access_token);
    exactSecrets.add(accepted.refresh_token);
    assert.equal(
      (await rpc(accepted.access_token, 'tools/list')).response.status,
      401,
    );
  });
  await test('MCP OAuth expires and revokes access on session, membership and workspace disable', async () => {
    initial = await exchange(await begin());
    const live =
      await sql`select id, session_id from mcp_oauth_grants where workspace_id=${fixture.workspaceId}::uuid and revoked_at is null`;
    const session = live[0].session_id;
    await sql`update user_sessions set revoked_at=now() where id=${session}::uuid`;
    try {
      assert.equal(
        (await rpc(initial.access_token, 'tools/list')).response.status,
        401,
      );
    } finally {
      await sql`update user_sessions set revoked_at=null where id=${session}::uuid`;
    }
    await sql`update mcp_oauth_tokens set expires_at=now()-interval '1 second' where hash=${createHash('sha256').update(initial.access_token).digest('hex')}`;
    assert.equal(
      (await rpc(initial.access_token, 'tools/list')).response.status,
      401,
    );
    initial = await exchange(await begin());
    await api(actors.admin, '/spaces/members/remove', 'POST', {
      spaceId: space.id,
      userId: actors.editor.id,
    });
    try {
      assert.notEqual(
        (await rpc(initial.access_token, 'tools/list')).response.status,
        200,
      );
    } finally {
      await api(actors.admin, '/spaces/members/add', 'POST', {
        spaceId: space.id,
        userIds: [actors.editor.id],
        groupIds: [],
        role: 'writer',
      });
    }
    await api(actors.admin, '/mcp-oauth/account/settings', 'PATCH', {
      enabled: false,
    });
    assert.notEqual(
      (await rpc(initial.access_token, 'tools/list')).response.status,
      200,
    );
    await api(actors.admin, '/mcp-oauth/account/settings', 'PATCH', {
      enabled: true,
    });
    assert.equal(
      (await rpc(initial.access_token, 'tools/list')).response.status,
      401,
    );
    await api(actors.admin, '/mcp-oauth/account/settings', 'PATCH', {
      enabled: false,
    });
    const stored = await sql`select hash from mcp_oauth_tokens`;
    assert(stored.every((item) => /^[a-f0-9]{64}$/.test(item.hash)));
  });
  await api(actors.admin, '/mcp-oauth/account/settings', 'PATCH', {
    enabled: true,
  });
  const browserRequests = [];
  for (let i = 0; i < 2; i++) {
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256')
        .update(randomBytes(48))
        .digest('base64url'),
      resource,
      scope: 'mcp:read',
    });
    const response = await publicRequest(`/api/mcp-oauth/authorize?${params}`);
    assert.equal(response.status, 302);
    browserRequests.push(
      new URL(response.headers.get('location')).pathname +
        new URL(response.headers.get('location')).search,
    );
  }
  fixture.mcpOAuth = {
    consentRoutes: browserRequests,
    clientName: 'Synthetic MCP client',
    callback,
  };
}
