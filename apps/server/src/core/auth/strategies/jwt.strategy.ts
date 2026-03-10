import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { JwtApiKeyPayload, JwtPayload, JwtType } from '../dto/jwt-payload';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { FastifyRequest } from 'fastify';
import { extractBearerTokenFromHeader } from '../../../common/helpers';
import { ModuleRef } from '@nestjs/core';
import { ApiKeyService } from '../../api-key/api-key.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private logger = new Logger('JwtStrategy');

  constructor(
    private userRepo: UserRepo,
    private workspaceRepo: WorkspaceRepo,
    private readonly environmentService: EnvironmentService,
    private moduleRef: ModuleRef,
  ) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        const request = req as any;
        const bearerToken = extractBearerTokenFromHeader(req);
        const rawUrl =
          request?.originalUrl ?? request?.raw?.url ?? request?.url ?? '';
        const isRagRoute = rawUrl.startsWith('/api/rag');

        if (isRagRoute) {
          return bearerToken || request.cookies?.authToken;
        }

        return request.cookies?.authToken || bearerToken;
      },
      ignoreExpiration: false,
      secretOrKey: environmentService.getAppSecret(),
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

      if (!this.isRagRoute(req)) {
        throw new UnauthorizedException('API key can only be used on /rag routes');
      }

      return this.validateApiKey(payload as JwtApiKeyPayload);
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

    return { user, workspace };
  }

  private async validateApiKey(payload: JwtApiKeyPayload) {
    const apiKeyService = this.moduleRef.get(ApiKeyService, {
      strict: false,
    });

    if (apiKeyService) {
      return apiKeyService.validateApiKey(payload);
    }

    this.logger.error('ApiKeyService is not available in DI container');
    throw new UnauthorizedException('API key auth is unavailable');
  }

  private isRagRoute(req: any): boolean {
    const rawUrl: string =
      req?.originalUrl ?? req?.raw?.url ?? req?.url ?? '';
    return rawUrl.startsWith('/api/rag');
  }
}
