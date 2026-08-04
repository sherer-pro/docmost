import {
  BadRequestException,
  Injectable,
  Optional,
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
import { FastifyRequest } from 'fastify';
import { SessionService } from '../session/session.service';
import {
  decryptProtectedValue,
  encryptProtectedValue,
  hashProtectedValue,
  isHashedProtectedValue,
  safeStringEqual,
  verifyHashedProtectedValue,
} from '../../common/security/credential-protection.util';
import { AuthenticationAssuranceService } from '../space-policy/authentication-assurance.service';
import { SpacePolicyService } from '../space-policy/space-policy.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';

@Injectable()
export class MfaService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly userRepo: UserRepo,
    private readonly environmentService: EnvironmentService,
    private readonly authenticationAssurance: AuthenticationAssuranceService,
    private readonly spacePolicy: SpacePolicyService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Verifies login/password and determines whether an MFA challenge is required.
   */
  async checkMfaRequirements(
    loginDto: LoginDto,
    workspace: Workspace,
    request?: FastifyRequest,
  ) {
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

    const target = loginDto.spaceSlug
      ? await this.spacePolicy.resolveAccessibleTarget(
          workspace,
          user,
          loginDto.spaceSlug,
        )
      : null;

    if (loginDto.spaceSlug && !target) {
      throw new UnauthorizedException(errorMessage);
    }

    const effectivePolicy = target?.policy.effective ??
      this.spacePolicy.getWorkspaceValues(workspace);
    if (effectivePolicy.enforceSso) {
      throw new BadRequestException('This scope requires SSO login.');
    }

    return this.issueLoginTokenForUser(user, workspace, request, {
      enforceMfa: effectivePolicy.enforceMfa,
      targetSpaceId: target?.space.id,
    });
  }

  /**
   * Determines whether an already authenticated user must complete MFA.
   */
  async issueLoginTokenForUser(
    user: User,
    workspace: Workspace,
    request?: FastifyRequest,
    context: {
      enforceMfa?: boolean;
      ssoAuthProviderId?: string;
      targetSpaceId?: string;
    } = {},
  ) {
    const userWithMfa = await this.userRepo.findById(user.id, workspace.id, {
      includeUserMfa: true,
    });

    if (
      !userWithMfa ||
      userWithMfa.deletedAt ||
      userWithMfa.deactivatedAt
    ) {
      throw new UnauthorizedException('Account is not active');
    }

    const hasEnabledMfa = Boolean(userWithMfa['mfa']?.isEnabled);
    const isMfaEnforced = context.enforceMfa ?? Boolean(workspace.enforceMfa);
    const requiresMfaSetup = Boolean(isMfaEnforced && !hasEnabledMfa);

    if (!hasEnabledMfa && !requiresMfaSetup) {
      await this.userRepo.updateLastLogin(userWithMfa.id, workspace.id);
      const authToken = await this.sessionService.createSessionAndToken(
        {
          ...userWithMfa,
          workspaceId: workspace.id,
        },
        request,
        { ssoAuthProviderId: context.ssoAuthProviderId },
      );
      return {
        userHasMfa: false,
        requiresMfaSetup: false,
        isMfaEnforced,
        authToken,
      };
    }

    const mfaToken = await this.tokenService.generateMfaToken(
      userWithMfa,
      workspace.id,
      {
        ssoAuthProviderId: context.ssoAuthProviderId,
        targetSpaceId: context.targetSpaceId,
      },
    );
    return {
      userHasMfa: hasEnabledMfa,
      requiresMfaSetup,
      isMfaEnforced,
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

  async enable(
    user: User,
    workspaceId: string,
    secret: string,
    code: string,
    sessionId?: string,
  ) {
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

    if (sessionId) {
      await this.authenticationAssurance.markMfaVerified(sessionId);
      await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
        workspaceId,
        userId: user.id,
        sessionId,
      });
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

    await this.authenticationAssurance.clearMfaForUser(user.id, workspaceId);
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId,
      userId: user.id,
    });

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

  async verifyAndIssueAccessToken(
    token: string,
    code: string,
    request?: FastifyRequest,
  ) {
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
    const authToken = await this.sessionService.createSessionAndToken(
      {
        ...user,
        workspaceId: payload.workspaceId,
      },
      request,
      {
        mfaVerified: true,
        ssoAuthProviderId: payload.ssoAuthProviderId,
      },
    );

    return { authToken };
  }

  async setupWithMfaToken(token: string) {
    const { user, workspace } = await this.resolveMfaSetupPrincipal(token);
    return this.setup(user, workspace);
  }

  async enableWithMfaToken(
    token: string,
    secret: string,
    code: string,
    request?: FastifyRequest,
  ) {
    const payload = await this.tokenService.verifyJwt(token, 'mfa_token');
    const { user } = await this.resolveMfaSetupPrincipal(token);
    const enabled = await this.enable(
      user,
      payload.workspaceId,
      secret,
      code,
    );
    await this.userRepo.updateLastLogin(user.id, payload.workspaceId);
    const authToken = await this.sessionService.createSessionAndToken(
      { ...user, workspaceId: payload.workspaceId },
      request,
      {
        mfaVerified: true,
        ssoAuthProviderId: payload.ssoAuthProviderId,
      },
    );
    return { ...enabled, authToken };
  }

  async stepUp(
    user: User,
    workspaceId: string,
    sessionId: string,
    code: string,
  ) {
    const userWithMfa = await this.userRepo.findById(user.id, workspaceId, {
      includeUserMfa: true,
    });
    const mfa = userWithMfa?.['mfa'];
    if (!userWithMfa || !mfa?.isEnabled || !mfa.secret) {
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
          .where('workspaceId', '=', workspaceId)
          .execute();
      }
    }

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.authenticationAssurance.markMfaVerified(sessionId);
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId,
      userId: user.id,
      sessionId,
    });
    return { success: true };
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

  private async resolveMfaSetupPrincipal(token: string) {
    const payload = await this.tokenService.verifyJwt(token, 'mfa_token');
    const [user, workspace] = await Promise.all([
      this.userRepo.findById(payload.sub, payload.workspaceId, {
        includeUserMfa: true,
      }),
      this.db
        .selectFrom('workspaces')
        .selectAll()
        .where('id', '=', payload.workspaceId)
        .executeTakeFirst(),
    ]);
    if (
      !user ||
      !workspace ||
      user.deletedAt ||
      user.deactivatedAt ||
      user['mfa']?.isEnabled
    ) {
      throw new UnauthorizedException('Invalid MFA setup session');
    }
    return { user, workspace };
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
