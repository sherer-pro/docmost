import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SsoService } from './sso.service';
import {
  CreateSsoGroupMappingDto,
  CreateSsoProviderDto,
  LdapLoginDto,
  LdapStepUpDto,
  SsoLoginContextDto,
  SsoGroupMappingIdDto,
  SsoProviderIdDto,
  UpdateSsoGroupMappingDto,
  UpdateSsoProviderDto,
} from './dto/sso.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import { AuthCookieService } from '../../common/security/auth-cookie.service';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from '../auth/rate-limit/auth-rate-limit.decorator';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { SsoAuthenticationResult, SsoBrowserBinding } from './sso.service';

/**
 * Short-lived cookie proving that the browser completing a redirect-based SSO
 * flow is the one that started it.
 */
const SSO_LOGIN_STATE_COOKIE = 'ssoLoginState';
const SSO_LOGIN_STATE_COOKIE_PATH = '/api/sso';
const SSO_LOGIN_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/**
 * Provider ids reach the database directly from the URL. Rejecting a malformed
 * id here keeps an unauthenticated request from turning into a Postgres cast
 * error surfaced as HTTP 500.
 */
export const SSO_PROVIDER_ID_PIPE = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.NOT_FOUND,
  exceptionFactory: () => new NotFoundException('SSO provider not found'),
});

@UseGuards(JwtAuthGuard)
@Controller('sso')
export class SsoController {
  constructor(
    private readonly ssoService: SsoService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('providers')
  async listProviders(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.listProviders(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getProvider(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.getProvider(dto.providerId, workspace.id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('create')
  async createProvider(
    @Body() dto: CreateSsoProviderDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.createProvider(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateProvider(
    @Body() dto: UpdateSsoProviderDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.updateProvider(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('test')
  async testProvider(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.testProvider(dto.providerId, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteProvider(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    await this.ssoService.deleteProvider(dto.providerId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('group-mappings')
  async listGroupMappings(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.listGroupMappings(dto.providerId, workspace.id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('group-mappings/create')
  async createGroupMapping(
    @Body() dto: CreateSsoGroupMappingDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.createGroupMapping(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('group-mappings/update')
  async updateGroupMapping(
    @Body() dto: UpdateSsoGroupMappingDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    return this.ssoService.updateGroupMapping(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('group-mappings/delete')
  async deleteGroupMapping(
    @Body() dto: SsoGroupMappingIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    await this.ssoService.deleteGroupMapping(dto.mappingId, workspace.id);
  }

  @Public()
  @CsrfExempt()
  @Get('oidc/:providerId/login')
  async oidcLogin(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Query() query: SsoLoginContextDto,
    @AuthWorkspace() workspace: Workspace,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const { url, state } = await this.ssoService.getOidcAuthorizeUrl(
      providerId,
      workspace,
      origin,
      query,
    );
    this.setLoginStateCookie(response, state, origin, 'oidc');
    return response.redirect(url, HttpStatus.FOUND);
  }

  @AuthPolicyScope('bootstrap')
  @Get('oidc/:providerId/step-up')
  async oidcStepUp(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Query() query: SsoLoginContextDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const { url, state } = await this.ssoService.getOidcStepUpUrl(
      providerId,
      workspace,
      origin,
      user.id,
      this.getSessionId(request),
      query,
    );
    this.setLoginStateCookie(response, state, origin, 'oidc');
    return response.redirect(url, HttpStatus.FOUND);
  }

  @Public()
  @CsrfExempt()
  @Get('oidc/:providerId/callback')
  async oidcCallback(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const binding = this.readLoginStateBinding(request, origin, 'oidc');
    this.clearLoginStateCookie(response, origin, 'oidc');
    const result = await this.ssoService.completeOidcLogin(
      providerId,
      workspace,
      origin,
      query,
      request,
      binding,
    );
    return this.completeBrowserLogin(response, result);
  }

  @Public()
  @CsrfExempt()
  @Get('saml/:providerId/login')
  async samlLogin(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Query() query: SsoLoginContextDto,
    @AuthWorkspace() workspace: Workspace,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const { url, state } = await this.ssoService.getSamlAuthorizeUrl(
      providerId,
      workspace,
      origin,
      new URL(origin).hostname,
      query,
    );
    this.setLoginStateCookie(response, state, origin, 'saml');
    return response.redirect(url, HttpStatus.FOUND);
  }

  @AuthPolicyScope('bootstrap')
  @Get('saml/:providerId/step-up')
  async samlStepUp(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Query() query: SsoLoginContextDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const { url, state } = await this.ssoService.getSamlStepUpUrl(
      providerId,
      workspace,
      origin,
      user.id,
      this.getSessionId(request),
      query,
    );
    this.setLoginStateCookie(response, state, origin, 'saml');
    return response.redirect(url, HttpStatus.FOUND);
  }

  @Public()
  @CsrfExempt()
  @Post('saml/:providerId/callback')
  async samlCallback(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Body() body: Record<string, string | undefined>,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const binding = this.readLoginStateBinding(request, origin, 'saml');
    this.clearLoginStateCookie(response, origin, 'saml');
    const result = await this.ssoService.completeSamlLogin(
      providerId,
      workspace,
      origin,
      body,
      request,
      binding,
    );
    return this.completeBrowserLogin(response, result);
  }

  @Public()
  @CsrfExempt()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'login', accountField: 'username' })
  @HttpCode(HttpStatus.OK)
  @Post('ldap/:providerId/login')
  async ldapLogin(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Body() dto: LdapLoginDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.ssoService.loginWithLdap(
      providerId,
      workspace,
      dto.username,
      dto.password,
      request,
      { spaceSlug: dto.spaceSlug },
    );
    const token = result.authToken || result.mfaToken;
    this.authCookieService.setAuthCookies(response, token);

    return {
      userHasMfa: result.userHasMfa,
      requiresMfaSetup: result.requiresMfaSetup,
      isMfaEnforced: result.isMfaEnforced,
    };
  }

  @AuthPolicyScope('bootstrap')
  @HttpCode(HttpStatus.OK)
  @Post('ldap/:providerId/step-up')
  async ldapStepUp(
    @Param('providerId', SSO_PROVIDER_ID_PIPE) providerId: string,
    @Body() dto: LdapStepUpDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
  ) {
    return this.ssoService.stepUpWithLdap(
      providerId,
      workspace,
      user,
      this.getSessionId(request),
      dto.username,
      dto.password,
    );
  }

  private completeBrowserLogin(
    response: FastifyReply,
    result: SsoAuthenticationResult,
  ) {
    if (result.stepUp) {
      return response.redirect(result.returnTo || '/home', HttpStatus.FOUND);
    }

    const token = result.authToken || result.mfaToken;
    this.authCookieService.setAuthCookies(response, token);

    if (result.userHasMfa) {
      return response.redirect(
        this.buildAuthenticationRedirect('/login/mfa', result.returnTo),
        HttpStatus.FOUND,
      );
    }
    if (result.requiresMfaSetup) {
      return response.redirect(
        this.buildAuthenticationRedirect(
          '/login/mfa/setup',
          result.returnTo,
        ),
        HttpStatus.FOUND,
      );
    }
    return response.redirect(result.returnTo || '/home', HttpStatus.FOUND);
  }

  private buildAuthenticationRedirect(path: string, returnTo?: string) {
    if (!returnTo) {
      return path;
    }
    const query = new URLSearchParams({ returnTo });
    return `${path}?${query.toString()}`;
  }

  /**
   * Cookie attributes for the login-state cookie.
   *
   * A SAML assertion arrives as a cross-site POST, so the cookie only travels
   * back with `SameSite=None`, which browsers accept on secure origins only.
   * OIDC returns through a top-level GET redirect, where `Lax` is enough.
   */
  private getLoginStateCookieOptions(origin: string, type: 'oidc' | 'saml') {
    const secure = origin.startsWith('https:');
    return {
      httpOnly: true,
      path: SSO_LOGIN_STATE_COOKIE_PATH,
      secure,
      sameSite:
        type === 'saml' && secure ? ('none' as const) : ('lax' as const),
    };
  }

  private setLoginStateCookie(
    response: FastifyReply,
    state: string,
    origin: string,
    type: 'oidc' | 'saml',
  ) {
    response.setCookie(SSO_LOGIN_STATE_COOKIE, state, {
      ...this.getLoginStateCookieOptions(origin, type),
      maxAge: SSO_LOGIN_STATE_COOKIE_MAX_AGE_SECONDS,
    });
  }

  private clearLoginStateCookie(
    response: FastifyReply,
    origin: string,
    type: 'oidc' | 'saml',
  ) {
    response.clearCookie(
      SSO_LOGIN_STATE_COOKIE,
      this.getLoginStateCookieOptions(origin, type),
    );
  }

  /**
   * A cross-site SAML POST over plain HTTP can never carry the cookie back,
   * because `SameSite=None` requires `Secure`. Such deployments keep working,
   * and the residual login-CSRF exposure is the reason SAML needs HTTPS.
   */
  private readLoginStateBinding(
    request: FastifyRequest,
    origin: string,
    type: 'oidc' | 'saml',
  ): SsoBrowserBinding {
    const value = (request as any)?.cookies?.[SSO_LOGIN_STATE_COOKIE];
    const enforced = type === 'oidc' || origin.startsWith('https:');
    return { value, enforced };
  }

  private getSessionId(request: FastifyRequest): string {
    const sessionId = (request.raw as any).sessionId;
    if (!sessionId) {
      throw new ForbiddenException('An active session is required');
    }
    return sessionId;
  }

  private assertCanManage(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
  }
}
