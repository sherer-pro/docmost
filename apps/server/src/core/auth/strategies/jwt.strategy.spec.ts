import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { JwtType } from '../dto/jwt-payload';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let workspaceRepo: jest.Mocked<WorkspaceRepo>;
  let userRepo: jest.Mocked<UserRepo>;
  let userSessionRepo: { findActiveById: jest.Mock };
  let sessionActivityService: { trackActivity: jest.Mock };
  let apiKeyValidation: { validateApiKey: jest.Mock };

  beforeEach(() => {
    workspaceRepo = {
      findById: jest.fn(),
    } as any;

    userRepo = {
      findById: jest.fn(),
    } as any;

    userSessionRepo = {
      findActiveById: jest.fn(),
    };

    sessionActivityService = {
      trackActivity: jest.fn(),
    };

    apiKeyValidation = {
      validateApiKey: jest.fn(),
    };

    const environmentService = {
      getAppSecret: jest.fn().mockReturnValue('test-secret'),
    } as unknown as EnvironmentService;

    strategy = new JwtStrategy(
      userRepo,
      workspaceRepo,
      userSessionRepo as any,
      sessionActivityService as any,
      environmentService,
      apiKeyValidation as any,
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

  it('validates API key payload on /api/rag via ApiKeyValidationService', async () => {
    apiKeyValidation.validateApiKey.mockResolvedValue({
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

    expect(apiKeyValidation.validateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
      }),
      'rag',
    );
    expect(result).toEqual({ authType: 'api_key' });
  });

  it('validates an API key on /mcp as an MCP key', async () => {
    apiKeyValidation.validateApiKey.mockResolvedValue({
      authType: 'api_key',
    });

    await strategy.validate(
      {
        originalUrl: '/mcp',
        raw: { workspaceId: 'workspace-1' },
      },
      {
        sub: 'user-1',
        apiKeyId: 'key-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        keyType: 'mcp',
        type: JwtType.API_KEY,
      },
    );

    expect(apiKeyValidation.validateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-1', keyType: 'mcp' }),
      'mcp',
    );
  });

  it.each(['/mcproxy', '/api/ragged'])(
    'does not treat a similarly prefixed route as an API key surface: %s',
    async (originalUrl) => {
      await expect(
        strategy.validate(
          {
            originalUrl,
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

      expect(apiKeyValidation.validateApiKey).not.toHaveBeenCalled();
    },
  );

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
    userSessionRepo.findActiveById.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const req = {
      originalUrl: '/api/pages',
      raw: { workspaceId: 'workspace-1' },
    };

    const result = await strategy.validate(req, {
      sub: 'user-1',
      email: 'user@example.com',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      type: JwtType.ACCESS,
    });

    expect(result).toEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({ id: 'workspace-1' }),
        user: expect.objectContaining({ id: 'user-1' }),
      }),
    );
    expect(userSessionRepo.findActiveById).toHaveBeenCalledWith('session-1');
    expect(req.raw).toEqual(
      expect.objectContaining({ sessionId: 'session-1' }),
    );
  });

  it('rejects an access token that carries no session id', async () => {
    workspaceRepo.findById.mockResolvedValue({ id: 'workspace-1' } as any);
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      deactivatedAt: null,
      deletedAt: null,
    } as any);

    // A sessionless token cannot be revoked by logout, session revocation, or a
    // password reset, so it must not authenticate at all.
    await expect(
      strategy.validate(
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
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userSessionRepo.findActiveById).not.toHaveBeenCalled();
  });

  it('rejects an access token whose session was revoked', async () => {
    workspaceRepo.findById.mockResolvedValue({ id: 'workspace-1' } as any);
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      deactivatedAt: null,
      deletedAt: null,
    } as any);
    userSessionRepo.findActiveById.mockResolvedValue(undefined);

    await expect(
      strategy.validate(
        {
          originalUrl: '/api/pages',
          raw: { workspaceId: 'workspace-1' },
        },
        {
          sub: 'user-1',
          email: 'user@example.com',
          workspaceId: 'workspace-1',
          sessionId: 'session-1',
          type: JwtType.ACCESS,
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects revoked or expired sessions on access token payloads', async () => {
    workspaceRepo.findById.mockResolvedValue({
      id: 'workspace-1',
    } as any);
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      deactivatedAt: null,
      deletedAt: null,
    } as any);
    userSessionRepo.findActiveById.mockResolvedValue(undefined);

    await expect(
      strategy.validate(
        {
          originalUrl: '/api/pages',
          raw: { workspaceId: 'workspace-1' },
        },
        {
          sub: 'user-1',
          email: 'user@example.com',
          workspaceId: 'workspace-1',
          sessionId: 'session-1',
          type: JwtType.ACCESS,
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tracks valid session activity and stores the current session id', async () => {
    workspaceRepo.findById.mockResolvedValue({
      id: 'workspace-1',
    } as any);
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      deactivatedAt: null,
      deletedAt: null,
    } as any);
    userSessionRepo.findActiveById.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    const request = {
      originalUrl: '/api/pages',
      raw: { workspaceId: 'workspace-1' },
    };

    await strategy.validate(request, {
      sub: 'user-1',
      email: 'user@example.com',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      type: JwtType.ACCESS,
    });

    expect((request.raw as any).sessionId).toBe('session-1');
    expect(sessionActivityService.trackActivity).toHaveBeenCalledWith(
      'session-1',
      'user-1',
      'workspace-1',
    );
  });
});
