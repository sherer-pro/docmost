import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { TokenService } from '../auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { UserRole } from '../../common/helpers/types/permission';
import { JwtType } from '../auth/dto/jwt-payload';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let apiKeyRepo: jest.Mocked<ApiKeyRepo>;
  let tokenService: jest.Mocked<TokenService>;
  let spaceRepo: jest.Mocked<SpaceRepo>;

  const workspace = { id: 'workspace-1' } as any;
  const ownerUser = {
    id: 'user-1',
    role: UserRole.OWNER,
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
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
    apiKeyRepo = module.get(ApiKeyRepo);
    tokenService = module.get(TokenService);
    spaceRepo = module.get(SpaceRepo);
  });

  it('creates space-scoped API key with non-expiring JWT by default', async () => {
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
        expiresIn: '100y',
      }),
    );
  });

  it('rejects API key payload when scope does not match persisted key', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'key-1',
      creatorId: ownerUser.id,
      workspaceId: workspace.id,
      spaceId: 'space-1',
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
});
