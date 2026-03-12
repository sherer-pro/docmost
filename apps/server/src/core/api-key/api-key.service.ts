import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  CreateApiKeyDto,
  ListApiKeysDto,
  RevokeApiKeyDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';
import { UserRole } from '../../common/helpers/types/permission';
import { TokenService } from '../auth/services/token.service';
import { JwtApiKeyPayload } from '../auth/dto/jwt-payload';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  private isAdminOrOwner(user: User) {
    return [UserRole.OWNER, UserRole.ADMIN].includes(user.role as UserRole);
  }

  private assertCanUseAdminView(user: User, adminView?: boolean) {
    if (adminView && !this.isAdminOrOwner(user)) {
      throw new ForbiddenException('Only workspace admins can manage API keys');
    }
  }

  private assertCanManageApiKey(user: User, creatorId: string) {
    if (this.isAdminOrOwner(user)) {
      return;
    }

    if (creatorId !== user.id) {
      throw new ForbiddenException('You can only manage your own API keys');
    }
  }

  private async assertCanCreateApiKeyInSpace(
    user: User,
    workspace: Workspace,
    spaceId: string,
  ) {
    const space = await this.spaceRepo.findById(spaceId, workspace.id);
    if (!space || space.workspaceId !== workspace.id) {
      throw new NotFoundException('Space not found');
    }

    if (this.isAdminOrOwner(user)) {
      return;
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      spaceId,
    );
    if (!userSpaceRoles?.length) {
      throw new ForbiddenException('You do not have access to this space');
    }
  }

  private parseExpiry(expiresAt?: string): Date | null {
    if (!expiresAt) {
      return null;
    }

    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid expiration date');
    }

    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException('Expiration date must be in the future');
    }

    return parsed;
  }

  private getTokenExpiresIn(expiresAt: Date | null): number | string {
    if (!expiresAt) {
      // Keep API keys effectively non-expiring on JWT layer.
      // Hard expiry is enforced by api_keys.expires_at in validateApiKey().
      return '100y';
    }

    const secondsToExpire = Math.floor(
      (expiresAt.getTime() - Date.now()) / 1000,
    );

    if (secondsToExpire <= 0) {
      throw new BadRequestException('Expiration date must be in the future');
    }

    return secondsToExpire;
  }

  async listApiKeys(user: User, workspace: Workspace, dto: ListApiKeysDto) {
    this.assertCanUseAdminView(user, dto.adminView);

    const creatorId =
      dto.adminView && this.isAdminOrOwner(user) ? undefined : user.id;

    return this.apiKeyRepo.listApiKeys(workspace.id, dto, { creatorId });
  }

  async createApiKey(user: User, workspace: Workspace, dto: CreateApiKeyDto) {
    await this.assertCanCreateApiKeyInSpace(user, workspace, dto.spaceId);

    const expiresAt = this.parseExpiry(dto.expiresAt);

    const createdKey = await this.apiKeyRepo.insertApiKey({
      name: dto.name,
      creatorId: user.id,
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      expiresAt,
    });

    const token = await this.tokenService.generateApiToken({
      apiKeyId: createdKey.id,
      user,
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      expiresIn: this.getTokenExpiresIn(expiresAt),
    });

    const keyWithRelations = await this.apiKeyRepo.findById(createdKey.id, {
      includeCreator: true,
      includeSpace: true,
    });

    return {
      ...keyWithRelations,
      token,
    };
  }

  async updateApiKey(user: User, workspace: Workspace, dto: UpdateApiKeyDto) {
    const existing = await this.apiKeyRepo.findById(dto.apiKeyId);
    if (
      !existing ||
      existing.workspaceId !== workspace.id ||
      existing.deletedAt
    ) {
      throw new NotFoundException('API key not found');
    }

    this.assertCanManageApiKey(user, existing.creatorId);

    await this.apiKeyRepo.updateApiKey(dto.apiKeyId, {
      name: dto.name,
    });

    return this.apiKeyRepo.findById(dto.apiKeyId, {
      includeCreator: true,
      includeSpace: true,
    });
  }

  async revokeApiKey(user: User, workspace: Workspace, dto: RevokeApiKeyDto) {
    const existing = await this.apiKeyRepo.findById(dto.apiKeyId);
    if (
      !existing ||
      existing.workspaceId !== workspace.id ||
      existing.deletedAt
    ) {
      throw new NotFoundException('API key not found');
    }

    this.assertCanManageApiKey(user, existing.creatorId);

    await this.apiKeyRepo.updateApiKey(dto.apiKeyId, {
      deletedAt: new Date(),
    });
  }

  async validateApiKey(payload: JwtApiKeyPayload) {
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

    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const [workspace, user, space] = await Promise.all([
      this.workspaceRepo.findById(payload.workspaceId),
      this.userRepo.findById(payload.sub, payload.workspaceId),
      this.spaceRepo.findById(payload.spaceId, payload.workspaceId),
    ]);

    if (!workspace || !space || !user || user.deletedAt || user.deactivatedAt) {
      throw new UnauthorizedException('API key is invalid');
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
