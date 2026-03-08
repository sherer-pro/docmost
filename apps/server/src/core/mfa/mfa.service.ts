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
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  decryptProtectedValue,
  encryptProtectedValue,
  hashProtectedValue,
  isHashedProtectedValue,
  safeStringEqual,
  verifyHashedProtectedValue,
} from '../../common/security/credential-protection.util';

@Injectable()
export class MfaService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly environmentService: EnvironmentService,
  ) {}

  /**
   * Verifies login/password and determines whether an MFA challenge is required.
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
   * Creates a temporary TOTP secret and QR code for the user.
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
    if (!this.validateTotp(secret, code, 2)) {
      throw new BadRequestException('Invalid verification code');
    }

    const backupCodes = this.generateBackupCodes();
    const encryptedSecret = encryptProtectedValue(
      secret,
      this.environmentService.getAppSecret(),
    );
    const hashedBackupCodes = this.hashBackupCodes(backupCodes);
    const existing = await this.getUserMfa(user.id, workspaceId);

    if (existing) {
      await this.db
        .updateTable('userMfa')
        .set({
          method: 'totp',
          secret: encryptedSecret,
          isEnabled: true,
          backupCodes: hashedBackupCodes,
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
          secret: encryptedSecret,
          isEnabled: true,
          backupCodes: hashedBackupCodes,
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
    const hashedBackupCodes = this.hashBackupCodes(backupCodes);
    await this.db
      .updateTable('userMfa')
      .set({ backupCodes: hashedBackupCodes, updatedAt: new Date() })
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

    const normalizedCode = code.trim();
    const totpSecret = this.getTotpSecret(mfa.secret);

    let isValid = this.validateTotp(totpSecret, normalizedCode, 1);

    if (!isValid) {
      const consumeResult = this.consumeBackupCode(
        normalizedCode,
        mfa.backupCodes || [],
      );

      if (consumeResult.matched) {
        isValid = true;
        await this.db
          .updateTable('userMfa')
          .set({ backupCodes: consumeResult.remaining, updatedAt: new Date() })
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
      // If this is not an access token, try interpreting it as a temporary MFA token.
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

  private validateTotp(secret: string, token: string, window = 1) {
    const totp = new OTPAuth.TOTP({
      issuer: 'Docmost',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const normalizedToken = token.trim();
    const delta = totp.validate({ token: normalizedToken, window });
    return delta !== null;
  }

  /**
   * Generates one-time backup codes for login.
   */
  private generateBackupCodes() {
    return Array.from({ length: 10 }, () => nanoIdGen(8).toUpperCase());
  }

  private hashBackupCodes(codes: string[]) {
    return codes.map((code) => hashProtectedValue(this.normalizeBackupCode(code)));
  }

  private normalizeBackupCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private getTotpSecret(secret: string): string {
    try {
      return decryptProtectedValue(secret, this.environmentService.getAppSecret());
    } catch {
      throw new BadRequestException('MFA secret is invalid');
    }
  }

  private backupCodeMatches(inputCode: string, storedCode: string): boolean {
    const normalizedInput = this.normalizeBackupCode(inputCode);

    if (isHashedProtectedValue(storedCode)) {
      return verifyHashedProtectedValue(normalizedInput, storedCode);
    }

    const normalizedStored = this.normalizeBackupCode(storedCode);
    return safeStringEqual(
      hashProtectedValue(normalizedInput),
      hashProtectedValue(normalizedStored),
    );
  }

  private consumeBackupCode(inputCode: string, backupCodes: string[]) {
    let matched = false;
    const remaining: string[] = [];

    for (const storedCode of backupCodes) {
      const isMatch = this.backupCodeMatches(inputCode, storedCode);
      if (!matched && isMatch) {
        matched = true;
        continue;
      }

      if (isHashedProtectedValue(storedCode)) {
        remaining.push(storedCode);
      } else {
        remaining.push(
          hashProtectedValue(this.normalizeBackupCode(storedCode)),
        );
      }
    }

    return { matched, remaining };
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
