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
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CsrfService } from '../../common/security/csrf.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';

@Controller('mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly environmentService: EnvironmentService,
    private readonly csrfService: CsrfService,
    private readonly userRepo: UserRepo,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('status')
  async status(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.mfaService.getStatus(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() _dto: MfaSetupDto,
  ) {
    return this.mfaService.setup(user, workspace);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('enable')
  async enable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaEnableDto,
  ) {
    return this.mfaService.enable(
      user,
      workspace.id,
      dto.secret,
      dto.verificationCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('disable')
  async disable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaDisableDto,
  ) {
    const userWithPassword = await this.userRepo.findById(user.id, workspace.id, {
      includePassword: true,
    });

    if (!userWithPassword) {
      throw new UnauthorizedException('User not found');
    }

    return this.mfaService.disable(userWithPassword, workspace.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('generate-backup-codes')
  async regenerateBackupCodes(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaDisableDto,
  ) {
    const userWithPassword = await this.userRepo.findById(user.id, workspace.id, {
      includePassword: true,
    });

    if (!userWithPassword) {
      throw new UnauthorizedException('User not found');
    }

    return this.mfaService.regenerateBackupCodes(userWithPassword, workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
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
    );

    this.setAuthCookie(res, authToken);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('validate-access')
  async validateAccess(@Req() req: FastifyRequest) {
    return this.mfaService.validateMfaAccess(req.cookies?.authToken);
  }

  /**
   * Повторяем поведение auth-контроллера:
   * после успешной MFA-проверки кладём полноценный access-token в cookie.
   */
  private setAuthCookie(res: FastifyReply, token: string) {
    const csrfToken = this.csrfService.generateToken();
    const sameSite = this.csrfService.getSameSite();

    res.setCookie('authToken', token, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
      sameSite,
    });

    this.csrfService.setCsrfCookie(res, csrfToken);
  }
}
