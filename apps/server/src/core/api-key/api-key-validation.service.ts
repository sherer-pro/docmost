import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { JwtApiKeyPayload } from '../auth/dto/jwt-payload';
import { UserRole } from '../../common/helpers/types/permission';

@Injectable()
export class ApiKeyValidationService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async validateApiKey(
    payload: JwtApiKeyPayload,
    expectedType: 'rag' | 'mcp' = 'rag',
  ) {
    const apiKey = await this.apiKeyRepo.findById(payload.apiKeyId);

    if (!apiKey || apiKey.deletedAt) {
      throw new UnauthorizedException('API key is invalid');
    }

    if (
      apiKey.workspaceId !== payload.workspaceId ||
      apiKey.spaceId !== payload.spaceId ||
      apiKey.creatorId !== payload.sub
    ) {
      throw new UnauthorizedException('API key is invalid');
    }
    if (
      apiKey.keyType !== expectedType ||
      (payload.keyType !== undefined && payload.keyType !== apiKey.keyType)
    ) {
      throw new UnauthorizedException('API key type is invalid');
    }

    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const [workspace, user, space] = await Promise.all([
      this.workspaceRepo.findById(payload.workspaceId),
      this.userRepo.findById(payload.sub, payload.workspaceId),
      this.spaceRepo.findById(payload.spaceId, payload.workspaceId),
    ]);

    if (
      !workspace ||
      workspace.deletedAt ||
      !space ||
      space.archivedAt ||
      !user ||
      user.deletedAt ||
      user.deactivatedAt
    ) {
      throw new UnauthorizedException('API key is invalid');
    }

    if (![UserRole.OWNER, UserRole.ADMIN].includes(user.role as UserRole)) {
      const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
        user.id,
        apiKey.spaceId,
      );

      if (!userSpaceRoles?.length) {
        throw new UnauthorizedException('API key is invalid');
      }
    }

    await this.apiKeyRepo.updateApiKey(apiKey.id, {
      lastUsedAt: new Date(),
    });

    return {
      user,
      workspace,
      space,
      authType: 'api_key',
      apiKey,
    };
  }
}
