import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { LoginDto } from '../auth/dto/login.dto';
import { comparePasswordHash, nanoIdGen } from '../../common/helpers';
import { TokenService } from '../auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { MfaDisableDto } from './dto/mfa.dto';

@Injectable()
export class MfaService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
  ) {}

  /**
   * Проверяет логин/пароль и определяет, нужно ли запускать MFA-челлендж.
   */
  async checkMfaRequirements(loginDto: LoginDto, workspace: Workspace) {
    const user = await this.userRepo.findByEmail(loginDto.email, workspace.id, {
      includePassword: true,
      includeUserMfa: true,
    });

    const errorMessage = 'Email or password does not match';
    if (!user || user.deletedAt) {
      throw new UnauthorizedException(errorMessage);
    }

    const isPasswordMatch = await comparePasswordHash(
      loginDto.password,
      user.password,
    );

    if (!isPasswordMatch) {
      throw new UnauthorizedException(errorMessage);
    }

    const hasEnabledMfa = Boolean(user['mfa']?.isEnabled);
    const requiresMfaSetup = Boolean(workspace.enforceMfa && !hasEnabledMfa);

    if (!hasEnabledMfa && !requiresMfaSetup) {
      await this.userRepo.updateLastLogin(user.id, workspace.id);
      const authToken = await this.tokenService.generateAccessToken(user);
      return {
        userHasMfa: false,
        requiresMfaSetup: false,
        isMfaEnforced: Boolean(workspace.enforceMfa),
        authToken,
      };
    }

    const mfaToken = await this.tokenService.generateMfaToken(user, workspace.id);
    return {
      userHasMfa: hasEnabledMfa,
      requiresMfaSetup,
      isMfaEnforced: Boolean(workspace.enforceMfa),
      mfaToken,
    };
  }

  /**
   * Создаёт временный TOTP-секрет и QR-код для пользователя.
   */
  async setup(user: User, workspace: Workspace) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;

    const totp = new OTPAuth.TOTP({
      issuer: 'Docmost',
      label: `${workspace.name || 'Workspace'}:${user.email}`,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const qrCode = await QRCode.toDataURL(totp.toString());

    return {
      method: 'totp',
      qrCode,
      secret,
      manualKey: secret,
    };
  }

  async enable(user: User, workspaceId: string, secret: string, code: string) {
    if (!this.validateTotp(secret, code)) {
      throw new BadRequestException('Invalid verification code');
    }

    const backupCodes = this.generateBackupCodes();
    const existing = await this.getUserMfa(user.id, workspaceId);

    if (existing) {
      await this.db
        .updateTable('userMfa')
        .set({
          method: 'totp',
          secret,
          isEnabled: true,
          backupCodes,
          updatedAt: new Date(),
        })
        .where('userId', '=', user.id)
        .where('workspaceId', '=', workspaceId)
        .execute();
    } else {
      await this.db
        .insertInto('userMfa')
        .values({
          userId: user.id,
          workspaceId,
          method: 'totp',
          secret,
          isEnabled: true,
          backupCodes,
        })
        .execute();
    }

    return { success: true, backupCodes };
  }

  async getStatus(userId: string, workspaceId: string) {
    const mfa = await this.getUserMfa(userId, workspaceId);
    return {
      isEnabled: Boolean(mfa?.isEnabled),
      method: mfa?.method ?? null,
      backupCodesCount: mfa?.backupCodes?.length ?? 0,
    };
  }

  async disable(user: User, workspaceId: string, dto: MfaDisableDto) {
    await this.assertPasswordIfNeeded(user, dto);

    await this.db
      .deleteFrom('userMfa')
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspaceId)
      .execute();

    return { success: true };
  }

  async regenerateBackupCodes(user: User, workspaceId: string, dto: MfaDisableDto) {
    await this.assertPasswordIfNeeded(user, dto);

    const mfa = await this.getUserMfa(user.id, workspaceId);
    if (!mfa?.isEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    const backupCodes = this.generateBackupCodes();
    await this.db
      .updateTable('userMfa')
      .set({ backupCodes, updatedAt: new Date() })
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspaceId)
      .execute();

    return { backupCodes };
  }

  async verifyAndIssueAccessToken(token: string, code: string) {
    const payload = await this.tokenService.verifyJwt(token, 'mfa_token');
    const user = await this.userRepo.findById(payload.sub, payload.workspaceId, {
      includeUserMfa: true,
    });

    if (!user || user.deletedAt || user.deactivatedAt) {
      throw new UnauthorizedException('Invalid MFA session');
    }

    const mfa = user['mfa'];
    if (!mfa?.isEnabled || !mfa.secret) {
      throw new BadRequestException('MFA is not enabled for this account');
    }

    let isValid = this.validateTotp(mfa.secret, code);

    if (!isValid) {
      const backupCodes = mfa.backupCodes || [];
      if (backupCodes.includes(code)) {
        isValid = true;
        const updatedCodes = backupCodes.filter((item) => item !== code);

        await this.db
          .updateTable('userMfa')
          .set({ backupCodes: updatedCodes, updatedAt: new Date() })
          .where('userId', '=', user.id)
          .where('workspaceId', '=', payload.workspaceId)
          .execute();
      }
    }

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.userRepo.updateLastLogin(user.id, payload.workspaceId);
    const authToken = await this.tokenService.generateAccessToken({
      ...user,
      workspaceId: payload.workspaceId,
    });

    return { authToken };
  }

  async validateMfaAccess(token?: string) {
    if (!token) {
      return { valid: false };
    }

    try {
      await this.tokenService.verifyJwt(token, 'access');
      return { valid: true, isTransferToken: false };
    } catch {
      // Если это не access-token, пробуем интерпретировать его как временный MFA-token.
    }

    try {
      const payload = await this.tokenService.verifyJwt(token, 'mfa_token');
      const user = await this.userRepo.findById(payload.sub, payload.workspaceId, {
        includeUserMfa: true,
      });

      if (!user) {
        return { valid: false };
      }

      return {
        valid: true,
        isTransferToken: true,
        requiresMfaSetup: !user['mfa']?.isEnabled,
        userHasMfa: Boolean(user['mfa']?.isEnabled),
        isMfaEnforced: false,
      };
    } catch {
      return { valid: false };
    }
  }

  private async assertPasswordIfNeeded(user: User, dto: MfaDisableDto) {
    if (user.hasGeneratedPassword) {
      return;
    }

    if (!dto.confirmPassword) {
      throw new BadRequestException('Password is required');
    }

    const validPassword = await comparePasswordHash(
      dto.confirmPassword,
      user.password,
    );

    if (!validPassword) {
      throw new BadRequestException('Invalid password');
    }
  }

  private validateTotp(secret: string, token: string) {
    const totp = new OTPAuth.TOTP({
      issuer: 'Docmost',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  }

  /**
   * Генерирует одноразовые резервные коды для входа.
   */
  private generateBackupCodes() {
    return Array.from({ length: 10 }, () => nanoIdGen(8).toUpperCase());
  }

  private async getUserMfa(userId: string, workspaceId: string) {
    return this.db
      .selectFrom('userMfa')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }
}
