import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
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
import { AiBuiltinToolCapability } from '@docmost/api-contract';
import {
  AI_BUILTIN_TOOL_POLICY_RESOLVER,
  AiBuiltinToolPolicyResolver,
} from '../ai/tools/ai-builtin-tool-policy.token';
import { ApiKeyValidationService } from './api-key-validation.service';

/**
 * Ceiling for API key JWTs created without an explicit expiry date. The key row
 * remains the authority on revocation; this only stops a leaked token from being
 * replayable indefinitely.
 */
const API_KEY_DEFAULT_TOKEN_EXPIRES_IN = '365d';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    @Inject(AI_BUILTIN_TOOL_POLICY_RESOLVER)
    private readonly builtinToolPolicy: AiBuiltinToolPolicyResolver,
    private readonly apiKeyValidation: ApiKeyValidationService,
  ) {}

  private async resolveMcpCapabilities(
    dtoCapabilities: AiBuiltinToolCapability[] | undefined,
    workspaceId: string,
    spaceId: string,
  ): Promise<AiBuiltinToolCapability[]> {
    if (!dtoCapabilities?.length) {
      throw new BadRequestException(
        'Select at least one capability for an MCP API key',
      );
    }
    const effective = new Set(
      await this.builtinToolPolicy.getEffectiveCapabilities(
        workspaceId,
        spaceId,
        'mcp',
      ),
    );
    const invalid = dtoCapabilities.find(
      (capability) => !effective.has(capability),
    );
    if (invalid) {
      throw new BadRequestException(
        `MCP capability is not allowed in this space: ${invalid}`,
      );
    }
    return [...new Set(dtoCapabilities)];
  }

  private isAdminOrOwner(user: User) {
    return [UserRole.OWNER, UserRole.ADMIN].includes(user.role as UserRole);
  }

  private assertCanManageApiKeys(user: User) {
    if (!this.isAdminOrOwner(user)) {
      throw new ForbiddenException('Only workspace admins can manage API keys');
    }
  }

  private async assertCanCreateApiKeyInSpace(
    user: User,
    workspace: Workspace,
    spaceId: string,
  ) {
    const space = await this.spaceRepo.findById(spaceId, workspace.id);
    if (!space || space.workspaceId !== workspace.id || space.archivedAt) {
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
      // Bound the JWT even when no explicit expiry was requested, so a leaked
      // token is not usable forever. Hard expiry is still enforced by
      // api_keys.expires_at in validateApiKey().
      return API_KEY_DEFAULT_TOKEN_EXPIRES_IN;
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
    this.assertCanManageApiKeys(user);

    return this.apiKeyRepo.listApiKeys(workspace.id, dto, {
      keyType: dto.keyType,
    });
  }

  async createApiKey(user: User, workspace: Workspace, dto: CreateApiKeyDto) {
    this.assertCanManageApiKeys(user);
    const keyType = dto.keyType ?? 'rag';
    await this.assertCanCreateApiKeyInSpace(user, workspace, dto.spaceId);

    const expiresAt = this.parseExpiry(dto.expiresAt);
    if (keyType === 'rag' && dto.allowedCapabilities !== undefined) {
      throw new BadRequestException(
        'Tool capabilities are only supported by MCP API keys',
      );
    }
    const allowedCapabilities =
      keyType === 'mcp'
        ? await this.resolveMcpCapabilities(
            dto.allowedCapabilities,
            workspace.id,
            dto.spaceId,
          )
        : null;

    const createdKey = await this.apiKeyRepo.insertApiKey({
      name: dto.name,
      creatorId: user.id,
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      keyType,
      allowedCapabilities: allowedCapabilities as never,
      expiresAt,
    });

    const token = await this.tokenService.generateApiToken({
      apiKeyId: createdKey.id,
      user,
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      keyType,
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
    this.assertCanManageApiKeys(user);
    const existing = await this.apiKeyRepo.findById(dto.apiKeyId);
    if (
      !existing ||
      existing.workspaceId !== workspace.id ||
      existing.deletedAt
    ) {
      throw new NotFoundException('API key not found');
    }
    if (existing.keyType !== 'mcp' && dto.allowedCapabilities !== undefined) {
      throw new BadRequestException(
        'Tool capabilities are only supported by MCP API keys',
      );
    }

    await this.apiKeyRepo.updateApiKey(dto.apiKeyId, {
      name: dto.name,
      ...(existing.keyType === 'mcp' && dto.allowedCapabilities !== undefined
        ? {
            allowedCapabilities: (await this.resolveMcpCapabilities(
              dto.allowedCapabilities,
              workspace.id,
              existing.spaceId,
            )) as never,
          }
        : {}),
    });

    return this.apiKeyRepo.findById(dto.apiKeyId, {
      includeCreator: true,
      includeSpace: true,
    });
  }

  async revokeApiKey(user: User, workspace: Workspace, dto: RevokeApiKeyDto) {
    this.assertCanManageApiKeys(user);
    const existing = await this.apiKeyRepo.findById(dto.apiKeyId);
    if (
      !existing ||
      existing.workspaceId !== workspace.id ||
      existing.deletedAt
    ) {
      throw new NotFoundException('API key not found');
    }

    await this.apiKeyRepo.updateApiKey(dto.apiKeyId, {
      deletedAt: new Date(),
    });
  }

  async validateApiKey(
    payload: JwtApiKeyPayload,
    expectedType: 'rag' | 'mcp' = 'rag',
  ) {
    return this.apiKeyValidation.validateApiKey(payload, expectedType);
  }
}
