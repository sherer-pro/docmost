import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type {
  KyselyDB,
  KyselyTransaction,
} from '@docmost/db/types/kysely.types';
import type { McpOauthGrants } from '@docmost/db/types/mcp-oauth.types';
import type { Json } from '@docmost/db/types/db';
import type {
  User,
  UserSession,
  Workspace,
} from '@docmost/db/types/entity.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { AuthenticationAssuranceService } from '../../space-policy/authentication-assurance.service';
import { AiBuiltinToolPolicyService } from '../../ai/tools/ai-builtin-tool-policy.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { postgresJsonb } from '../../ai/utils/postgres-jsonb.util';
import {
  McpOAuthError,
  oauthHash,
  oauthRedirect,
  oauthSecret,
  oauthString,
  oauthUuid,
  oauthVerifier,
} from './mcp-oauth-validation';

const minute = 60_000;
const day = 24 * 60 * minute;
type Grant = Selectable<McpOauthGrants>;

@Injectable()
export class McpOAuthService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environment: EnvironmentService,
    private readonly users: UserRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly spaces: SpaceRepo,
    private readonly sessions: UserSessionRepo,
    private readonly ability: SpaceAbilityFactory,
    private readonly assurance: AuthenticationAssuranceService,
    private readonly policy: AiBuiltinToolPolicyService,
  ) {}

  urls(workspace?: Workspace) {
    const base = new URL(this.environment.getAppUrl());
    if (this.environment.isCloud()) {
      if (
        !workspace?.hostname ||
        !/^[a-z0-9][a-z0-9-]*$/i.test(workspace.hostname)
      )
        throw new McpOAuthError('invalid_request', 'Workspace not found', 404);
      base.hostname = `${workspace.hostname}.${this.environment.getSubdomainHost()}`;
    }
    if (
      base.protocol !== 'https:' &&
      !(
        base.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      )
    )
      throw new McpOAuthError(
        'temporarily_unavailable',
        'OAuth requires HTTPS',
        503,
      );
    const issuer = base.origin;
    return {
      issuer,
      resource: `${issuer}/mcp`,
      metadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    };
  }

  async settings(workspaceId: string) {
    return {
      enabled:
        (
          await this.db
            .selectFrom('mcpOauthSettings')
            .select('enabled')
            .where('workspaceId', '=', workspaceId)
            .executeTakeFirst()
        )?.enabled ?? false,
    };
  }

  async updateSettings(workspaceId: string, user: User, enabled: unknown) {
    this.assertAdmin(user);
    if (typeof enabled !== 'boolean') throw new McpOAuthError();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('mcpOauthSettings')
        .values({ workspaceId, enabled })
        .onConflict((oc) =>
          oc
            .column('workspaceId')
            .doUpdateSet({ enabled, updatedAt: new Date() }),
        )
        .execute();
      if (!enabled)
        await trx
          .updateTable('mcpOauthGrants')
          .set({ revokedAt: new Date() })
          .where('workspaceId', '=', workspaceId)
          .where('revokedAt', 'is', null)
          .execute();
    });
    return { enabled };
  }

  async register(workspaceId: string, input: Record<string, unknown>) {
    await this.assertEnabled(workspaceId);
    const name = oauthString(input.client_name, 120);
    if (
      !Array.isArray(input.redirect_uris) ||
      !input.redirect_uris.length ||
      input.redirect_uris.length > 8 ||
      (input.token_endpoint_auth_method !== undefined &&
        input.token_endpoint_auth_method !== 'none') ||
      (input.grant_types !== undefined &&
        (!Array.isArray(input.grant_types) ||
          input.grant_types.some(
            (v) => !['authorization_code', 'refresh_token'].includes(v),
          ))) ||
      (input.response_types !== undefined &&
        JSON.stringify(input.response_types) !== '["code"]')
    )
      throw new McpOAuthError('invalid_client_metadata');
    const uris = [...new Set(input.redirect_uris.map(oauthRedirect))];
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId + ':mcp-oauth-clients'}, 0))`.execute(
        trx,
      );
      const count = await trx
        .selectFrom('mcpOauthClients')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirstOrThrow();
      if (Number(count.count) >= 200)
        throw new McpOAuthError(
          'temporarily_unavailable',
          'Workspace OAuth client limit reached',
          429,
        );
      await trx
        .insertInto('mcpOauthClients')
        .values({
          id,
          workspaceId,
          name,
          redirectUris: postgresJsonb(uris).$castTo<Json>(),
        })
        .execute();
    });
    return {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp:read',
    };
  }

  async begin(workspace: Workspace, input: Record<string, unknown>) {
    await this.assertEnabled(workspace.id);
    const clientId = oauthUuid(input.client_id);
    const redirectUri = oauthRedirect(input.redirect_uri);
    const state = oauthString(input.state, 2048, true) || null;
    const resource = this.urls(workspace).resource;
    if (
      input.response_type !== 'code' ||
      input.code_challenge_method !== 'S256' ||
      typeof input.code_challenge !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge) ||
      input.resource !== resource ||
      (input.scope !== undefined && input.scope !== 'mcp:read')
    )
      throw new McpOAuthError();
    const client = await this.client(workspace.id, clientId);
    const challenge = oauthString(input.code_challenge, 43);
    if (!(client.redirectUris as string[]).includes(redirectUri))
      throw new McpOAuthError('invalid_redirect_uri');
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${workspace.id + ':mcp-oauth-pending'}, 0))`.execute(
        trx,
      );
      await trx
        .deleteFrom('mcpOauthAuthorizations')
        .where('workspaceId', '=', workspace.id)
        .where('decidedAt', 'is', null)
        .where('expiresAt', '<=', new Date())
        .execute();
      const pending = await trx
        .selectFrom('mcpOauthAuthorizations')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('workspaceId', '=', workspace.id)
        .where('decidedAt', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(pending.count) >= 1000)
        throw new McpOAuthError(
          'temporarily_unavailable',
          'Workspace pending authorization limit reached',
          429,
        );
      await trx
        .insertInto('mcpOauthAuthorizations')
        .values({
          id,
          workspaceId: workspace.id,
          clientId,
          redirectUri,
          resource,
          state,
          challenge,
          expiresAt: new Date(Date.now() + 15 * minute),
          decidedAt: null,
          codeHash: null,
          codeExpiresAt: null,
          codeUsedAt: null,
        })
        .execute();
    });
    return `${this.urls(workspace).issuer}/mcp/authorize?request=${id}`;
  }

  async consentInfo(workspace: Workspace, requestId: unknown) {
    await this.assertEnabled(workspace.id);
    const authorization = await this.pending(
      workspace.id,
      oauthUuid(requestId),
    );
    const client = await this.client(workspace.id, authorization.clientId);
    return {
      id: authorization.id,
      clientName: client.name,
      redirectUri: authorization.redirectUri,
      resource: authorization.resource,
      scope: 'mcp:read',
      expiresAt: authorization.expiresAt,
    };
  }

  async decide(
    workspace: Workspace,
    user: User,
    session: UserSession,
    input: { requestId?: unknown; spaceId?: unknown; allow?: unknown },
  ) {
    await this.assertEnabled(workspace.id);
    const requestId = oauthUuid(input.requestId);
    if (typeof input.allow !== 'boolean') throw new McpOAuthError();
    const spaceId = input.allow ? oauthUuid(input.spaceId) : null;
    let capabilities: string[] = [];
    let spaceName = '';
    if (spaceId) {
      const actor = await this.currentActor(
        workspace,
        user.id,
        session?.id,
        spaceId,
      );
      spaceName = actor.space.name;
      capabilities = await this.policy.getEffectiveCapabilities(
        workspace.id,
        spaceId,
        'mcp',
      );
      if (!capabilities.length)
        throw new ForbiddenException('No MCP read tools are available');
    }
    return this.db.transaction().execute(async (trx) => {
      const settings = await trx
        .selectFrom('mcpOauthSettings')
        .select('enabled')
        .where('workspaceId', '=', workspace.id)
        .forShare()
        .executeTakeFirst();
      if (!settings?.enabled)
        throw new McpOAuthError(
          'access_denied',
          'User MCP OAuth is disabled',
          403,
        );
      const authorization = await trx
        .selectFrom('mcpOauthAuthorizations')
        .selectAll()
        .where('id', '=', requestId)
        .where('workspaceId', '=', workspace.id)
        .forUpdate()
        .executeTakeFirst();
      if (
        !authorization ||
        authorization.decidedAt ||
        authorization.expiresAt <= new Date()
      )
        throw new McpOAuthError(
          'invalid_request',
          'Authorization request expired or already decided',
        );
      const callback = new URL(authorization.redirectUri);
      if (authorization.state)
        callback.searchParams.set('state', authorization.state);
      const code = input.allow ? oauthSecret('dmoc') : null;
      await trx
        .updateTable('mcpOauthAuthorizations')
        .set({
          decidedAt: new Date(),
          codeHash: code ? oauthHash(code) : null,
          codeExpiresAt: code ? new Date(Date.now() + 5 * minute) : null,
        })
        .where('id', '=', authorization.id)
        .execute();
      if (code) {
        await trx
          .insertInto('mcpOauthGrants')
          .values({
            id: randomUUID(),
            authorizationId: authorization.id,
            workspaceId: workspace.id,
            clientId: authorization.clientId,
            userId: user.id,
            sessionId: session.id,
            spaceId: spaceId!,
            spaceName,
            resource: authorization.resource,
            capabilities: postgresJsonb(capabilities).$castTo<Json>(),
            expiresAt: new Date(Date.now() + 30 * day),
            revokedAt: null,
            lastUsedAt: null,
          })
          .execute();
        callback.searchParams.set('code', code);
      } else callback.searchParams.set('error', 'access_denied');
      return { redirectUri: callback.toString() };
    });
  }

  async token(workspace: Workspace, input: Record<string, unknown>) {
    await this.assertEnabled(workspace.id);
    const clientId = oauthUuid(input.client_id);
    await this.client(workspace.id, clientId);
    if (
      input.resource !== this.urls(workspace).resource ||
      (input.scope !== undefined && input.scope !== 'mcp:read') ||
      input.client_secret !== undefined
    )
      throw new McpOAuthError(
        'invalid_target',
        'The canonical MCP resource is required',
      );
    let result:
      | { error: true }
      | { error: false; access_token: string; refresh_token: string };
    if (input.grant_type === 'authorization_code') {
      const code = oauthString(input.code, 100);
      result = await this.db.transaction().execute(async (trx) => {
        const authorization = await trx
          .selectFrom('mcpOauthAuthorizations')
          .selectAll()
          .where('codeHash', '=', oauthHash(code))
          .where('workspaceId', '=', workspace.id)
          .where('clientId', '=', clientId)
          .forUpdate()
          .executeTakeFirst();
        if (
          !authorization ||
          !authorization.codeExpiresAt ||
          authorization.codeExpiresAt <= new Date() ||
          input.redirect_uri !== authorization.redirectUri ||
          !oauthVerifier(input.code_verifier, authorization.challenge)
        )
          return { error: true as const };
        const grant = await trx
          .selectFrom('mcpOauthGrants')
          .selectAll()
          .where('authorizationId', '=', authorization.id)
          .forUpdate()
          .executeTakeFirst();
        if (!grant) return { error: true as const };
        if (authorization.codeUsedAt) {
          await this.revokeGrant(trx, grant.id);
          return { error: true as const };
        }
        await this.assertGrantForExchange(workspace, grant);
        await trx
          .updateTable('mcpOauthAuthorizations')
          .set({ codeUsedAt: new Date() })
          .where('id', '=', authorization.id)
          .execute();
        return { error: false as const, ...(await this.issue(trx, grant)) };
      });
    } else if (input.grant_type === 'refresh_token') {
      const refresh = oauthString(input.refresh_token, 100);
      result = await this.db.transaction().execute(async (trx) => {
        const token = await trx
          .selectFrom('mcpOauthTokens')
          .selectAll()
          .where('hash', '=', oauthHash(refresh))
          .where('kind', '=', 'refresh')
          .forUpdate()
          .executeTakeFirst();
        if (!token || token.expiresAt <= new Date())
          return { error: true as const };
        const grant = await trx
          .selectFrom('mcpOauthGrants')
          .selectAll()
          .where('id', '=', token.grantId)
          .where('workspaceId', '=', workspace.id)
          .where('clientId', '=', clientId)
          .forUpdate()
          .executeTakeFirst();
        if (!grant) return { error: true as const };
        if (token.usedAt) {
          await this.revokeGrant(trx, grant.id);
          return { error: true as const };
        }
        await this.assertGrantForExchange(workspace, grant);
        await trx
          .updateTable('mcpOauthTokens')
          .set({ usedAt: new Date() })
          .where('hash', '=', token.hash)
          .execute();
        return { error: false as const, ...(await this.issue(trx, grant)) };
      });
    } else throw new McpOAuthError('unsupported_grant_type');
    // Throw only after commit: replay revocation must survive the error response.
    if (result.error === true)
      throw new McpOAuthError(
        'invalid_grant',
        'Authorization code or refresh token is invalid',
      );
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'mcp:read',
    };
  }

  async authenticate(workspace: Workspace, value: string) {
    if (!/^dmoa_[A-Za-z0-9_-]{43}$/.test(value))
      throw new McpOAuthError('invalid_token', 'Invalid MCP access token', 401);
    const token = await this.db
      .selectFrom('mcpOauthTokens')
      .selectAll()
      .where('hash', '=', oauthHash(value))
      .where('kind', '=', 'access')
      .where('expiresAt', '>', new Date())
      .executeTakeFirst();
    const grant =
      token &&
      (await this.db
        .selectFrom('mcpOauthGrants')
        .selectAll()
        .where('id', '=', token.grantId)
        .where('workspaceId', '=', workspace.id)
        .executeTakeFirst());
    if (!grant)
      throw new McpOAuthError('invalid_token', 'Invalid MCP access token', 401);
    const actor = await this.assertGrant(workspace, grant);
    await this.db
      .updateTable('mcpOauthGrants')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', grant.id)
      .execute();
    return {
      ...actor,
      authType: 'mcp_oauth',
      mcpScope: {
        id: grant.id,
        workspaceId: grant.workspaceId,
        spaceId: grant.spaceId,
        allowedCapabilities: grant.capabilities,
      },
    };
  }

  async list(workspaceId: string, userId: string) {
    return this.db
      .selectFrom('mcpOauthGrants as g')
      .innerJoin('mcpOauthClients as c', 'c.id', 'g.clientId')
      .select([
        'g.id',
        'c.name as clientName',
        'g.spaceName',
        'g.createdAt',
        'g.expiresAt',
        'g.lastUsedAt',
        'g.revokedAt',
      ])
      .where('g.workspaceId', '=', workspaceId)
      .where('g.userId', '=', userId)
      .orderBy('g.createdAt', 'desc')
      .limit(200)
      .execute();
  }

  async disconnect(workspaceId: string, userId: string, id: unknown) {
    const grant = await this.db
      .updateTable('mcpOauthGrants')
      .set({ revokedAt: new Date() })
      .where('id', '=', oauthUuid(id))
      .where('workspaceId', '=', workspaceId)
      .where('userId', '=', userId)
      .returning('id')
      .executeTakeFirst();
    if (!grant) throw new NotFoundException('Connected application not found');
    return { revoked: true };
  }

  async revoke(workspaceId: string, input: Record<string, unknown>) {
    const clientId = oauthUuid(input.client_id);
    const token = await this.db
      .selectFrom('mcpOauthTokens')
      .select('grantId')
      .where('hash', '=', oauthHash(oauthString(input.token, 100)))
      .executeTakeFirst();
    if (token)
      await this.db
        .updateTable('mcpOauthGrants')
        .set({ revokedAt: new Date() })
        .where('id', '=', token.grantId)
        .where('workspaceId', '=', workspaceId)
        .where('clientId', '=', clientId)
        .execute();
    return {};
  }

  private async issue(trx: KyselyTransaction, grant: Grant) {
    const access_token = oauthSecret('dmoa');
    const refresh_token = oauthSecret('dmor');
    await trx
      .insertInto('mcpOauthTokens')
      .values([
        {
          hash: oauthHash(access_token),
          grantId: grant.id,
          kind: 'access',
          expiresAt: new Date(
            Math.min(Date.now() + 15 * minute, grant.expiresAt.getTime()),
          ),
          usedAt: null,
        },
        {
          hash: oauthHash(refresh_token),
          grantId: grant.id,
          kind: 'refresh',
          expiresAt: grant.expiresAt,
          usedAt: null,
        },
      ])
      .execute();
    return { access_token, refresh_token };
  }

  private revokeGrant(trx: KyselyTransaction, id: string) {
    return trx
      .updateTable('mcpOauthGrants')
      .set({ revokedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  private async assertGrantForExchange(workspace: Workspace, grant: Grant) {
    try {
      return await this.assertGrant(workspace, grant);
    } catch (error) {
      if (
        error instanceof HttpException &&
        [401, 403, 404, 428].includes(error.getStatus())
      )
        throw new McpOAuthError(
          'invalid_grant',
          'Authorization is no longer valid; reconnect the application',
        );
      throw error;
    }
  }

  private async assertGrant(workspace: Workspace, grant: Grant) {
    await this.assertEnabled(workspace.id);
    if (
      grant.revokedAt ||
      grant.expiresAt <= new Date() ||
      grant.resource !== this.urls(workspace).resource
    )
      throw new McpOAuthError(
        'invalid_token',
        'MCP authorization expired or revoked',
        401,
      );
    return this.currentActor(
      workspace,
      grant.userId,
      grant.sessionId,
      grant.spaceId,
    );
  }

  private async currentActor(
    workspace: Workspace,
    userId: string,
    sessionId: string,
    spaceId: string,
  ) {
    const [currentWorkspace, user, session, space] = await Promise.all([
      this.workspaces.findById(workspace.id),
      this.users.findById(userId, workspace.id),
      sessionId ? this.sessions.findActiveById(sessionId) : null,
      this.spaces.findById(spaceId, workspace.id),
    ]);
    if (
      !currentWorkspace ||
      currentWorkspace.deletedAt ||
      !user ||
      user.deletedAt ||
      user.deactivatedAt ||
      !space ||
      space.archivedAt ||
      !session ||
      session.userId !== userId ||
      session.workspaceId !== workspace.id
    )
      throw new McpOAuthError(
        'invalid_token',
        'User, session or space is no longer available',
        401,
      );
    const ability = await this.ability.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page))
      throw new McpOAuthError('invalid_token', 'Space access was revoked', 401);
    await this.assurance.assertRequestScope(
      { scope: 'space', source: 'params', key: 'spaceId' },
      {
        user: {
          workspace: currentWorkspace,
          user,
          session,
          authType: 'mcp_oauth',
        },
        params: { spaceId },
      },
    );
    return { workspace: currentWorkspace, user, session, space };
  }

  private async pending(workspaceId: string, id: string) {
    const authorization = await this.db
      .selectFrom('mcpOauthAuthorizations')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('decidedAt', 'is', null)
      .where('expiresAt', '>', new Date())
      .executeTakeFirst();
    if (!authorization)
      throw new McpOAuthError(
        'invalid_request',
        'Authorization request expired or already decided',
      );
    return authorization;
  }

  private async client(workspaceId: string, id: string) {
    const client = await this.db
      .selectFrom('mcpOauthClients')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (!client)
      throw new McpOAuthError('invalid_client', 'Unknown OAuth client', 401);
    return client;
  }

  private async assertEnabled(workspaceId: string) {
    if (!(await this.settings(workspaceId)).enabled)
      throw new McpOAuthError(
        'access_denied',
        'User MCP OAuth is disabled',
        403,
      );
  }

  private assertAdmin(user: User) {
    if (!['admin', 'owner'].includes(user.role))
      throw new ForbiddenException('Workspace administrator required');
  }
}
