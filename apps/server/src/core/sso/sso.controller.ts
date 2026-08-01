import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SsoService } from './sso.service';
import {
  CreateSsoProviderDto,
  LdapLoginDto,
  SsoProviderIdDto,
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
  @Post('delete')
  async deleteProvider(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanManage(user, workspace);
    await this.ssoService.deleteProvider(dto.providerId, workspace.id);
  }

  @Public()
  @CsrfExempt()
  @Get('oidc/:providerId/login')
  async oidcLogin(
    @Param('providerId') providerId: string,
    @AuthWorkspace() workspace: Workspace,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const url = await this.ssoService.getOidcAuthorizeUrl(
      providerId,
      workspace,
      origin,
    );
    return response.redirect(url);
  }

  @Public()
  @CsrfExempt()
  @Get('oidc/:providerId/callback')
  async oidcCallback(
    @Param('providerId') providerId: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const result = await this.ssoService.completeOidcLogin(
      providerId,
      workspace,
      origin,
      query,
      request,
    );
    return this.completeBrowserLogin(response, result);
  }

  @Public()
  @CsrfExempt()
  @Get('saml/:providerId/login')
  async samlLogin(
    @Param('providerId') providerId: string,
    @AuthWorkspace() workspace: Workspace,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const url = await this.ssoService.getSamlAuthorizeUrl(
      providerId,
      workspace,
      origin,
      new URL(origin).hostname,
    );
    return response.redirect(url);
  }

  @Public()
  @CsrfExempt()
  @Post('saml/:providerId/callback')
  async samlCallback(
    @Param('providerId') providerId: string,
    @Body() body: Record<string, string | undefined>,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const origin = this.ssoService.getWorkspaceOrigin(workspace);
    const result = await this.ssoService.completeSamlLogin(
      providerId,
      workspace,
      origin,
      body,
      request,
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
    @Param('providerId') providerId: string,
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
    );
    const token = result.authToken || result.mfaToken;
    this.authCookieService.setAuthCookies(response, token);

    return {
      userHasMfa: result.userHasMfa,
      requiresMfaSetup: result.requiresMfaSetup,
      isMfaEnforced: result.isMfaEnforced,
    };
  }

  private completeBrowserLogin(
    response: FastifyReply,
    result: {
      authToken?: string;
      mfaToken?: string;
      userHasMfa: boolean;
      requiresMfaSetup: boolean;
    },
  ) {
    const token = result.authToken || result.mfaToken;
    this.authCookieService.setAuthCookies(response, token);

    if (result.userHasMfa) {
      return response.redirect('/login/mfa');
    }
    if (result.requiresMfaSetup) {
      return response.redirect('/login/mfa/setup');
    }
    return response.redirect('/home');
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
