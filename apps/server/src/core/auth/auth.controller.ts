import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './services/auth.service';
import { SetupGuard } from './guards/setup.guard';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { VerifyUserTokenDto } from './dto/verify-user-token.dto';
import { FastifyReply } from 'fastify';
import { validateSsoEnforcement } from './auth.util';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { AuthRateLimitGuard } from './rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from './rate-limit/auth-rate-limit.decorator';
import { MfaService } from '../mfa/mfa.service';
import { AuthCookieService } from '../../common/security/auth-cookie.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private authCookieService: AuthCookieService,
    private mfaService: MfaService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  @CsrfExempt()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'login', accountField: 'email' })
  async login(
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() loginInput: LoginDto,
  ) {
    validateSsoEnforcement(workspace);

    const mfaResult = await this.mfaService.checkMfaRequirements(
      loginInput,
      workspace,
    );

    if (mfaResult.userHasMfa || mfaResult.requiresMfaSetup) {
      this.authCookieService.setAuthCookies(res, mfaResult.mfaToken);
      return {
        userHasMfa: mfaResult.userHasMfa,
        requiresMfaSetup: mfaResult.requiresMfaSetup,
        isMfaEnforced: mfaResult.isMfaEnforced,
      };
    }

    this.authCookieService.setAuthCookies(res, mfaResult.authToken);
  }

  @UseGuards(SetupGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  @CsrfExempt()
  async setupWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() createAdminUserDto: CreateAdminUserDto,
  ) {
    const { workspace, authToken } =
      await this.authService.setup(createAdminUserDto);

    this.authCookieService.setAuthCookies(res, authToken);
    return workspace;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.changePassword(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  @CsrfExempt()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'forgotPassword', accountField: 'email' })
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    validateSsoEnforcement(workspace);
    return this.authService.forgotPassword(forgotPasswordDto, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset')
  @CsrfExempt()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'passwordReset', accountField: 'token' })
  async passwordReset(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() passwordResetDto: PasswordResetDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const result = await this.authService.passwordReset(
      passwordResetDto,
      workspace,
    );

    if (result.requiresLogin) {
      return {
        requiresLogin: true,
      };
    }

    // Set auth cookie if no MFA is required
    this.authCookieService.setAuthCookies(res, result.authToken);
    return {
      requiresLogin: false,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-token')
  @CsrfExempt()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'verifyToken', accountField: 'token' })
  async verifyResetToken(
    @Body() verifyUserTokenDto: VerifyUserTokenDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.verifyUserToken(verifyUserTokenDto, workspace.id);
  }

  /**
   * Issues a token for the collab service.
   *
   * The primary token retrieval flow is read-only, so we support
   * a GET route to remove CSRF dependency during the initial UI load.
   * POST remains for backward compatibility with older client builds.
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Get('collab-token')
  @Post('collab-token')
  async collabToken(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.getCollabToken(user, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @CsrfExempt()
  async logout(@Res({ passthrough: true }) res: FastifyReply) {
    this.authCookieService.clearAuthCookies(res);
  }
}
