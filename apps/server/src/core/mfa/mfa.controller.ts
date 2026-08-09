import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { MfaService } from './mfa.service';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import {
  MfaDisableDto,
  MfaEnableDto,
  MfaSetupDto,
  MfaVerifyDto,
} from './dto/mfa.dto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from '../auth/rate-limit/auth-rate-limit.decorator';
import { AuthCookieService } from '../../common/security/auth-cookie.service';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';

@Controller('mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly authCookieService: AuthCookieService,
    private readonly userRepo: UserRepo,
  ) {}

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('bootstrap')
  @HttpCode(HttpStatus.OK)
  @Post('status')
  async status(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.mfaService.getStatus(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('bootstrap')
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() _dto: MfaSetupDto,
  ) {
    return this.mfaService.setup(user, workspace);
  }

  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaVerify', accountField: 'sessionId' })
  @AuthPolicyScope('bootstrap')
  @HttpCode(HttpStatus.OK)
  @Post('enable')
  async enable(
    @Req() req: FastifyRequest,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaEnableDto,
  ) {
    return this.mfaService.enable(
      user,
      workspace.id,
      dto.secret,
      dto.verificationCode,
      (req.raw as any).sessionId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('setup-required')
  async setupRequired(@Req() req: FastifyRequest, @Body() _dto: MfaSetupDto) {
    const token = req.cookies?.authToken;
    if (!token) {
      throw new UnauthorizedException('MFA setup session is missing');
    }
    return this.mfaService.setupWithMfaToken(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('enable-required')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaVerify', accountField: 'authToken' })
  async enableRequired(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: MfaEnableDto,
  ) {
    const token = req.cookies?.authToken;
    if (!token) {
      throw new UnauthorizedException('MFA setup session is missing');
    }
    const result = await this.mfaService.enableWithMfaToken(
      token,
      dto.secret,
      dto.verificationCode,
      req,
    );
    this.authCookieService.setAuthCookies(res, result.authToken);
    return {
      success: result.success,
      backupCodes: result.backupCodes,
    };
  }

  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaVerify', accountField: 'sessionId' })
  @AuthPolicyScope('bootstrap')
  @HttpCode(HttpStatus.OK)
  @Post('step-up')
  async stepUp(
    @Req() req: FastifyRequest,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaVerifyDto,
  ) {
    const sessionId = (req.raw as any).sessionId;
    if (!sessionId) {
      throw new UnauthorizedException('Current session is missing');
    }
    return this.mfaService.stepUp(user, workspace.id, sessionId, dto.code);
  }

  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaVerify', accountField: 'sessionId' })
  @HttpCode(HttpStatus.OK)
  @Post('disable')
  async disable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaDisableDto,
  ) {
    const userWithPassword = await this.userRepo.findById(
      user.id,
      workspace.id,
      {
        includePassword: true,
      },
    );

    if (!userWithPassword) {
      throw new UnauthorizedException('User not found');
    }

    return this.mfaService.disable(userWithPassword, workspace.id, dto);
  }

  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaVerify', accountField: 'sessionId' })
  @HttpCode(HttpStatus.OK)
  @Post('generate-backup-codes')
  async regenerateBackupCodes(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaDisableDto,
  ) {
    const userWithPassword = await this.userRepo.findById(
      user.id,
      workspace.id,
      {
        includePassword: true,
      },
    );

    if (!userWithPassword) {
      throw new UnauthorizedException('User not found');
    }

    return this.mfaService.regenerateBackupCodes(
      userWithPassword,
      workspace.id,
      dto,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaVerify', accountField: 'authToken' })
  async verify(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: MfaVerifyDto,
  ) {
    const mfaToken = req.cookies?.authToken;

    if (!mfaToken) {
      throw new UnauthorizedException('MFA session is missing');
    }

    const { authToken } = await this.mfaService.verifyAndIssueAccessToken(
      mfaToken,
      dto.code,
      req,
    );

    this.authCookieService.setAuthCookies(res, authToken);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('validate-access')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'mfaValidateAccess', accountField: 'authToken' })
  async validateAccess(@Req() req: FastifyRequest) {
    return this.mfaService.validateMfaAccess(req.cookies?.authToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('cancel-login')
  async cancelLogin(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    await this.mfaService.cancelLogin(req.cookies?.authToken);
    this.authCookieService.clearAuthCookies(res);
    return { success: true };
  }
}
