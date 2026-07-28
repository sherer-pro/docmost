import { UnauthorizedException } from '@nestjs/common';
import { AuthenticationExtension } from './authentication.extension';
import { JwtType } from '../../core/auth/dto/jwt-payload';

/**
 * Collab tokens grant read and write access to page content over the websocket.
 * They must therefore die with the session that issued them, otherwise logout,
 * "revoke all sessions", and a password reset would all leave an attacker
 * connected.
 */
describe('AuthenticationExtension collab token session binding', () => {
  const PAGE_ID = '018f4f6a-6f5a-7f2c-9c0d-1f2a3b4c5d6e';

  function createExtension(payload: Record<string, unknown>) {
    const tokenService = {
      verifyJwt: jest.fn(async () => payload),
    };
    const userRepo = {
      findById: jest.fn(async () => ({
        id: 'user-1',
        deactivatedAt: null,
        deletedAt: null,
      })),
    };
    const pageRepo = {
      findById: jest.fn(async () => ({
        id: PAGE_ID,
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
      })),
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn(async () => ({
        capabilities: { canRead: true, canWrite: true },
      })),
    };
    const userSessionRepo = {
      findActiveById: jest.fn(async () => ({
        id: 'session-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })),
    };

    const extension = new AuthenticationExtension(
      tokenService as any,
      userRepo as any,
      pageRepo as any,
      pageAccessService as any,
      userSessionRepo as any,
    );

    return { extension, userSessionRepo, pageRepo, pageAccessService };
  }

  const authPayload = (documentName = `page.${PAGE_ID}`) =>
    ({
      documentName,
      token: 'collab-token',
      connectionConfig: { readOnly: false },
    }) as any;

  it('authenticates a collab token bound to an active session', async () => {
    const { extension, userSessionRepo } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      type: JwtType.COLLAB,
    });

    const result = await extension.onAuthenticate(authPayload());

    expect(result).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
      }),
    );
    expect(userSessionRepo.findActiveById).toHaveBeenCalledWith('session-1');
  });

  it('rejects a collab token that carries no session id', async () => {
    const { extension, pageRepo } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      type: JwtType.COLLAB,
    });

    await expect(extension.onAuthenticate(authPayload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(pageRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects a collab token whose session was revoked', async () => {
    const { extension, userSessionRepo, pageRepo } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      type: JwtType.COLLAB,
    });
    userSessionRepo.findActiveById.mockResolvedValue(undefined as any);

    await expect(extension.onAuthenticate(authPayload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(pageRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects a collab token whose session belongs to another user', async () => {
    const { extension, userSessionRepo } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      type: JwtType.COLLAB,
    });
    userSessionRepo.findActiveById.mockResolvedValue({
      id: 'session-1',
      userId: 'someone-else',
      workspaceId: 'workspace-1',
    } as any);

    await expect(extension.onAuthenticate(authPayload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('downgrades the connection to read-only when write access is missing', async () => {
    const { extension, pageAccessService } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      type: JwtType.COLLAB,
    });
    pageAccessService.getEffectiveAccess.mockResolvedValue({
      capabilities: { canRead: true, canWrite: false },
    } as any);

    const data = authPayload();
    await extension.onAuthenticate(data);

    expect(data.connectionConfig.readOnly).toBe(true);
  });
});
