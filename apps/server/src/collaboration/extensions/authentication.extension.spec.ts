import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthenticationExtension } from './authentication.extension';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { Connection, Document, OutgoingMessage } from '@hocuspocus/server';
import * as Y from 'yjs';

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
        templateKind: null,
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
        ssoVerifiedAt: null,
        mfaVerifiedAt: null,
      })),
    };
    const spacePolicy = {
      resolve: jest.fn(async () => ({
        effective: { enforceSso: false, enforceMfa: false },
      })),
      evaluateAuthentication: jest.fn(() => ({ satisfied: true })),
    };
    const pageTemplatePolicy = {
      assertAction: jest.fn().mockResolvedValue(undefined),
    };

    const extension = new AuthenticationExtension(
      tokenService as any,
      userRepo as any,
      pageRepo as any,
      pageAccessService as any,
      userSessionRepo as any,
      spacePolicy as any,
      pageTemplatePolicy as any,
    );

    return {
      extension,
      userSessionRepo,
      pageRepo,
      pageAccessService,
      spacePolicy,
      pageTemplatePolicy,
    };
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

  it('rejects a collab session that does not satisfy the page space policy', async () => {
    const { extension, spacePolicy } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      pageId: PAGE_ID,
      type: JwtType.COLLAB,
    });
    spacePolicy.evaluateAuthentication.mockReturnValue({ satisfied: false });

    await expect(extension.onAuthenticate(authPayload())).rejects.toThrow(
      'Additional authentication is required',
    );
  });

  it('closes an existing collab connection when assurance is no longer valid', async () => {
    const { extension, spacePolicy } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      pageId: PAGE_ID,
      type: JwtType.COLLAB,
    });
    const context = await extension.onAuthenticate(authPayload());
    spacePolicy.evaluateAuthentication.mockReturnValue({ satisfied: false });
    const connection = {
      context,
      readOnly: false,
      close: jest.fn(),
    } as any;

    await expect(
      extension.beforeHandleMessage({
        connection,
        document: { getConnections: () => [connection] },
      } as any),
    ).rejects.toThrow('Collaboration authorization is no longer valid');
    expect(connection.close).toHaveBeenCalled();
  });

  it('rejects a canonical collab token used for another page', async () => {
    const { extension } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      pageId: '018f4f6a-6f5a-7f2c-9c0d-000000000000',
      type: JwtType.COLLAB,
    });

    await expect(extension.onAuthenticate(authPayload())).rejects.toThrow(
      'Collab token is bound to a different page',
    );
  });

  it('rejects a collab token that carries no session id', async () => {
    const { extension, pageRepo } = createExtension({
      sub: 'user-1',
      workspaceId: 'workspace-1',
      type: JwtType.COLLAB,
    });

    await expect(
      extension.onAuthenticate(authPayload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

    await expect(
      extension.onAuthenticate(authPayload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

    await expect(
      extension.onAuthenticate(authPayload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

  it('rejects a malicious Yjs update before it changes a denied template document', async () => {
    const { extension, pageRepo, pageAccessService, pageTemplatePolicy } =
      createExtension({
        sub: 'user-1',
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        pageId: PAGE_ID,
        type: JwtType.COLLAB,
      });
    pageRepo.findById.mockResolvedValue({
      id: PAGE_ID,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      templateKind: 'synced',
    } as any);
    pageAccessService.getEffectiveAccess.mockResolvedValue({
      capabilities: { canRead: true, canWrite: true },
    } as any);
    const authentication = authPayload();
    const context = await extension.onAuthenticate(authentication);
    expect(authentication.connectionConfig.readOnly).toBe(false);
    pageTemplatePolicy.assertAction.mockRejectedValue(
      new ForbiddenException({
        code: 'page_template_policy_denied',
        message: 'Template policy denied',
      }),
    );
    const document = new Document(`page.${PAGE_ID}`);
    document.getText('content').insert(0, 'safe');
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, Y.encodeStateAsUpdate(document));
    attacker.getText('content').insert(4, '-malicious');
    const update = Y.encodeStateAsUpdate(
      attacker,
      Y.encodeStateVector(document),
    );
    const webSocket = {
      readyState: 1,
      binaryType: 'nodebuffer',
      send: jest.fn((_message, callback?: (error?: Error) => void) =>
        callback?.(),
      ),
      close: jest.fn(),
    } as any;
    const connection = new Connection(
      webSocket,
      { headers: {} } as any,
      document,
      'socket-1',
      context,
      false,
    );
    connection.beforeHandleMessage((_connection, rawUpdate) =>
      extension.beforeHandleMessage({
        connection,
        document,
        documentName: document.name,
        update: rawUpdate,
      } as any),
    );
    const message = new OutgoingMessage(document.name)
      .createSyncMessage()
      .writeUpdate(update)
      .toUint8Array();

    connection.handleMessage(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pageTemplatePolicy.assertAction).toHaveBeenCalledWith(
      'workspace-1',
      'space-1',
      'user-1',
      'manage_template',
    );
    expect(connection.readOnly).toBe(true);
    expect(document.getText('content').toString()).toBe('safe');
    connection.close();
    document.destroy();
    attacker.destroy();
  });
});
