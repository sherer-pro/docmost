import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TokenService } from '../auth/services/token.service';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { User } from '@docmost/db/types/entity.types';
import { FastifyRequest } from 'fastify';
import { getClientIpFromFastifyRequest } from '../../common/security/trusted-proxy.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';

const MAX_SESSIONS_PER_USER = 25;
const RETENTION_DAYS = 7;

export interface SessionAssuranceContext {
  ssoAuthProviderId?: string | null;
  mfaVerified?: boolean;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly environmentService: EnvironmentService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  @Interval('session-cleanup', 24 * 60 * 60 * 1000)
  async cleanupSessions(): Promise<void> {
    try {
      await this.userSessionRepo.deleteStale(RETENTION_DAYS);
      await this.userSessionRepo.trimExcessSessions(MAX_SESSIONS_PER_USER);
      this.logger.debug('Session cleanup completed');
    } catch (err) {
      this.logger.error('Session cleanup failed', err);
    }
  }

  async createSessionAndToken(
    user: User,
    request?: FastifyRequest,
    assurance: SessionAssuranceContext = {},
  ): Promise<string> {
    const userAgent = this.getUserAgent(request);
    const session = await this.userSessionRepo.insertSession({
      userId: user.id,
      workspaceId: user.workspaceId,
      deviceName: this.parseDeviceName(userAgent),
      userAgent,
      ipAddress: this.getIpAddress(request),
      expiresAt: this.environmentService.getCookieExpiresIn(),
      ssoVerifiedAt: assurance.ssoAuthProviderId ? new Date() : null,
      ssoAuthProviderId: assurance.ssoAuthProviderId ?? null,
      mfaVerifiedAt: assurance.mfaVerified ? new Date() : null,
    });

    return this.tokenService.generateAccessToken(user, session.id);
  }

  async getActiveSessions(
    userId: string,
    workspaceId: string,
    currentSessionId: string | null,
  ) {
    const sessions = await this.userSessionRepo.findActiveByUser(
      userId,
      workspaceId,
    );

    return sessions
      .map((session) => ({
        id: session.id,
        deviceName: session.deviceName,
        geoLocation: session.geoLocation,
        lastActiveAt: session.lastActiveAt,
        createdAt: session.createdAt,
        isCurrentDevice: session.id === currentSessionId,
      }))
      .sort((a, b) => {
        if (a.isCurrentDevice) return -1;
        if (b.isCurrentDevice) return 1;
        return 0;
      });
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.userSessionRepo.revokeById(sessionId, userId, workspaceId);
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId,
      userId,
      sessionId,
    });
  }

  async revokeAllOtherSessions(
    currentSessionId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.userSessionRepo.revokeAllExceptCurrent(
      currentSessionId,
      userId,
      workspaceId,
    );
    await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
      workspaceId,
      userId,
    });
  }

  private getUserAgent(request?: FastifyRequest): string | null {
    const header = request?.headers?.['user-agent'];
    return Array.isArray(header) ? header[0] ?? null : header ?? null;
  }

  private getIpAddress(request?: FastifyRequest): string | null {
    return getClientIpFromFastifyRequest(request);
  }

  private parseDeviceName(userAgent: string | null): string | null {
    if (!userAgent) {
      return null;
    }

    const browser = this.matchFirst(userAgent, [
      ['Edg/', 'Edge'],
      ['OPR/', 'Opera'],
      ['Chrome/', 'Chrome'],
      ['Firefox/', 'Firefox'],
      ['Safari/', 'Safari'],
    ]);

    const os = this.matchFirst(userAgent, [
      ['Windows NT', 'Windows'],
      ['Mac OS X', 'macOS'],
      ['Android', 'Android'],
      ['iPhone', 'iPhone'],
      ['iPad', 'iPad'],
      ['Linux', 'Linux'],
    ]);

    if (browser && os) {
      return `${browser} on ${os}`;
    }

    return browser || os || null;
  }

  private matchFirst(
    value: string,
    patterns: Array<[pattern: string, label: string]>,
  ): string | null {
    return patterns.find(([pattern]) => value.includes(pattern))?.[1] ?? null;
  }
}
