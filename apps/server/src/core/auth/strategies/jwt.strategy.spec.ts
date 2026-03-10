import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { ModuleRef } from '@nestjs/core';
import { JwtType } from '../dto/jwt-payload';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let workspaceRepo: jest.Mocked<WorkspaceRepo>;
  let userRepo: jest.Mocked<UserRepo>;
  let moduleRef: jest.Mocked<ModuleRef>;
  let apiKeyService: { validateApiKey: jest.Mock };

  beforeEach(() => {
    workspaceRepo = {
      findById: jest.fn(),
    } as any;

    userRepo = {
      findById: jest.fn(),
    } as any;

    apiKeyService = {
      validateApiKey: jest.fn(),
    };

    moduleRef = {
      get: jest.fn().mockReturnValue(apiKeyService),
    } as any;

    const environmentService = {
      getAppSecret: jest.fn().mockReturnValue('test-secret'),
    } as unknown as EnvironmentService;

    strategy = new JwtStrategy(
      userRepo,
      workspaceRepo,
      environmentService,
      moduleRef,
    );
  });

  it('rejects API key usage outside /api/rag', async () => {
    await expect(
      strategy.validate(
        {
          originalUrl: '/api/pages',
          raw: { workspaceId: 'workspace-1' },
        },
        {
          sub: 'user-1',
          apiKeyId: 'key-1',
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          type: JwtType.API_KEY,
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('validates API key payload on /api/rag via ApiKeyService', async () => {
    apiKeyService.validateApiKey.mockResolvedValue({
      authType: 'api_key',
    });

    const result = await strategy.validate(
      {
        originalUrl: '/api/rag/pages',
        raw: { workspaceId: 'workspace-1' },
      },
      {
        sub: 'user-1',
        apiKeyId: 'key-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        type: JwtType.API_KEY,
      },
    );

    expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
      }),
    );
    expect(result).toEqual({ authType: 'api_key' });
  });

  it('rejects API key payload without space scope', async () => {
    await expect(
      strategy.validate(
        {
          originalUrl: '/api/rag/pages',
          raw: { workspaceId: 'workspace-1' },
        },
        {
          sub: 'user-1',
          apiKeyId: 'key-1',
          workspaceId: 'workspace-1',
          type: JwtType.API_KEY,
        } as any,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves access token payload for standard user auth', async () => {
    workspaceRepo.findById.mockResolvedValue({
      id: 'workspace-1',
    } as any);
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      deactivatedAt: null,
      deletedAt: null,
    } as any);

    const result = await strategy.validate(
      {
        originalUrl: '/api/pages',
        raw: { workspaceId: 'workspace-1' },
      },
      {
        sub: 'user-1',
        email: 'user@example.com',
        workspaceId: 'workspace-1',
        type: JwtType.ACCESS,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({ id: 'workspace-1' }),
        user: expect.objectContaining({ id: 'user-1' }),
      }),
    );
  });
});
