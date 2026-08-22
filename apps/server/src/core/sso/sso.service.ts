import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  AuthProvider,
  SsoLoginState,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SignupService } from '../auth/services/signup.service';
import { MfaService } from '../mfa/mfa.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  decryptProtectedValue,
  encryptProtectedValue,
  hashProtectedValue,
  safeStringEqual,
} from '../../common/security/credential-protection.util';
import { randomBytes, X509Certificate } from 'node:crypto';
import {
  Client as OidcClient,
  generators,
  Issuer,
  TokenSet,
  UserinfoResponse,
} from 'openid-client';
import {
  CacheProvider,
  Profile,
  SAML,
  ValidateInResponseTo,
} from '@node-saml/passport-saml';
import { DOMParser } from '@xmldom/xmldom';
import { Client as LdapClient, Entry as LdapEntry } from 'ldapts';
import { FastifyRequest } from 'fastify';
import { executeTx } from '@docmost/db/utils';
import { sql } from 'kysely';
import { isEmail } from 'class-validator';
import {
  CreateSsoGroupMappingDto,
  CreateSsoProviderDto,
  SSO_PROVIDER_TYPES,
  SsoProviderType,
  UpdateSsoGroupMappingDto,
  UpdateSsoProviderDto,
} from './dto/sso.dto';
import { DomainService } from '../../integrations/environment/domain.service';
import { SsoEndpointPolicyService } from '../../integrations/environment/sso-endpoint-policy.service';
import {
  isEnforcementReadyProvider,
  SECURITY_CRITICAL_PROVIDER_FIELDS,
} from './sso-provider.util';
import { SpacePolicyService } from '../space-policy/space-policy.service';
import { AuthenticationAssuranceService } from '../space-policy/authentication-assurance.service';
import { TokenService } from '../auth/services/token.service';
import { AuthCookieService } from '../../common/security/auth-cookie.service';
import { JwtPayload, JwtType } from '../auth/dto/jwt-payload';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';

const REDACTED_SECRET = '********';
const SSO_STATE_TTL_MS = 10 * 60 * 1000;
const SSO_HTTP_TIMEOUT_MS = 10_000;
const SSO_HTTP_MAX_REDIRECTS = 3;
const SSO_HTTP_MAX_JSON_BYTES = 1024 * 1024;
const MAX_SYNCED_GROUPS = 100;
const MAX_EXTERNAL_IDENTIFIER_LENGTH = 1024;

interface ExternalIdentity {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  groupsProvided: boolean;
  groups: Array<{ id: string; name: string }>;
}

interface SsoLoginContext {
  purpose?: 'login' | 'step_up';
  userId?: string;
  sessionId?: string;
  spaceId?: string;
  returnTo?: string;
}

interface SsoLoginRequestContext extends SsoLoginContext {
  spaceSlug?: string;
}

/**
 * Ties a redirect-based SSO flow to the browser that started it.
 *
 * `value` is the state issued at initiation and echoed back from the browser's
 * own cookie. `enforced` is false only where the browser cannot send that
 * cookie back at all — a cross-site SAML POST over plain HTTP, where
 * `SameSite=None` is unavailable because the cookie cannot be `Secure`.
 */
export interface SsoBrowserBinding {
  value?: string | null;
  enforced: boolean;
}

export interface SsoAuthenticationResult {
  authToken?: string;
  mfaToken?: string;
  userHasMfa: boolean;
  requiresMfaSetup: boolean;
  isMfaEnforced?: boolean;
  stepUp?: boolean;
  returnTo?: string;
}

@Injectable()
export class SsoService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly userRepo: UserRepo,
    private readonly signupService: SignupService,
    private readonly mfaService: MfaService,
    private readonly environmentService: EnvironmentService,
    private readonly domainService: DomainService,
    private readonly endpointPolicy: SsoEndpointPolicyService,
    private readonly spacePolicy: SpacePolicyService,
    private readonly assuranceService: AuthenticationAssuranceService,
    private readonly tokenService: TokenService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async listProviders(workspaceId: string) {
    const providers = await this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('type', 'in', [...SSO_PROVIDER_TYPES])
      .orderBy('createdAt', 'desc')
      .execute();

    return {
      items: providers.map((provider) => this.sanitizeProvider(provider)),
    };
  }

  getWorkspaceOrigin(workspace: Workspace) {
    return this.domainService.getUrl(workspace.hostname ?? undefined);
  }

  async getProvider(providerId: string, workspaceId: string) {
    return this.sanitizeProvider(
      await this.requireProvider(providerId, workspaceId),
    );
  }

  async createProvider(
    dto: CreateSsoProviderDto,
    creatorId: string,
    workspaceId: string,
  ) {
    const provider = await this.db
      .insertInto('authProviders')
      .values({
        name: dto.name,
        type: dto.type,
        creatorId,
        workspaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.sanitizeProvider(provider);
  }

  async updateProvider(dto: UpdateSsoProviderDto, workspaceId: string) {
    const result = await executeTx(this.db, async (trx) => {
      const current = await this.requireProvider(
        dto.providerId,
        workspaceId,
        trx,
      );
      const { providerId: _, ...input } = dto;
      const updates: Record<string, unknown> = {
        ...input,
        updatedAt: new Date(),
      };

      if (
        input.oidcClientSecret === REDACTED_SECRET ||
        input.oidcClientSecret === ''
      ) {
        delete updates.oidcClientSecret;
      } else if (input.oidcClientSecret) {
        updates.oidcClientSecret = this.encryptSecret(input.oidcClientSecret);
      }

      if (
        input.ldapBindPassword === REDACTED_SECRET ||
        input.ldapBindPassword === ''
      ) {
        delete updates.ldapBindPassword;
      } else if (input.ldapBindPassword) {
        updates.ldapBindPassword = this.encryptSecret(input.ldapBindPassword);
      }

      const candidate = { ...current, ...updates } as AuthProvider;
      if (candidate.isEnabled) {
        this.validateProviderConfiguration(candidate);
        await this.validateProviderEndpoints(candidate);
      }

      // Any change to how the provider talks to the identity provider makes an
      // earlier verification meaningless, so it has to be tested again.
      const invalidatesVerification = SECURITY_CRITICAL_PROVIDER_FIELDS.some(
        (field) =>
          field in updates &&
          String(JSON.stringify(updates[field] ?? null)) !==
            String(JSON.stringify(current[field] ?? null)),
      );

      if (invalidatesVerification) {
        updates.verifiedAt = null;
        updates.lastSuccessfulLoginAt = null;
        updates.lastErrorCode = null;
      }

      if (
        current.isEnabled &&
        (input.isEnabled === false || invalidatesVerification)
      ) {
        await this.assertSsoWillRemainAvailable(workspaceId, current.id, trx);
      }

      const provider = await trx
        .updateTable('authProviders')
        .set(updates)
        .where('id', '=', current.id)
        .where('workspaceId', '=', workspaceId)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.isEnabled === false || input.groupSync === false) {
        await this.removeProviderGroupMemberships(provider.id, trx);
      }

      return this.sanitizeProvider(provider);
    });
    if (dto.isEnabled === false || dto.groupSync === false) {
      await this.emitAuthorizationChanged(workspaceId);
    }
    return result;
  }

  async deleteProvider(providerId: string, workspaceId: string) {
    await executeTx(this.db, async (trx) => {
      const provider = await this.requireProvider(providerId, workspaceId, trx);
      if (provider.isEnabled) {
        await this.assertSsoWillRemainAvailable(workspaceId, provider.id, trx);
      }

      await trx
        .updateTable('authProviders')
        .set({
          isEnabled: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', provider.id)
        .where('workspaceId', '=', workspaceId)
        .execute();

      await this.removeProviderGroupMemberships(provider.id, trx);
    });
    await this.emitAuthorizationChanged(workspaceId);
  }

  async listGroupMappings(providerId: string, workspaceId: string) {
    await this.requireProvider(providerId, workspaceId);

    const items = await this.db
      .selectFrom('authProviderGroupMappings')
      .innerJoin('groups', 'groups.id', 'authProviderGroupMappings.groupId')
      .select([
        'authProviderGroupMappings.id',
        'authProviderGroupMappings.authProviderId',
        'authProviderGroupMappings.externalGroupId',
        'authProviderGroupMappings.groupId',
        'authProviderGroupMappings.createdAt',
        'authProviderGroupMappings.updatedAt',
        'groups.name as groupName',
      ])
      .where('authProviderGroupMappings.authProviderId', '=', providerId)
      .orderBy('authProviderGroupMappings.externalGroupId', 'asc')
      .execute();

    return { items };
  }

  async createGroupMapping(dto: CreateSsoGroupMappingDto, workspaceId: string) {
    await this.requireProvider(dto.providerId, workspaceId);
    await this.requireWorkspaceGroup(dto.groupId, workspaceId);

    const existing = await this.db
      .selectFrom('authProviderGroupMappings')
      .select('id')
      .where('authProviderId', '=', dto.providerId)
      .where('externalGroupId', '=', dto.externalGroupId)
      .executeTakeFirst();
    if (existing) {
      throw new BadRequestException(
        'This external group is already mapped for the provider',
      );
    }

    return this.db
      .insertInto('authProviderGroupMappings')
      .values({
        authProviderId: dto.providerId,
        externalGroupId: dto.externalGroupId,
        groupId: dto.groupId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateGroupMapping(dto: UpdateSsoGroupMappingDto, workspaceId: string) {
    const result = await executeTx(this.db, async (trx) => {
      const mapping = await this.requireGroupMapping(
        dto.mappingId,
        workspaceId,
        trx,
      );

      if (
        dto.externalGroupId &&
        dto.externalGroupId !== mapping.externalGroupId
      ) {
        const duplicate = await trx
          .selectFrom('authProviderGroupMappings')
          .select('id')
          .where('authProviderId', '=', mapping.authProviderId)
          .where('externalGroupId', '=', dto.externalGroupId)
          .where('id', '!=', mapping.id)
          .executeTakeFirst();
        if (duplicate) {
          throw new BadRequestException(
            'This external group is already mapped for the provider',
          );
        }
      }

      const changesMappingSource = Boolean(
        (dto.externalGroupId &&
          dto.externalGroupId !== mapping.externalGroupId) ||
          (dto.groupId && dto.groupId !== mapping.groupId),
      );

      if (dto.groupId && dto.groupId !== mapping.groupId) {
        await this.requireWorkspaceGroup(dto.groupId, workspaceId, trx);
      }
      if (changesMappingSource) {
        // The previous mapping is no longer authoritative. Revoke its owned
        // memberships immediately; the next successful login applies the new
        // mapping.
        await this.releaseMappedGroupMemberships(mapping, trx);
      }

      return trx
        .updateTable('authProviderGroupMappings')
        .set({
          ...(dto.externalGroupId
            ? { externalGroupId: dto.externalGroupId }
            : {}),
          ...(dto.groupId ? { groupId: dto.groupId } : {}),
          updatedAt: new Date(),
        })
        .where('id', '=', mapping.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    await this.emitAuthorizationChanged(workspaceId);
    return result;
  }

  async deleteGroupMapping(mappingId: string, workspaceId: string) {
    await executeTx(this.db, async (trx) => {
      const mapping = await this.requireGroupMapping(
        mappingId,
        workspaceId,
        trx,
      );

      await this.releaseMappedGroupMemberships(mapping, trx);
      await trx
        .deleteFrom('authProviderGroupMappings')
        .where('id', '=', mapping.id)
        .execute();
    });
    await this.emitAuthorizationChanged(workspaceId);
  }

  private async requireGroupMapping(
    mappingId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const mapping = await (trx ?? this.db)
      .selectFrom('authProviderGroupMappings')
      .innerJoin(
        'authProviders',
        'authProviders.id',
        'authProviderGroupMappings.authProviderId',
      )
      .select([
        'authProviderGroupMappings.id',
        'authProviderGroupMappings.authProviderId',
        'authProviderGroupMappings.groupId',
        'authProviderGroupMappings.externalGroupId',
      ])
      .where('authProviderGroupMappings.id', '=', mappingId)
      .where('authProviders.workspaceId', '=', workspaceId)
      .where('authProviders.deletedAt', 'is', null)
      .executeTakeFirst();

    if (!mapping) {
      throw new NotFoundException('SSO group mapping not found');
    }
    return mapping;
  }

  private async requireWorkspaceGroup(
    groupId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const group = await (trx ?? this.db)
      .selectFrom('groups')
      .select(['id', 'isDefault'])
      .where('id', '=', groupId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!group) {
      throw new NotFoundException('Group not found');
    }
    // Every member already belongs to the default group; syncing it would only
    // let a provider remove people from it.
    if (group.isDefault) {
      throw new BadRequestException(
        'The default workspace group cannot be mapped to an external group',
      );
    }
    return group;
  }

  private async releaseMappedGroupMemberships(
    mapping: { authProviderId: string; groupId: string },
    trx: KyselyTransaction,
  ) {
    const memberships = await trx
      .selectFrom('authProviderGroupMemberships')
      .select(['id', 'userId', 'groupId', 'ownsGroupMembership'])
      .where('authProviderId', '=', mapping.authProviderId)
      .where('groupId', '=', mapping.groupId)
      .orderBy('userId', 'asc')
      .execute();

    for (const membership of memberships) {
      await this.releaseProviderGroupMembership(membership, trx);
    }
  }

  async getOidcAuthorizeUrl(
    providerId: string,
    workspace: Workspace,
    origin: string,
    loginContext?: SsoLoginRequestContext,
  ) {
    const provider = await this.requireEnabledProvider(
      providerId,
      workspace.id,
      'oidc',
    );
    const callbackUrl = this.buildCallbackUrl(origin, 'oidc', provider.id);
    const client = await this.createOidcClient(provider, callbackUrl);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const context = await this.resolveLoginContext(workspace, loginContext);

    await this.createLoginState({
      state,
      provider,
      codeVerifier,
      nonce,
      ...context,
    });

    const url = client.authorizationUrl({
      scope: 'openid email profile groups',
      response_type: 'code',
      redirect_uri: callbackUrl,
      state,
      nonce,
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });

    return { url, state };
  }

  async completeOidcLogin(
    providerId: string,
    workspace: Workspace,
    origin: string,
    callbackParams: Record<string, string | string[] | undefined>,
    request?: FastifyRequest,
    browserBinding: SsoBrowserBinding = { enforced: true },
  ) {
    const state = this.requireSingleString(callbackParams.state, 'state');
    this.assertBrowserBinding(state, browserBinding);
    const loginState = await this.claimLoginState(
      state,
      providerId,
      workspace.id,
    );
    const provider = await this.requireEnabledProvider(
      providerId,
      workspace.id,
      'oidc',
    );
    const callbackUrl = this.buildCallbackUrl(origin, 'oidc', provider.id);
    const client = await this.createOidcClient(provider, callbackUrl);
    const codeVerifier = this.decryptSecret(loginState.codeVerifier);

    let tokenSet: TokenSet;
    try {
      tokenSet = await client.callback(
        callbackUrl,
        callbackParams as Record<string, string>,
        {
          state,
          nonce: loginState.nonce,
          code_verifier: codeVerifier,
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid OIDC response');
    }

    const identity = await this.identityFromOidc(client, tokenSet);
    if (loginState.purpose === 'step_up') {
      return this.finishStepUp(
        provider,
        workspace,
        identity,
        loginState,
        request,
      );
    }
    return this.finishLogin(provider, workspace, identity, request, {
      spaceId: loginState.spaceId ?? undefined,
      returnTo: loginState.returnTo ?? undefined,
    });
  }

  async getSamlAuthorizeUrl(
    providerId: string,
    workspace: Workspace,
    origin: string,
    host?: string,
    loginContext?: SsoLoginRequestContext,
  ) {
    const provider = await this.requireEnabledProvider(
      providerId,
      workspace.id,
      'saml',
    );
    const state = generators.state();
    const context = await this.resolveLoginContext(workspace, loginContext);
    await this.createLoginState({ state, provider, ...context });

    const saml = this.createSamlClient(
      provider,
      origin,
      this.createSamlCacheProvider(provider.id, this.hashState(state)),
    );

    const url = await saml.getAuthorizeUrlAsync(state, host, {});
    return { url, state };
  }

  async completeSamlLogin(
    providerId: string,
    workspace: Workspace,
    origin: string,
    body: Record<string, string | undefined>,
    request?: FastifyRequest,
    browserBinding: SsoBrowserBinding = { enforced: true },
  ) {
    const state = this.requireSingleString(body.RelayState, 'RelayState');
    const samlResponse = this.requireSingleString(
      body.SAMLResponse,
      'SAMLResponse',
    );
    this.assertBrowserBinding(state, browserBinding);
    const loginState = await this.claimLoginState(
      state,
      providerId,
      workspace.id,
    );
    const provider = await this.requireEnabledProvider(
      providerId,
      workspace.id,
      'saml',
    );
    const callbackUrl = this.buildCallbackUrl(origin, 'saml', provider.id);
    const saml = this.createSamlClient(
      provider,
      origin,
      this.createSamlCacheProvider(provider.id, loginState.stateHash),
    );
    let result: Awaited<ReturnType<SAML['validatePostResponseAsync']>>;
    try {
      result = await saml.validatePostResponseAsync({
        SAMLResponse: samlResponse,
      });
    } catch {
      throw new UnauthorizedException('Invalid SAML response');
    }

    if (!result.profile || result.loggedOut) {
      throw new UnauthorizedException('Invalid SAML response');
    }

    this.assertSamlResponseTarget(result.profile, callbackUrl);
    const identity = this.identityFromSaml(result.profile);
    if (loginState.purpose === 'step_up') {
      return this.finishStepUp(
        provider,
        workspace,
        identity,
        loginState,
        request,
      );
    }
    return this.finishLogin(provider, workspace, identity, request, {
      spaceId: loginState.spaceId ?? undefined,
      returnTo: loginState.returnTo ?? undefined,
    });
  }

  async loginWithLdap(
    providerId: string,
    workspace: Workspace,
    username: string,
    password: string,
    request?: FastifyRequest,
    loginContext?: SsoLoginRequestContext,
  ) {
    const provider = await this.requireEnabledProvider(
      providerId,
      workspace.id,
      'ldap',
    );
    const identity = await this.authenticateLdap(provider, username, password);
    const context = await this.resolveLoginContext(workspace, loginContext);
    return this.finishLogin(provider, workspace, identity, request, context);
  }

  async getOidcStepUpUrl(
    providerId: string,
    workspace: Workspace,
    origin: string,
    userId: string,
    sessionId: string,
    input?: { spaceSlug?: string; returnTo?: string },
  ) {
    const target = await this.resolveLoginContext(workspace, input);
    return this.getOidcAuthorizeUrl(providerId, workspace, origin, {
      purpose: 'step_up',
      userId,
      sessionId,
      spaceId: target.spaceId,
      returnTo: target.returnTo,
    });
  }

  async getSamlStepUpUrl(
    providerId: string,
    workspace: Workspace,
    origin: string,
    userId: string,
    sessionId: string,
    input?: { spaceSlug?: string; returnTo?: string },
  ) {
    const target = await this.resolveLoginContext(workspace, input);
    return this.getSamlAuthorizeUrl(
      providerId,
      workspace,
      origin,
      new URL(origin).hostname,
      {
        purpose: 'step_up',
        userId,
        sessionId,
        spaceId: target.spaceId,
        returnTo: target.returnTo,
      },
    );
  }

  async stepUpWithLdap(
    providerId: string,
    workspace: Workspace,
    user: User,
    sessionId: string,
    username: string,
    password: string,
  ) {
    const provider = await this.requireEnabledProvider(
      providerId,
      workspace.id,
      'ldap',
    );
    const identity = await this.authenticateLdap(provider, username, password);
    await this.assertStepUpIdentity(provider, workspace, identity, user.id);
    await this.recordSuccessfulLogin(provider);
    await this.assuranceService.markSsoVerified(sessionId, provider.id);
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId: workspace.id,
      userId: user.id,
      sessionId,
    });
    return { ssoVerified: true };
  }

  private async finishLogin(
    provider: AuthProvider,
    workspace: Workspace,
    identity: ExternalIdentity,
    request?: FastifyRequest,
    context: Pick<SsoLoginContext, 'spaceId' | 'returnTo'> = {},
  ): Promise<SsoAuthenticationResult> {
    const user = await this.resolveIdentity(provider, workspace, identity);

    let enforceMfa = Boolean(workspace.enforceMfa);
    if (context.spaceId) {
      const target = await this.spacePolicy.resolveAccessibleSpace(
        workspace,
        user,
        context.spaceId,
      );
      if (!target) {
        throw new ForbiddenException('The target space is not accessible');
      }
      enforceMfa = target.policy.effective.enforceMfa;
    }

    await this.recordSuccessfulLogin(provider);

    if (provider.groupSync && identity.groupsProvided) {
      await this.syncGroups(provider, user, identity.groups);
    }

    const loginToken = await this.mfaService.issueLoginTokenForUser(
      user,
      workspace,
      request,
      {
        enforceMfa,
        ssoAuthProviderId: provider.id,
        targetSpaceId: context.spaceId,
      },
    );

    return {
      ...loginToken,
      returnTo: context.returnTo,
    };
  }

  private async finishStepUp(
    provider: AuthProvider,
    workspace: Workspace,
    identity: ExternalIdentity,
    loginState: SsoLoginState,
    request?: FastifyRequest,
  ): Promise<SsoAuthenticationResult> {
    if (!loginState.userId || !loginState.sessionId) {
      throw new UnauthorizedException('SSO step-up state is incomplete');
    }

    await this.assertCurrentSessionBinding(
      request,
      workspace.id,
      loginState.userId,
      loginState.sessionId,
    );
    const user = await this.assertStepUpIdentity(
      provider,
      workspace,
      identity,
      loginState.userId,
    );

    if (loginState.spaceId) {
      const target = await this.spacePolicy.resolveAccessibleSpace(
        workspace,
        user,
        loginState.spaceId,
      );
      if (!target) {
        throw new ForbiddenException('The target space is not accessible');
      }
    }

    await this.recordSuccessfulLogin(provider);

    if (provider.groupSync && identity.groupsProvided) {
      await this.syncGroups(provider, user, identity.groups);
    }

    await this.assuranceService.markSsoVerified(
      loginState.sessionId,
      provider.id,
    );
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId: workspace.id,
      userId: user.id,
      sessionId: loginState.sessionId,
    });
    return {
      userHasMfa: false,
      requiresMfaSetup: false,
      stepUp: true,
      returnTo: this.safeReturnTo(loginState.returnTo),
    };
  }

  private async assertCurrentSessionBinding(
    request: FastifyRequest | undefined,
    workspaceId: string,
    userId: string,
    sessionId: string,
  ) {
    const authToken = (request as any)?.cookies?.[
      AuthCookieService.AUTH_COOKIE_NAME
    ];
    if (!authToken) {
      throw new UnauthorizedException(
        'The current session is required for SSO step-up',
      );
    }

    const payload = (await this.tokenService.verifyJwt(
      authToken,
      JwtType.ACCESS,
    )) as JwtPayload;
    if (
      payload.sub !== userId ||
      payload.workspaceId !== workspaceId ||
      payload.sessionId !== sessionId
    ) {
      throw new UnauthorizedException('SSO step-up session does not match');
    }

    const session = await this.db
      .selectFrom('userSessions')
      .select(['id', 'userId', 'workspaceId'])
      .where('id', '=', sessionId)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('revokedAt', 'is', null)
      .where('expiresAt', '>', new Date())
      .executeTakeFirst();
    if (!session) {
      throw new UnauthorizedException(
        'SSO step-up session is no longer active',
      );
    }
  }

  private async assertStepUpIdentity(
    provider: AuthProvider,
    workspace: Workspace,
    identity: ExternalIdentity,
    expectedUserId: string,
  ): Promise<User> {
    const account = await this.db
      .selectFrom('authAccounts')
      .select('userId')
      .where('authProviderId', '=', provider.id)
      .where('providerUserId', '=', identity.providerUserId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    let user: User | undefined;
    if (account) {
      if (account.userId !== expectedUserId) {
        throw new ForbiddenException(
          'The SSO identity belongs to a different user',
        );
      }
      user = await this.userRepo.findById(expectedUserId, workspace.id);
    } else {
      this.assertEmailVerifiedForLinking(identity);
      user = await this.userRepo.findByEmail(identity.email, workspace.id);
      if (!user || user.id !== expectedUserId) {
        throw new ForbiddenException(
          'The SSO identity belongs to a different user',
        );
      }
    }

    this.assertActiveUser(user);
    return user;
  }

  private async resolveLoginContext(
    workspace: Workspace,
    input?: SsoLoginRequestContext,
  ): Promise<SsoLoginContext> {
    let spaceId = input?.spaceId;
    if (!spaceId && input?.spaceSlug) {
      spaceId =
        (await this.spacePolicy.resolveSpaceId(
          workspace.id,
          input.spaceSlug,
        )) ?? undefined;
      if (!spaceId) {
        throw new NotFoundException('Space not found');
      }
    }

    return {
      purpose: input?.purpose ?? 'login',
      userId: input?.userId,
      sessionId: input?.sessionId,
      spaceId,
      returnTo: input?.returnTo ? this.safeReturnTo(input.returnTo) : undefined,
    };
  }

  private safeReturnTo(returnTo?: string | null): string {
    if (
      !returnTo ||
      !returnTo.startsWith('/') ||
      returnTo.startsWith('//') ||
      returnTo.includes('\\') ||
      this.hasControlCharacters(returnTo)
    ) {
      return '/home';
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(returnTo);
    } catch {
      return '/home';
    }
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes('\\') ||
      this.hasControlCharacters(decoded)
    ) {
      return '/home';
    }

    return returnTo;
  }

  private hasControlCharacters(value: string): boolean {
    return [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  }

  private async recordSuccessfulLogin(provider: AuthProvider) {
    const updated = await this.db
      .updateTable('authProviders')
      .set({
        lastSuccessfulLoginAt: new Date(),
        lastErrorCode: null,
      })
      .where('id', '=', provider.id)
      .where('workspaceId', '=', provider.workspaceId)
      .where('updatedAt', '=', provider.updatedAt)
      .where('verifiedAt', 'is not', null)
      .returning('id')
      .executeTakeFirst();

    if (!updated) {
      throw new UnauthorizedException(
        'SSO provider configuration changed during authentication',
      );
    }
  }

  /**
   * Checks a provider against the live identity provider without signing a user
   * in. Success is what unlocks SSO enforcement together with a real login.
   */
  async testProvider(providerId: string, workspace: Workspace) {
    const workspaceId = workspace.id;
    const provider = await this.requireProvider(providerId, workspaceId);

    try {
      this.validateProviderConfiguration(provider);
      await this.validateProviderEndpoints(provider);

      if (provider.type === 'oidc') {
        await this.testOidcProvider(provider, workspace);
      } else if (provider.type === 'saml') {
        await this.testSamlProvider(provider);
      } else {
        await this.testLdapProvider(provider);
      }
    } catch (error) {
      const errorCode = this.toProviderErrorCode(error);
      await this.db
        .updateTable('authProviders')
        .set({ lastErrorCode: errorCode })
        .where('id', '=', provider.id)
        .where('workspaceId', '=', workspaceId)
        .execute();

      throw error instanceof BadRequestException ||
        error instanceof UnauthorizedException
        ? error
        : new BadRequestException(
            `SSO provider configuration test failed (${errorCode})`,
          );
    }

    const verified = await this.db
      .updateTable('authProviders')
      .set({ verifiedAt: new Date(), lastErrorCode: null })
      .where('id', '=', provider.id)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.sanitizeProvider(verified);
  }

  private async testOidcProvider(provider: AuthProvider, workspace: Workspace) {
    const callbackUrl = this.buildCallbackUrl(
      this.getWorkspaceOrigin(workspace),
      'oidc',
      provider.id,
    );
    const issuer = await this.discoverOidcIssuer(provider);
    if (
      !issuer.metadata.jwks_uri ||
      !issuer.metadata.authorization_endpoint ||
      !issuer.metadata.token_endpoint
    ) {
      throw new BadRequestException(
        'OIDC discovery document is missing a required endpoint',
      );
    }
    const jwksResponse = await this.fetchAllowedEndpoint(
      issuer.metadata.jwks_uri,
      'OIDC JWKS',
    );
    const jwks = await this.readJsonResponse(jwksResponse, 'OIDC JWKS');
    if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new BadRequestException('OIDC JWKS does not contain signing keys');
    }
    this.createOidcClientFromIssuer(provider, callbackUrl, issuer);
  }

  private async testSamlProvider(provider: AuthProvider) {
    this.validateSamlCertificate(provider.samlCertificate);
    let response = await this.fetchAllowedEndpoint(
      provider.samlUrl,
      'SAML login',
      'HEAD',
    );
    if (response.status === 405 || response.status === 501) {
      response = await this.fetchAllowedEndpoint(
        provider.samlUrl,
        'SAML login',
      );
    }
    if (
      response.status === 404 ||
      response.status === 410 ||
      response.status >= 500
    ) {
      throw new BadRequestException('SAML login endpoint is unavailable');
    }
  }

  private validateSamlCertificate(certificateValue: string) {
    const certificate = certificateValue.trim();
    const normalized = certificate
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');

    if (normalized.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
      throw new BadRequestException(
        'SAML signing certificate is not valid base64 DER data',
      );
    }

    const pem = [
      '-----BEGIN CERTIFICATE-----',
      normalized.match(/.{1,64}/g)?.join('\n') ?? normalized,
      '-----END CERTIFICATE-----',
    ].join('\n');

    try {
      const parsed = new X509Certificate(pem);
      const validFrom = Date.parse(parsed.validFrom);
      const validTo = Date.parse(parsed.validTo);
      const now = Date.now();
      if (
        !Number.isFinite(validFrom) ||
        !Number.isFinite(validTo) ||
        now < validFrom ||
        now > validTo
      ) {
        throw new Error('Certificate is not currently valid');
      }
    } catch {
      throw new BadRequestException('SAML signing certificate cannot be read');
    }
  }

  private async testLdapProvider(provider: AuthProvider) {
    const url = await this.endpointPolicy.assertAllowed(
      provider.ldapUrl,
      ['ldap:', 'ldaps:'],
      'LDAP',
    );
    const tlsOptions = {
      rejectUnauthorized: true,
      ...(provider.ldapTlsCaCert
        ? { ca: [provider.ldapTlsCaCert] }
        : undefined),
    };
    const client = new LdapClient({
      url: provider.ldapUrl,
      timeout: 10_000,
      connectTimeout: 10_000,
      ...(url.protocol === 'ldaps:' ? { tlsOptions } : undefined),
    });

    try {
      if (url.protocol === 'ldap:' && provider.ldapTlsEnabled) {
        await client.startTLS(tlsOptions);
      }
      // Service bind only: no user lookup is performed during a config test.
      await client.bind(
        provider.ldapBindDn,
        this.decryptSecret(provider.ldapBindPassword),
      );
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  private toProviderErrorCode(error: unknown): string {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).toLowerCase();

    if (message.includes('not in sso_allowed_endpoints')) {
      return 'endpoint_not_allowed';
    }
    if (message.includes('cannot be resolved')) {
      return 'dns_resolution_failed';
    }
    if (message.includes('certificate')) {
      return 'invalid_certificate';
    }
    if (message.includes('credential') || message.includes('invalid')) {
      return 'invalid_credentials';
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'connection_timeout';
    }
    if (message.includes('incomplete')) {
      return 'incomplete_configuration';
    }
    return 'connection_failed';
  }

  private async resolveIdentity(
    provider: AuthProvider,
    workspace: Workspace,
    identity: ExternalIdentity,
  ): Promise<User> {
    return executeTx(this.db, async (trx) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${`sso-identity:${provider.id}:${identity.providerUserId}`},
            0
          )
        )
      `.execute(trx);

      const existingAccount = await trx
        .selectFrom('authAccounts')
        .select(['userId'])
        .where('authProviderId', '=', provider.id)
        .where('providerUserId', '=', identity.providerUserId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();

      if (existingAccount) {
        const existingUser = await this.userRepo.findById(
          existingAccount.userId,
          workspace.id,
          { trx },
        );
        this.assertActiveUser(existingUser);
        return existingUser;
      }

      this.assertEmailVerifiedForLinking(identity);

      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${`sso-identity-email:${workspace.id}:${identity.email}`},
            0
          )
        )
      `.execute(trx);

      let user = await this.userRepo.findByEmail(identity.email, workspace.id, {
        trx,
      });

      if (!user) {
        if (!provider.allowSignup) {
          throw new ForbiddenException(
            'No account is linked to this SSO identity',
          );
        }

        this.assertSignupDomainAllowed(identity.email, workspace);
        user = await this.signupService.signup(
          {
            email: identity.email,
            name: identity.name,
            password: randomBytes(48).toString('base64url'),
          },
          workspace.id,
          trx,
        );

        await trx
          .updateTable('users')
          .set({
            emailVerifiedAt: new Date(),
            hasGeneratedPassword: true,
            updatedAt: new Date(),
          })
          .where('id', '=', user.id)
          .where('workspaceId', '=', workspace.id)
          .execute();
        user = {
          ...user,
          emailVerifiedAt: new Date(),
          hasGeneratedPassword: true,
        };
      } else {
        this.assertActiveUser(user);
      }

      const existingUserLink = await trx
        .selectFrom('authAccounts')
        .select(['id', 'providerUserId', 'deletedAt'])
        .where('authProviderId', '=', provider.id)
        .where('userId', '=', user.id)
        .executeTakeFirst();

      if (existingUserLink && !existingUserLink.deletedAt) {
        throw new ForbiddenException(
          'This account is already linked to another identity from this provider',
        );
      }

      if (existingUserLink) {
        await trx
          .updateTable('authAccounts')
          .set({
            providerUserId: identity.providerUserId,
            workspaceId: workspace.id,
            deletedAt: null,
            updatedAt: new Date(),
          })
          .where('id', '=', existingUserLink.id)
          .execute();
      } else {
        await trx
          .insertInto('authAccounts')
          .values({
            userId: user.id,
            providerUserId: identity.providerUserId,
            authProviderId: provider.id,
            workspaceId: workspace.id,
          })
          .execute();
      }

      return user;
    });
  }

  private async syncGroups(
    provider: AuthProvider,
    user: User,
    externalGroups: Array<{ id: string; name: string }>,
  ) {
    const { groups, completeSnapshot } =
      this.prepareGroupSyncSnapshot(externalGroups);

    await executeTx(this.db, async (trx) => {
      const currentProvider = await trx
        .selectFrom('authProviders')
        .select(['isEnabled', 'groupSync', 'deletedAt'])
        .where('id', '=', provider.id)
        .where('workspaceId', '=', provider.workspaceId)
        .forShare()
        .executeTakeFirst();
      if (
        !currentProvider?.isEnabled ||
        !currentProvider.groupSync ||
        currentProvider.deletedAt
      ) {
        return;
      }

      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`sso-groups:${user.id}`}, 0)
        )
      `.execute(trx);

      const mappings = await trx
        .selectFrom('authProviderGroupMappings')
        .selectAll()
        .where('authProviderId', '=', provider.id)
        .execute();
      const mappingByExternalId = new Map(
        mappings.map((mapping) => [mapping.externalGroupId, mapping]),
      );
      const activeGroupIds = new Set<string>();

      for (const externalGroup of groups) {
        // Only mappings an administrator created are honoured. A provider can
        // never invent a workspace group or attach a user to one by name.
        const mapping = mappingByExternalId.get(externalGroup.id);
        if (!mapping) {
          continue;
        }

        activeGroupIds.add(mapping.groupId);
        const insertedMembership = await trx
          .insertInto('groupUsers')
          .values({ userId: user.id, groupId: mapping.groupId })
          .onConflict((oc) => oc.columns(['groupId', 'userId']).doNothing())
          .returning('id')
          .executeTakeFirst();

        const trackedMembership = await trx
          .selectFrom('authProviderGroupMemberships')
          .select(['id', 'ownsGroupMembership'])
          .where('authProviderId', '=', provider.id)
          .where('userId', '=', user.id)
          .where('groupId', '=', mapping.groupId)
          .executeTakeFirst();

        if (trackedMembership) {
          if (insertedMembership && !trackedMembership.ownsGroupMembership) {
            await trx
              .updateTable('authProviderGroupMemberships')
              .set({ ownsGroupMembership: true, updatedAt: new Date() })
              .where('id', '=', trackedMembership.id)
              .execute();
          }
        } else {
          await trx
            .insertInto('authProviderGroupMemberships')
            .values({
              authProviderId: provider.id,
              userId: user.id,
              groupId: mapping.groupId,
              ownsGroupMembership: Boolean(insertedMembership),
            })
            .execute();
        }
      }

      const trackedMemberships = await trx
        .selectFrom('authProviderGroupMemberships')
        .select(['id', 'groupId', 'ownsGroupMembership'])
        .where('authProviderId', '=', provider.id)
        .where('userId', '=', user.id)
        .execute();
      if (!completeSnapshot) {
        return;
      }
      const staleMemberships = trackedMemberships.filter(
        (membership) => !activeGroupIds.has(membership.groupId),
      );

      for (const staleMembership of staleMemberships) {
        await this.releaseProviderGroupMembership(
          {
            ...staleMembership,
            userId: user.id,
          },
          trx,
        );
      }
    });
    await this.emitAuthorizationChanged(provider.workspaceId);
  }

  private async emitAuthorizationChanged(workspaceId: string): Promise<void> {
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId,
    });
  }

  private async removeProviderGroupMemberships(
    providerId: string,
    trx: KyselyTransaction,
  ) {
    const userRows = await trx
      .selectFrom('authProviderGroupMemberships')
      .select('userId')
      .distinct()
      .where('authProviderId', '=', providerId)
      .orderBy('userId', 'asc')
      .execute();

    for (const { userId } of userRows) {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`sso-groups:${userId}`}, 0)
        )
      `.execute(trx);

      const memberships = await trx
        .selectFrom('authProviderGroupMemberships')
        .select(['id', 'userId', 'groupId', 'ownsGroupMembership'])
        .where('authProviderId', '=', providerId)
        .where('userId', '=', userId)
        .orderBy('groupId', 'asc')
        .execute();

      for (const membership of memberships) {
        await this.releaseProviderGroupMembership(membership, trx);
      }
    }
  }

  private async releaseProviderGroupMembership(
    membership: {
      id: string;
      userId: string;
      groupId: string;
      ownsGroupMembership: boolean;
    },
    trx: KyselyTransaction,
  ) {
    await trx
      .deleteFrom('authProviderGroupMemberships')
      .where('id', '=', membership.id)
      .execute();

    if (!membership.ownsGroupMembership) {
      return;
    }

    const successor = await trx
      .selectFrom('authProviderGroupMemberships')
      .innerJoin(
        'authProviders',
        'authProviders.id',
        'authProviderGroupMemberships.authProviderId',
      )
      .select('authProviderGroupMemberships.id')
      .where('authProviderGroupMemberships.userId', '=', membership.userId)
      .where('authProviderGroupMemberships.groupId', '=', membership.groupId)
      .where('authProviders.isEnabled', '=', true)
      .where('authProviders.groupSync', '=', true)
      .where('authProviders.deletedAt', 'is', null)
      .orderBy('authProviderGroupMemberships.createdAt', 'asc')
      .executeTakeFirst();

    if (successor) {
      await trx
        .updateTable('authProviderGroupMemberships')
        .set({ ownsGroupMembership: true, updatedAt: new Date() })
        .where('id', '=', successor.id)
        .execute();
      return;
    }

    await trx
      .deleteFrom('groupUsers')
      .where('userId', '=', membership.userId)
      .where('groupId', '=', membership.groupId)
      .execute();
  }

  private prepareGroupSyncSnapshot(
    externalGroups: Array<{ id: string; name: string }>,
  ) {
    const normalizedGroups = externalGroups
      .map((group) => ({
        id: group.id.trim(),
        name: group.name.trim().slice(0, 100),
      }))
      .filter((group) => group.id && group.name);
    const uniqueGroups = new Map<string, { id: string; name: string }>();
    let completeSnapshot = true;
    for (const group of normalizedGroups) {
      if (group.id.length > MAX_EXTERNAL_IDENTIFIER_LENGTH) {
        completeSnapshot = false;
        continue;
      }
      uniqueGroups.set(group.id, group);
    }
    const sortedGroups = [...uniqueGroups.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (sortedGroups.length > MAX_SYNCED_GROUPS) {
      completeSnapshot = false;
    }
    return {
      groups: sortedGroups.slice(0, MAX_SYNCED_GROUPS),
      completeSnapshot,
    };
  }

  private async identityFromOidc(client: OidcClient, tokenSet: TokenSet) {
    const claims = tokenSet.claims();
    let userInfo: Partial<UserinfoResponse> = {};

    if (tokenSet.access_token) {
      try {
        userInfo = await client.userinfo(tokenSet);
      } catch {
        // Some providers return complete identity claims in the ID token only.
      }
    }

    const identity = { ...claims, ...userInfo } as Record<string, unknown>;
    const emailClaims = this.valueAsString(claims.email)
      ? (claims as Record<string, unknown>)
      : (userInfo as Record<string, unknown>);
    identity.sub = claims.sub;
    identity.email = emailClaims.email;
    identity.email_verified = emailClaims.email_verified;
    const providerUserId = this.valueAsString(identity.sub);
    const email = this.valueAsString(identity.email);
    if (
      !providerUserId ||
      providerUserId.length > MAX_EXTERNAL_IDENTIFIER_LENGTH ||
      !email
    ) {
      throw new UnauthorizedException(
        'OIDC provider did not return the required subject and email claims',
      );
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail)) {
      throw new UnauthorizedException(
        'OIDC provider returned an invalid email address',
      );
    }

    const name =
      this.valueAsString(identity.name) ||
      [identity.given_name, identity.family_name]
        .map((value) => this.valueAsString(value))
        .filter(Boolean)
        .join(' ');

    const groupClaims = this.extractGroups(identity);
    return {
      providerUserId,
      email: normalizedEmail,
      emailVerified:
        identity.email_verified === true || identity.email_verified === 'true',
      name: name?.trim().slice(0, 50) || undefined,
      groupsProvided: groupClaims.provided,
      groups: groupClaims.groups,
    };
  }

  private identityFromSaml(profile: Profile): ExternalIdentity {
    const identity = profile as Record<string, unknown>;
    const providerUserId = this.valueAsString(profile.nameID);
    const email =
      this.valueAsString(profile.email) ||
      this.valueAsString(profile.mail) ||
      this.valueAsString(profile['urn:oid:0.9.2342.19200300.100.1.3']) ||
      (providerUserId?.includes('@') ? providerUserId : null);

    if (
      !providerUserId ||
      providerUserId.length > MAX_EXTERNAL_IDENTIFIER_LENGTH ||
      !email
    ) {
      throw new UnauthorizedException(
        'SAML provider did not return the required NameID and email claims',
      );
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail)) {
      throw new UnauthorizedException(
        'SAML provider returned an invalid email address',
      );
    }

    const name =
      this.valueAsString(identity.displayName) ||
      this.valueAsString(identity.cn) ||
      [identity.givenName, identity.surname]
        .map((value) => this.valueAsString(value))
        .filter(Boolean)
        .join(' ');

    const groupClaims = this.extractGroups(identity);
    return {
      providerUserId,
      email: normalizedEmail,
      emailVerified: true,
      name: name?.trim().slice(0, 50) || undefined,
      groupsProvided: groupClaims.provided,
      groups: groupClaims.groups,
    };
  }

  private async authenticateLdap(
    provider: AuthProvider,
    username: string,
    password: string,
  ): Promise<ExternalIdentity> {
    const url = await this.endpointPolicy.assertAllowed(
      provider.ldapUrl,
      ['ldap:', 'ldaps:'],
      'LDAP',
    );
    if (!['ldap:', 'ldaps:'].includes(url.protocol)) {
      throw new BadRequestException('LDAP URL must use ldap:// or ldaps://');
    }

    const tlsOptions = {
      rejectUnauthorized: true,
      ...(provider.ldapTlsCaCert
        ? { ca: [provider.ldapTlsCaCert] }
        : undefined),
    };
    const client = new LdapClient({
      url: provider.ldapUrl,
      timeout: 10_000,
      connectTimeout: 10_000,
      ...(url.protocol === 'ldaps:' ? { tlsOptions } : undefined),
    });

    try {
      if (url.protocol === 'ldap:' && provider.ldapTlsEnabled) {
        await client.startTLS(tlsOptions);
      }

      await client.bind(
        provider.ldapBindDn,
        this.decryptSecret(provider.ldapBindPassword),
      );

      const attributes = this.getLdapAttributeMapping(provider);
      const filterTemplate =
        provider.ldapUserSearchFilter || '(mail={{username}})';
      const filter = filterTemplate.replace(
        /\{\{username\}\}/g,
        this.escapeLdapFilterValue(username.trim()),
      );
      const requestedAttributes = Array.from(
        new Set([
          attributes.id,
          attributes.email,
          attributes.name,
          attributes.groups,
          'entryUUID',
          'objectGUID',
        ]),
      ).filter(Boolean);
      const result = await client.search(provider.ldapBaseDn, {
        scope: 'sub',
        filter,
        attributes: requestedAttributes,
        sizeLimit: 2,
        timeLimit: 10,
      });

      if (result.searchEntries.length !== 1) {
        throw new UnauthorizedException('LDAP account was not found');
      }

      const entry = result.searchEntries[0];
      await client.bind(entry.dn, password);
      return this.identityFromLdap(entry, attributes, username);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new UnauthorizedException('LDAP authentication failed');
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  private identityFromLdap(
    entry: LdapEntry,
    attributes: Record<'id' | 'email' | 'name' | 'groups', string>,
    username: string,
  ): ExternalIdentity {
    const email =
      this.ldapValue(entry[attributes.email]) ||
      (username.includes('@') ? username : null);
    const providerUserId =
      this.ldapValue(entry[attributes.id]) ||
      this.ldapValue(entry.entryUUID) ||
      this.ldapValue(entry.objectGUID) ||
      entry.dn;

    const normalizedEmail = email?.trim().toLowerCase();
    if (
      !normalizedEmail ||
      !providerUserId ||
      providerUserId.length > MAX_EXTERNAL_IDENTIFIER_LENGTH ||
      !isEmail(normalizedEmail)
    ) {
      throw new UnauthorizedException(
        'LDAP entry is missing a stable identifier or email address',
      );
    }

    const groupValues = this.ldapValues(entry[attributes.groups]);
    return {
      providerUserId,
      email: normalizedEmail,
      emailVerified: true,
      name:
        this.ldapValue(entry[attributes.name])?.trim().slice(0, 50) ||
        undefined,
      groupsProvided: true,
      groups: groupValues.map((group) => ({
        id: group,
        name: this.ldapGroupName(group),
      })),
    };
  }

  private getLdapAttributeMapping(provider: AuthProvider) {
    const configured =
      provider.ldapUserAttributes &&
      typeof provider.ldapUserAttributes === 'object'
        ? (provider.ldapUserAttributes as Record<string, unknown>)
        : {};

    return {
      id: this.valueAsString(configured.id) || 'entryUUID',
      email: this.valueAsString(configured.email) || 'mail',
      name: this.valueAsString(configured.name) || 'displayName',
      groups: this.valueAsString(configured.groups) || 'memberOf',
    };
  }

  private createSamlClient(
    provider: AuthProvider,
    origin: string,
    cacheProvider: CacheProvider,
  ) {
    return new SAML({
      entryPoint: provider.samlUrl,
      idpCert: provider.samlCertificate,
      issuer: this.buildLoginUrl(origin, 'saml', provider.id),
      callbackUrl: this.buildCallbackUrl(origin, 'saml', provider.id),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: SSO_STATE_TTL_MS,
      cacheProvider,
    });
  }

  private assertSamlResponseTarget(profile: Profile, callbackUrl: string) {
    const responseXml = profile.getSamlResponseXml?.();
    if (!responseXml) {
      throw new UnauthorizedException('Invalid SAML response');
    }

    const parseErrors: unknown[] = [];
    const document = new DOMParser({
      errorHandler: {
        warning: (error) => parseErrors.push(error),
        error: (error) => parseErrors.push(error),
        fatalError: (error) => parseErrors.push(error),
      },
    }).parseFromString(responseXml, 'application/xml');
    const response = document.documentElement;
    const responseName = response?.localName ?? response?.nodeName.split(':').pop();

    if (
      parseErrors.length > 0 ||
      responseName !== 'Response' ||
      response.getAttribute('Destination') !== callbackUrl
    ) {
      throw new UnauthorizedException('Invalid SAML response');
    }

    const subjectConfirmations = document.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'SubjectConfirmationData',
    );
    if (subjectConfirmations.length === 0) {
      throw new UnauthorizedException('Invalid SAML response');
    }

    for (let index = 0; index < subjectConfirmations.length; index += 1) {
      if (subjectConfirmations.item(index)?.getAttribute('Recipient') !== callbackUrl) {
        throw new UnauthorizedException('Invalid SAML response');
      }
    }
  }

  private createSamlCacheProvider(
    providerId: string,
    stateHash: string,
  ): CacheProvider {
    return {
      saveAsync: async (key: string, value: string) => {
        const row = await this.db
          .updateTable('ssoLoginStates')
          .set({ requestId: key, requestValue: value })
          .where('stateHash', '=', stateHash)
          .where('authProviderId', '=', providerId)
          .where('consumedAt', 'is', null)
          .returning(['createdAt'])
          .executeTakeFirst();
        return row ? { value, createdAt: row.createdAt.getTime() } : null;
      },
      getAsync: async (key: string) => {
        const row = await this.db
          .selectFrom('ssoLoginStates')
          .select('requestValue')
          .where('authProviderId', '=', providerId)
          .where('stateHash', '=', stateHash)
          .where('requestId', '=', key)
          .where('expiresAt', '>', new Date())
          .executeTakeFirst();
        return row?.requestValue ?? null;
      },
      removeAsync: async (key: string) => {
        const row = await this.db
          .selectFrom('ssoLoginStates')
          .select('requestValue')
          .where('authProviderId', '=', providerId)
          .where('stateHash', '=', stateHash)
          .where('requestId', '=', key)
          .executeTakeFirst();

        if (!row) {
          return null;
        }

        await this.db
          .updateTable('ssoLoginStates')
          .set({ requestValue: null })
          .where('authProviderId', '=', providerId)
          .where('stateHash', '=', stateHash)
          .where('requestId', '=', key)
          .execute();
        return row.requestValue;
      },
    };
  }

  private async createOidcClient(provider: AuthProvider, callbackUrl: string) {
    const issuer = await this.discoverOidcIssuer(provider);
    return this.createOidcClientFromIssuer(provider, callbackUrl, issuer);
  }

  private createOidcClientFromIssuer(
    provider: AuthProvider,
    callbackUrl: string,
    issuer: Issuer,
  ) {
    return new issuer.Client({
      client_id: provider.oidcClientId,
      client_secret: this.decryptSecret(provider.oidcClientSecret),
      redirect_uris: [callbackUrl],
      response_types: ['code'],
    });
  }

  private async discoverOidcIssuer(provider: AuthProvider) {
    const discoveryUrl = `${provider.oidcIssuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const response = await this.fetchAllowedEndpoint(
      discoveryUrl,
      'OIDC discovery',
    );
    const metadata = await this.readJsonResponse(
      response,
      'OIDC discovery',
    );
    if (metadata.issuer !== provider.oidcIssuer) {
      throw new BadRequestException(
        'OIDC discovery issuer does not match the configured issuer',
      );
    }

    const issuer = new Issuer(metadata as any);
    const metadataEndpoints = [
      issuer.metadata.authorization_endpoint,
      issuer.metadata.token_endpoint,
      issuer.metadata.userinfo_endpoint,
      issuer.metadata.jwks_uri,
    ].filter((value): value is string => Boolean(value));
    for (const endpoint of metadataEndpoints) {
      await this.endpointPolicy.assertAllowed(
        endpoint,
        ['http:', 'https:'],
        'OIDC metadata',
      );
    }
    return issuer;
  }

  private async fetchAllowedEndpoint(
    rawUrl: string,
    label: string,
    method: 'GET' | 'HEAD' = 'GET',
  ): Promise<Response> {
    let currentUrl = rawUrl;

    for (let redirectCount = 0; ; redirectCount += 1) {
      await this.endpointPolicy.assertAllowed(
        currentUrl,
        ['http:', 'https:'],
        label,
      );

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(SSO_HTTP_TIMEOUT_MS),
          headers: {
            accept: 'application/json, text/html;q=0.9, */*;q=0.1',
          },
        });
      } catch {
        throw new BadRequestException(`${label} endpoint is unavailable`);
      }

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }
      if (redirectCount >= SSO_HTTP_MAX_REDIRECTS) {
        throw new BadRequestException(`${label} redirected too many times`);
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new BadRequestException(`${label} returned an invalid redirect`);
      }
      currentUrl = new URL(location, currentUrl).toString();
    }
  }

  private async readJsonResponse(
    response: Response,
    label: string,
  ): Promise<Record<string, any>> {
    if (!response.ok) {
      throw new BadRequestException(`${label} endpoint is unavailable`);
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > SSO_HTTP_MAX_JSON_BYTES) {
      throw new BadRequestException(`${label} response is too large`);
    }
    try {
      return JSON.parse(body) as Record<string, any>;
    } catch {
      throw new BadRequestException(`${label} response is not valid JSON`);
    }
  }

  private async createLoginState(
    input: {
      state: string;
      provider: AuthProvider;
      codeVerifier?: string;
      nonce?: string;
    } & SsoLoginContext,
  ) {
    await this.db
      .insertInto('ssoLoginStates')
      .values({
        stateHash: this.hashState(input.state),
        authProviderId: input.provider.id,
        workspaceId: input.provider.workspaceId,
        purpose: input.purpose ?? 'login',
        userId: input.userId,
        sessionId: input.sessionId,
        spaceId: input.spaceId,
        returnTo: input.returnTo,
        codeVerifier: input.codeVerifier
          ? this.encryptSecret(input.codeVerifier)
          : null,
        nonce: input.nonce,
        expiresAt: new Date(Date.now() + SSO_STATE_TTL_MS),
      })
      .execute();

    await this.db
      .deleteFrom('ssoLoginStates')
      .where('expiresAt', '<', new Date())
      .execute();
  }

  /**
   * Rejects a callback that the initiating browser cannot prove it started.
   *
   * Without this an attacker can run the whole authorization dance themselves
   * and hand the resulting callback URL to a victim, whose browser is then
   * silently signed in as the attacker (OAuth 2.0 login CSRF, RFC 6749 §10.12).
   */
  private assertBrowserBinding(state: string, binding: SsoBrowserBinding) {
    if (!binding.enforced) {
      return;
    }

    if (!binding.value || !safeStringEqual(binding.value, state)) {
      throw new UnauthorizedException(
        'SSO login was not started in this browser',
      );
    }
  }

  private async claimLoginState(
    state: string,
    providerId: string,
    workspaceId: string,
  ): Promise<SsoLoginState> {
    const loginState = await this.db
      .updateTable('ssoLoginStates')
      .set({ consumedAt: new Date() })
      .where('stateHash', '=', this.hashState(state))
      .where('authProviderId', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('expiresAt', '>', new Date())
      .where('consumedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!loginState) {
      throw new UnauthorizedException('SSO login state is invalid or expired');
    }
    return loginState;
  }

  private async requireProvider(
    providerId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const provider = await (trx ?? this.db)
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }
    return provider;
  }

  private async requireEnabledProvider(
    providerId: string,
    workspaceId: string,
    type: SsoProviderType,
  ) {
    const provider = await this.requireProvider(providerId, workspaceId);
    if (!provider.isEnabled || provider.type !== type || !provider.verifiedAt) {
      throw new NotFoundException('SSO provider not found');
    }
    this.validateProviderConfiguration(provider);
    await this.validateProviderEndpoints(provider);
    return provider;
  }

  private validateProviderConfiguration(provider: AuthProvider) {
    if (provider.type === 'oidc') {
      this.requireFields(provider, [
        'oidcIssuer',
        'oidcClientId',
        'oidcClientSecret',
      ]);
      this.assertHttpUrl(provider.oidcIssuer, 'OIDC issuer');
      return;
    }

    if (provider.type === 'saml') {
      this.requireFields(provider, ['samlUrl', 'samlCertificate']);
      this.assertHttpUrl(provider.samlUrl, 'SAML login');
      return;
    }

    if (provider.type === 'ldap') {
      this.requireFields(provider, [
        'ldapUrl',
        'ldapBindDn',
        'ldapBindPassword',
        'ldapBaseDn',
      ]);
      let ldapUrl: URL;
      try {
        ldapUrl = new URL(provider.ldapUrl);
      } catch {
        throw new BadRequestException('LDAP URL is invalid');
      }
      if (!['ldap:', 'ldaps:'].includes(ldapUrl.protocol)) {
        throw new BadRequestException('LDAP URL must use ldap:// or ldaps://');
      }
      if (ldapUrl.username || ldapUrl.password || ldapUrl.hash) {
        throw new BadRequestException(
          'LDAP URL cannot contain credentials or a fragment',
        );
      }
      if (ldapUrl.protocol === 'ldap:' && !provider.ldapTlsEnabled) {
        throw new BadRequestException(
          'LDAP must use LDAPS or enable StartTLS before credentials are sent',
        );
      }
      const filter = provider.ldapUserSearchFilter || '(mail={{username}})';
      if (!filter.includes('{{username}}')) {
        throw new BadRequestException(
          'LDAP user search filter must contain {{username}}',
        );
      }
      const attributes = this.getLdapAttributeMapping(provider);
      if (
        Object.values(attributes).some(
          (attribute) => !/^[a-zA-Z][a-zA-Z0-9;._-]{0,127}$/.test(attribute),
        )
      ) {
        throw new BadRequestException(
          'LDAP attribute names contain unsupported characters',
        );
      }
      return;
    }

    throw new BadRequestException('Unsupported SSO provider type');
  }

  private async validateProviderEndpoints(provider: AuthProvider) {
    if (provider.type === 'oidc') {
      await this.endpointPolicy.assertAllowed(
        provider.oidcIssuer,
        ['http:', 'https:'],
        'OIDC issuer',
      );
      return;
    }

    if (provider.type === 'saml') {
      await this.endpointPolicy.assertAllowed(
        provider.samlUrl,
        ['http:', 'https:'],
        'SAML login',
      );
      return;
    }

    if (provider.type === 'ldap') {
      await this.endpointPolicy.assertAllowed(
        provider.ldapUrl,
        ['ldap:', 'ldaps:'],
        'LDAP',
      );
    }
  }

  private requireFields(
    provider: AuthProvider,
    fields: Array<keyof AuthProvider>,
  ) {
    const missing = fields.filter((field) => !provider[field]);
    if (missing.length) {
      throw new BadRequestException(
        `SSO provider configuration is incomplete: ${missing.join(', ')}`,
      );
    }
  }

  private async assertSsoWillRemainAvailable(
    workspaceId: string,
    excludedProviderId: string,
    trx: KyselyTransaction,
  ) {
    await trx
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (
      !(await this.spacePolicy.hasEffectiveSsoEnforcement(workspaceId, trx))
    ) {
      return;
    }

    const otherProviders = await trx
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('id', '!=', excludedProviderId)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .where('type', 'in', [...SSO_PROVIDER_TYPES])
      .execute();

    const otherProvider =
      await this.hasAllowedEnforcementReadyProvider(otherProviders);

    if (!otherProvider) {
      throw new BadRequestException(
        'At least one verified SSO provider with a successful login is required while SSO is enforced',
      );
    }
  }

  private async hasAllowedEnforcementReadyProvider(
    providers: AuthProvider[],
  ): Promise<boolean> {
    for (const provider of providers) {
      if (!isEnforcementReadyProvider(provider)) {
        continue;
      }

      try {
        await this.validateProviderEndpoints(provider);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private sanitizeProvider(provider: AuthProvider) {
    const { ldapConfig: _, settings: __, ...safeProvider } = provider;
    return {
      ...safeProvider,
      oidcClientSecret: provider.oidcClientSecret ? REDACTED_SECRET : '',
      ldapBindPassword: provider.ldapBindPassword ? REDACTED_SECRET : '',
    };
  }

  private assertSignupDomainAllowed(email: string, workspace: Workspace) {
    const allowedDomains = (workspace.emailDomains || []).map((domain) =>
      domain.toLowerCase(),
    );
    if (!allowedDomains.length) {
      return;
    }

    const domain = email.split('@').pop()?.toLowerCase();
    if (!domain || !allowedDomains.includes(domain)) {
      throw new ForbiddenException(
        'Email domain is not allowed in this workspace',
      );
    }
  }

  private assertActiveUser(user?: User) {
    if (!user || user.deletedAt || user.deactivatedAt) {
      throw new ForbiddenException('Account is not active');
    }
  }

  private assertEmailVerifiedForLinking(identity: ExternalIdentity) {
    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'SSO provider did not verify the email address',
      );
    }
  }

  private extractGroups(identity: Record<string, unknown>) {
    const claimNames = [
      'groups',
      'memberOf',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
      'http://schemas.xmlsoap.org/claims/Group',
    ];
    const claimName = claimNames.find((name) =>
      Object.prototype.hasOwnProperty.call(identity, name),
    );
    if (!claimName) {
      return { provided: false, groups: [] };
    }

    return {
      provided: true,
      groups: this.valuesAsStrings(identity[claimName]).map((group) => ({
        id: group,
        name: group,
      })),
    };
  }

  private valuesAsStrings(value: unknown): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values
      .map((item) => this.valueAsString(item)?.trim())
      .filter((item): item is string => Boolean(item));
  }

  private valueAsString(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (Buffer.isBuffer(value)) {
      return value.toString('base64url');
    }
    return null;
  }

  private ldapValue(
    value: string | string[] | Buffer | Buffer[] | undefined,
  ): string | null {
    return this.ldapValues(value)[0] ?? null;
  }

  private ldapValues(
    value: string | string[] | Buffer | Buffer[] | undefined,
  ): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values
      .map((item) =>
        Buffer.isBuffer(item) ? item.toString('base64url') : String(item),
      )
      .filter(Boolean);
  }

  private ldapGroupName(value: string) {
    const match = /^cn=([^,]+)/i.exec(value);
    return (match?.[1] || value).replace(/\\([,=+<>#;"])/g, '$1').slice(0, 100);
  }

  private escapeLdapFilterValue(value: string) {
    return value
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00');
  }

  private requireSingleString(
    value: string | string[] | undefined,
    field: string,
  ) {
    if (typeof value !== 'string' || !value) {
      throw new BadRequestException(`${field} is required`);
    }
    return value;
  }

  private assertHttpUrl(value: string, label: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`${label} URL is invalid`);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new BadRequestException(`${label} URL must use HTTP or HTTPS`);
    }
    if (parsed.username || parsed.password || parsed.hash) {
      throw new BadRequestException(
        `${label} URL cannot contain credentials or a fragment`,
      );
    }
  }

  private buildLoginUrl(
    origin: string,
    type: 'oidc' | 'saml',
    providerId: string,
  ) {
    return `${origin}/api/sso/${type}/${providerId}/login`;
  }

  private buildCallbackUrl(
    origin: string,
    type: 'oidc' | 'saml',
    providerId: string,
  ) {
    return `${origin}/api/sso/${type}/${providerId}/callback`;
  }

  private hashState(state: string) {
    return hashProtectedValue(state);
  }

  private encryptSecret(value: string) {
    return encryptProtectedValue(value, this.environmentService.getAppSecret());
  }

  private decryptSecret(value?: string | null) {
    if (!value) {
      throw new BadRequestException('SSO provider secret is missing');
    }
    return decryptProtectedValue(value, this.environmentService.getAppSecret());
  }
}
