jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { TokenService } from '../auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { UserRole } from '../../common/helpers/types/permission';
import { JwtType } from '../auth/dto/jwt-payload';
import {
  AI_BUILTIN_TOOL_POLICY_RESOLVER,
  AiBuiltinToolPolicyResolver,
} from '../ai/tools/ai-builtin-tool-policy.token';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let apiKeyRepo: jest.Mocked<ApiKeyRepo>;
  let tokenService: jest.Mocked<TokenService>;
  let spaceRepo: jest.Mocked<SpaceRepo>;
  let spaceMemberRepo: jest.Mocked<SpaceMemberRepo>;
  let userRepo: jest.Mocked<UserRepo>;
  let workspaceRepo: jest.Mocked<WorkspaceRepo>;
  let builtinToolPolicy: jest.Mocked<AiBuiltinToolPolicyResolver>;

  const workspace = { id: 'workspace-1' } as any;
  const ownerUser = {
    id: 'user-1',
    role: UserRole.OWNER,
    workspaceId: 'workspace-1',
  } as any;
  const memberUser = {
    id: 'user-2',
    role: UserRole.MEMBER,
    workspaceId: 'workspace-1',
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        {
          provide: ApiKeyRepo,
          useValue: {
            findById: jest.fn(),
            insertApiKey: jest.fn(),
            updateApiKey: jest.fn(),
            listApiKeys: jest.fn(),
          },
        },
        {
          provide: TokenService,
          useValue: {
            generateApiToken: jest.fn(),
          },
        },
        {
          provide: UserRepo,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: WorkspaceRepo,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: SpaceRepo,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: SpaceMemberRepo,
          useValue: {
            getUserSpaceRoles: jest.fn(),
          },
        },
        {
          provide: AI_BUILTIN_TOOL_POLICY_RESOLVER,
          useValue: {
            getEffectiveCapabilities: jest.fn(async () => [
              'page.content.read',
            ]),
          },
        },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
    apiKeyRepo = module.get(ApiKeyRepo);
    tokenService = module.get(TokenService);
    spaceRepo = module.get(SpaceRepo);
    spaceMemberRepo = module.get(SpaceMemberRepo);
    userRepo = module.get(UserRepo);
    workspaceRepo = module.get(WorkspaceRepo);
    builtinToolPolicy = module.get(AI_BUILTIN_TOOL_POLICY_RESOLVER);
  });

  /** Sets up a valid key row plus resolvable workspace/user/space. */
  function stubValidKey(creator: any) {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'key-1',
      creatorId: creator.id,
      workspaceId: workspace.id,
      spaceId: 'space-1',
      keyType: 'rag',
      deletedAt: null,
      expiresAt: null,
    } as any);
    apiKeyRepo.updateApiKey.mockResolvedValue({} as any);
    workspaceRepo.findById.mockResolvedValue(workspace);
    userRepo.findById.mockResolvedValue(creator);
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      workspaceId: workspace.id,
    } as any);
  }

  const validPayload = (creator: any) =>
    ({
      sub: creator.id,
      apiKeyId: 'key-1',
      workspaceId: workspace.id,
      spaceId: 'space-1',
      keyType: 'rag',
      type: JwtType.API_KEY,
    }) as any;

  it('rejects a key whose creator lost access to the scoped space', async () => {
    stubValidKey(memberUser);
    // Membership was revoked after the key was created.
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);

    await expect(
      service.validateApiKey(validPayload(memberUser)),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(spaceMemberRepo.getUserSpaceRoles).toHaveBeenCalledWith(
      memberUser.id,
      'space-1',
    );
  });

  it('accepts a key while its creator still belongs to the scoped space', async () => {
    stubValidKey(memberUser);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: memberUser.id, role: 'reader' } as any,
    ]);

    const result = await service.validateApiKey(validPayload(memberUser));

    expect(result).toEqual(expect.objectContaining({ authType: 'api_key' }));
  });

  it('does not require space membership for workspace admins and owners', async () => {
    stubValidKey(ownerUser);

    const result = await service.validateApiKey(validPayload(ownerUser));

    expect(result).toEqual(expect.objectContaining({ authType: 'api_key' }));
    expect(spaceMemberRepo.getUserSpaceRoles).not.toHaveBeenCalled();
  });

  it('creates space-scoped API key with a bounded default JWT lifetime', async () => {
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      workspaceId: workspace.id,
    } as any);
    apiKeyRepo.insertApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'RAG key',
      creatorId: ownerUser.id,
      workspaceId: workspace.id,
      spaceId: 'space-1',
      keyType: 'rag',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      expiresAt: null,
      lastUsedAt: null,
    } as any);
    tokenService.generateApiToken.mockResolvedValue('token-value');
    apiKeyRepo.findById.mockResolvedValue({
      id: 'key-1',
      name: 'RAG key',
      spaceId: 'space-1',
      workspaceId: workspace.id,
      keyType: 'rag',
    } as any);

    await service.createApiKey(ownerUser, workspace, {
      name: 'RAG key',
      spaceId: 'space-1',
    });

    expect(tokenService.generateApiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-1',
        workspaceId: workspace.id,
        spaceId: 'space-1',
        keyType: 'rag',
        // Bounded on purpose: an unbounded token stays replayable forever.
        expiresIn: '365d',
      }),
    );
  });

  it('rejects API key payload when scope does not match persisted key', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'key-1',
      creatorId: ownerUser.id,
      workspaceId: workspace.id,
      spaceId: 'space-1',
      keyType: 'rag',
      deletedAt: null,
      expiresAt: null,
    } as any);

    await expect(
      service.validateApiKey({
        sub: ownerUser.id,
        apiKeyId: 'key-1',
        workspaceId: workspace.id,
        spaceId: 'space-2',
        type: JwtType.API_KEY,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows workspace admins to create MCP keys', async () => {
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      workspaceId: workspace.id,
    } as any);

    apiKeyRepo.insertApiKey.mockResolvedValue({
      id: 'key-mcp',
      creatorId: ownerUser.id,
      workspaceId: workspace.id,
      spaceId: 'space-1',
      keyType: 'mcp',
      expiresAt: null,
    } as any);
    apiKeyRepo.findById.mockResolvedValue({
      id: 'key-mcp',
      creatorId: ownerUser.id,
      workspaceId: workspace.id,
      spaceId: 'space-1',
      keyType: 'mcp',
    } as any);
    tokenService.generateApiToken.mockResolvedValue('mcp-token');

    await service.createApiKey(ownerUser, workspace, {
      name: 'MCP key',
      spaceId: 'space-1',
      keyType: 'mcp',
      allowedCapabilities: ['page.content.read'],
    });

    expect(tokenService.generateApiToken).toHaveBeenCalledWith(
      expect.objectContaining({ keyType: 'mcp' }),
    );
    expect(apiKeyRepo.insertApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedCapabilities: ['page.content.read'],
      }),
    );
    expect(builtinToolPolicy.getEffectiveCapabilities).toHaveBeenCalledWith(
      workspace.id,
      'space-1',
      'mcp',
    );
  });

  it('requires a non-empty exact capability list for new MCP keys', async () => {
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      workspaceId: workspace.id,
    } as any);

    await expect(
      service.createApiKey(ownerUser, workspace, {
        name: 'MCP key',
        spaceId: 'space-1',
        keyType: 'mcp',
      }),
    ).rejects.toThrow('Select at least one capability');
  });

  it('does not accept RAG and MCP key types interchangeably', async () => {
    stubValidKey(ownerUser);

    await expect(
      service.validateApiKey(validPayload(ownerUser), 'mcp'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects API key management for member users', async () => {
    await expect(
      service.listApiKeys(memberUser, workspace, {
        adminView: true,
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.createApiKey(memberUser, workspace, {
        name: 'Member key',
        spaceId: 'space-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.updateApiKey(memberUser, workspace, {
        apiKeyId: 'key-3',
        name: 'Updated by member',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.revokeApiKey(memberUser, workspace, {
        apiKeyId: 'key-3',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes the key type filter to the repository before pagination', async () => {
    apiKeyRepo.listApiKeys.mockResolvedValue({ items: [], meta: {} } as any);

    await service.listApiKeys(ownerUser, workspace, {
      keyType: 'mcp',
      limit: 20,
    } as any);

    expect(apiKeyRepo.listApiKeys).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({ keyType: 'mcp', limit: 20 }),
      { keyType: 'mcp' },
    );
  });
});
