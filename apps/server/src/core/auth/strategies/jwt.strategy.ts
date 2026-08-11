import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { JwtApiKeyPayload, JwtPayload, JwtType } from '../dto/jwt-payload';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { FastifyRequest } from 'fastify';
import { extractBearerTokenFromHeader } from '../../../common/helpers';
import { ApiKeyValidationService } from '../../api-key/api-key-validation.service';
import { SessionActivityService } from '../../session/session-activity.service';
import { JWT_ALGORITHM, JWT_ISSUER } from '../services/token.service';

function isRouteOrDescendant(rawUrl: string, route: string): boolean {
  return (
    rawUrl === route ||
    rawUrl.startsWith(`${route}/`) ||
    rawUrl.startsWith(`${route}?`)
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private userRepo: UserRepo,
    private workspaceRepo: WorkspaceRepo,
    private userSessionRepo: UserSessionRepo,
    private sessionActivityService: SessionActivityService,
    private readonly environmentService: EnvironmentService,
    private readonly apiKeyValidation: ApiKeyValidationService,
  ) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        const request = req as any;
        const bearerToken = extractBearerTokenFromHeader(req);
        const rawUrl =
          request?.originalUrl ?? request?.raw?.url ?? request?.url ?? '';
        const isRagRoute = isRouteOrDescendant(rawUrl, '/api/rag');
        const isMcpRoute = isRouteOrDescendant(rawUrl, '/mcp');

        if (isMcpRoute) {
          return bearerToken;
        }
        if (isRagRoute) {
          return bearerToken || request.cookies?.authToken;
        }

        return request.cookies?.authToken || bearerToken;
      },
      ignoreExpiration: false,
      secretOrKey: environmentService.getAppSecret(),
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload | JwtApiKeyPayload) {
    if (!payload.workspaceId) {
      throw new UnauthorizedException();
    }

    if (req.raw.workspaceId && req.raw.workspaceId !== payload.workspaceId) {
      throw new UnauthorizedException('Workspace does not match');
    }

    if (payload.type === JwtType.API_KEY) {
      if (!payload.spaceId) {
        throw new UnauthorizedException();
      }

      const expectedType = this.getApiKeyType(req);
      if (!expectedType) {
        throw new UnauthorizedException(
          'API key can only be used on /rag or /mcp routes',
        );
      }

      return this.apiKeyValidation.validateApiKey(
        payload as JwtApiKeyPayload,
        expectedType,
      );
    }

    if (payload.type !== JwtType.ACCESS) {
      throw new UnauthorizedException();
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);

    if (!workspace) {
      throw new UnauthorizedException();
    }
    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);

    if (!user || user.deactivatedAt || user.deletedAt) {
      throw new UnauthorizedException();
    }

    // A token without `sessionId` cannot be revoked: logout, session revocation
    // and password reset all operate on `user_sessions` rows. Such tokens are
    // rejected outright rather than silently skipping the revocation check.
    const sessionId = (payload as JwtPayload).sessionId;

    if (!sessionId) {
      throw new UnauthorizedException();
    }

    const session = await this.userSessionRepo.findActiveById(sessionId);

    if (
      !session ||
      session.userId !== payload.sub ||
      session.workspaceId !== payload.workspaceId
    ) {
      throw new UnauthorizedException();
    }

    req.raw.sessionId = sessionId;
    req.raw.userSession = session;
    this.sessionActivityService.trackActivity(
      sessionId,
      payload.sub,
      payload.workspaceId,
    );

    return { user, workspace, session };
  }

  private getApiKeyType(req: any): 'rag' | 'mcp' | null {
    const rawUrl: string = req?.originalUrl ?? req?.raw?.url ?? req?.url ?? '';
    if (isRouteOrDescendant(rawUrl, '/api/rag')) return 'rag';
    if (isRouteOrDescendant(rawUrl, '/mcp')) return 'mcp';
    return null;
  }
}
