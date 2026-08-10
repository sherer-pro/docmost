jest.mock(
  '@docmost/db/repos/space/space-member.repo',
  () => ({
    SpaceMemberRepo: class SpaceMemberRepoMock {},
  }),
  { virtual: true },
);

import type { WsGateway as WsGatewayType } from './ws.gateway';

let WsGatewayClass: typeof WsGatewayType;

type BroadcastToMock = {
  emit: jest.Mock;
};

type SocketMock = {
  id: string;
  emit: jest.Mock;
  data: {
    authorizedRooms?: Set<string>;
    user?: Record<string, unknown>;
    userId?: string;
    workspaceId?: string;
    sessionId?: string | null;
    deviceName?: string | null;
    allowedSpaceIds?: Set<string>;
    workspaceAssuranceSatisfied?: boolean;
  };
  rooms: Set<string>;
  broadcast: {
    to: jest.Mock<BroadcastToMock, [string]>;
  };
};

/**
 * Creates a minimal socket mock for WS gateway unit tests.
 *
 * The mock explicitly models:
 * - `authorizedRooms` assigned by the server in `handleConnection`;
 * - `rooms` where Socket.IO tracks real membership;
 * - `broadcast.to(...).emit(...)` to assert relay execution and target room.
 */
const createSocketMock = (
  authorizedRooms: string[],
  joinedRooms: string[] = authorizedRooms,
): SocketMock => {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });

  return {
    id: 'socket-1',
    emit,
    data: { authorizedRooms: new Set(authorizedRooms) },
    rooms: new Set(joinedRooms),
    broadcast: { to },
  };
};

describe('WsGateway.handleMessage', () => {
  let gateway: WsGatewayType;
  const pageRepo = {
    findById: jest.fn(),
  };
  const pageAccessService = {
    getEffectiveAccess: jest.fn(async () => ({
      capabilities: { canRead: true },
    })),
    getSpaceIdsWithPageRuleAccess: jest.fn(async () => []),
  };
  const userSessionRepo = {
    findActiveById: jest.fn(),
  };
  const presenceService = {
    updateConnection: jest.fn(),
    removeConnection: jest.fn(),
  };
  const pageTransclusionReferencesRepo = {
    findUsagesBySource: jest.fn(async () => []),
  };

  beforeAll(async () => {
    ({ WsGateway: WsGatewayClass } = await import('./ws.gateway'));
  });

  beforeEach(() => {
    gateway = new WsGatewayClass(
      {} as any,
      {} as any,
      {} as any,
      pageRepo as any,
      pageAccessService as any,
      userSessionRepo as any,
      presenceService as any,
      {} as any,
      {} as any,
      pageTransclusionReferencesRepo as any,
    );
    (gateway as any).server = {
      sockets: {
        adapter: {
          rooms: new Map(),
        },
        sockets: new Map(),
      },
    };
    jest
      .spyOn(gateway as any, 'refreshClientAuthorization')
      .mockResolvedValue(true);
    jest.clearAllMocks();
  });

  it('invalidates block consumers when an update omits workspaceId', async () => {
    pageRepo.findById
      .mockResolvedValueOnce({
        id: 'source-page',
        workspaceId: 'workspace-a',
        spaceId: 'space-source',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'consumer-page',
        workspaceId: 'workspace-a',
        spaceId: 'space-consumer',
        deletedAt: null,
      });
    pageTransclusionReferencesRepo.findUsagesBySource.mockResolvedValueOnce([
      {
        referenceKind: 'block',
        referencePageId: 'consumer-page',
        sourcePageId: 'source-page',
      },
    ]);
    const emitInvalidation = jest
      .spyOn(gateway, 'emitPageEmbedInvalidation')
      .mockImplementation(() => undefined);

    await gateway.handlePageEmbedSourceUpdated({ pageIds: ['source-page'] });

    expect(
      pageTransclusionReferencesRepo.findUsagesBySource,
    ).toHaveBeenCalledWith('source-page', 'workspace-a');
    expect(emitInvalidation).toHaveBeenCalledWith(
      new Set(['space-consumer']),
    );
  });

  it('relays a message only to an authorized space room', async () => {
    const socket = createSocketMock(['space-space-a']);

    await gateway.handleMessage(socket as any, {
      operation: 'broadcast',
      targetRoom: 'space-space-a',
      spaceId: 'space-a',
      data: { operation: 'updateOne', title: 'update' },
    });

    expect(socket.broadcast.to).toHaveBeenCalledWith('space-space-a');
    expect(socket.broadcast.to.mock.results[0].value.emit).toHaveBeenCalledWith(
      'message',
      expect.objectContaining({ targetRoom: 'space-space-a' }),
    );
  });

  it('blocks cross-space relay to an unauthorized room', async () => {
    const socket = createSocketMock(['space-space-a']);

    await gateway.handleMessage(socket as any, {
      operation: 'broadcast',
      targetRoom: 'space-space-b',
      spaceId: 'space-b',
      data: { operation: 'updateOne', pageId: 'p-2' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('blocks relay when the socket is not joined to the target room', async () => {
    const socket = createSocketMock(['workspace-workspace-a'], []);

    await gateway.handleMessage(socket as any, {
      operation: 'broadcast',
      targetRoom: 'workspace-workspace-a',
      workspaceId: 'workspace-a',
      data: { operation: 'invalidate', title: 'new title' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('rejects payload without required workspaceId for a workspace room', async () => {
    const socket = createSocketMock(['workspace-workspace-a']);

    await gateway.handleMessage(socket as any, {
      operation: 'broadcast',
      targetRoom: 'workspace-workspace-a',
      data: { operation: 'invalidate', title: 'new title' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('rejects payload with mismatched room and spaceId', async () => {
    const socket = createSocketMock(['space-space-a']);

    await gateway.handleMessage(socket as any, {
      operation: 'broadcast',
      targetRoom: 'space-space-a',
      spaceId: 'space-b',
      data: { operation: 'updateOne', pageId: 'p-2' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('relays committed move coordinates instead of stale client values', async () => {
    const sender = createSocketMock(['space-space-a']);
    sender.id = 'sender';
    sender.data.user = { id: 'user-1', workspaceId: 'workspace-a' };
    const receiver = createSocketMock(['space-space-a']);
    receiver.id = 'receiver';
    receiver.data.user = { id: 'user-2', workspaceId: 'workspace-a' };
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      spaceId: 'space-a',
      workspaceId: 'workspace-a',
      parentPageId: 'committed-parent',
      position: 'committed-position',
      deletedAt: null,
    });
    (gateway as any).server.sockets.adapter.rooms.set(
      'space-space-a',
      new Set(['sender', 'receiver']),
    );
    (gateway as any).server.sockets.sockets.set('receiver', receiver);

    await gateway.handleMessage(sender as any, {
      operation: 'broadcast',
      targetRoom: 'space-space-a',
      spaceId: 'space-a',
      data: {
        operation: 'moveTreeNode',
        spaceId: 'space-a',
        payload: {
          id: 'page-1',
          parentId: 'stale-parent',
          oldParentId: null,
          position: 'stale-position',
          node: { id: 'page-1', spaceId: 'space-a' },
        },
      },
    });

    expect(receiver.emit).toHaveBeenCalledWith(
      'message',
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            parentId: 'committed-parent',
            position: 'committed-position',
            node: expect.objectContaining({
              parentPageId: 'committed-parent',
              position: 'committed-position',
            }),
          }),
        }),
      }),
    );
  });

  it('rejects unsupported envelope operations', async () => {
    const socket = createSocketMock(['space-space-a']);

    await gateway.handleMessage(socket as any, {
      operation: 'updateOne',
      targetRoom: 'space-space-a',
      spaceId: 'space-a',
      data: { operation: 'updateOne', pageId: 'p-2' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('rejects unsupported nested event operations', async () => {
    const socket = createSocketMock(['space-space-a']);

    await gateway.handleMessage(socket as any, {
      operation: 'broadcast',
      targetRoom: 'space-space-a',
      spaceId: 'space-a',
      data: { operation: 'exfiltrate', pageId: 'p-2' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('stores a valid presence update for the authenticated socket user', async () => {
    const socket = createSocketMock(['workspace-workspace-a']);
    socket.data.user = { id: 'user-1', workspaceId: 'workspace-a' };
    socket.data.sessionId = 'session-1';
    socket.data.deviceName = 'Chrome on Windows';

    await gateway.handlePresenceUpdate(socket as any, {
      type: 'page',
      pageId: 'page-1',
      path: '/s/docs/p/page-1',
      tabId: 'tab-1',
    });

    expect(presenceService.updateConnection).toHaveBeenCalledWith(
      {
        socketId: socket.id,
        user: socket.data.user,
        sessionId: 'session-1',
        deviceName: 'Chrome on Windows',
      },
      expect.objectContaining({
        type: 'page',
        pageId: 'page-1',
        path: '/s/docs/p/page-1',
        tabId: 'tab-1',
      }),
    );
  });

  it('rejects workspace presence from an assurance-restricted socket', async () => {
    const socket = createSocketMock(['space-space-a']);
    socket.data.user = { id: 'user-1', workspaceId: 'workspace-1' };
    socket.data.workspaceAssuranceSatisfied = false;
    socket.data.allowedSpaceIds = new Set(['space-a']);

    await gateway.handlePresenceUpdate(socket as any, {
      type: 'workspace',
      path: '/home',
      tabId: 'tab-1',
    });

    expect(presenceService.updateConnection).not.toHaveBeenCalled();
  });

  it('allows presence in an eligible space for a restricted socket', async () => {
    const socket = createSocketMock(['space-space-a']);
    socket.data.user = { id: 'user-1', workspaceId: 'workspace-1' };
    socket.data.workspaceAssuranceSatisfied = false;
    socket.data.allowedSpaceIds = new Set(['space-a']);
    (gateway as any).spacePolicy.resolveSpaceId = jest
      .fn()
      .mockResolvedValue('space-a');

    await gateway.handlePresenceUpdate(socket as any, {
      type: 'space',
      spaceId: 'eligible-space',
      path: '/s/eligible-space',
      tabId: 'tab-1',
    });

    expect(presenceService.updateConnection).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid presence payloads', async () => {
    const socket = createSocketMock(['workspace-workspace-a']);
    socket.data.user = { id: 'user-1', workspaceId: 'workspace-a' };

    await gateway.handlePresenceUpdate(socket as any, {
      type: 'invalid',
      pageId: 'page-1',
    });

    expect(presenceService.updateConnection).not.toHaveBeenCalled();
  });

  it('removes presence on socket disconnect', async () => {
    const socket = createSocketMock(['workspace-workspace-a']);

    await gateway.handleDisconnect(socket as any);

    expect(presenceService.removeConnection).toHaveBeenCalledWith(socket.id);
  });

  it('refreshes matching sockets when authorization state changes', async () => {
    const socket = createSocketMock(['space-space-a']);
    socket.data.userId = 'user-1';
    socket.data.workspaceId = 'workspace-1';
    socket.data.sessionId = 'session-1';
    (gateway as any).server.sockets.sockets.set(socket.id, socket);

    await gateway.handleAuthorizationChanged({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      sessionId: 'session-1',
    });

    expect((gateway as any).refreshClientAuthorization).toHaveBeenCalledWith(
      socket,
    );
  });

  it('invalidates access-sensitive client caches after page access changes', () => {
    const socket = createSocketMock(['workspace-workspace-1']);
    socket.data.user = { workspaceId: 'workspace-1' };
    (gateway as any).server.sockets.sockets.set(socket.id, socket);

    gateway.handlePageEmbedVisibilityChanged({ workspaceId: 'workspace-1' });

    expect(socket.emit).toHaveBeenCalledWith('page-embed:invalidate', {
      operation: 'page_embed_invalidate',
    });
    expect(socket.emit).toHaveBeenCalledWith('access:invalidate', {
      operation: 'access_invalidate',
    });
  });

  it('targets access invalidation while broadcasting embed invalidation', () => {
    const affected = createSocketMock(['workspace-workspace-1']);
    affected.data.user = { id: 'user-1', workspaceId: 'workspace-1' };
    const unaffected = createSocketMock(['workspace-workspace-1']);
    unaffected.data.user = { id: 'user-2', workspaceId: 'workspace-1' };
    (gateway as any).server.sockets.sockets.set(affected.id, affected);
    (gateway as any).server.sockets.sockets.set('socket-2', unaffected);

    gateway.handlePageEmbedVisibilityChanged({
      workspaceId: 'workspace-1',
      accessUserIds: ['user-1'],
    });

    expect(affected.emit).toHaveBeenCalledWith('access:invalidate', {
      operation: 'access_invalidate',
    });
    expect(unaffected.emit).toHaveBeenCalledWith('page-embed:invalidate', {
      operation: 'page_embed_invalidate',
    });
    expect(unaffected.emit).not.toHaveBeenCalledWith(
      'access:invalidate',
      expect.anything(),
    );
  });

  it('removes a space room immediately when its effective policy becomes stricter', async () => {
    const memberRepo = {
      getUserSpaceIds: jest.fn().mockResolvedValue(['space-a']),
    };
    const accessService = {
      getSpaceIdsWithPageRuleAccess: jest.fn().mockResolvedValue([]),
    };
    const sessionRepo = {
      findActiveById: jest.fn().mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        deviceName: 'Browser',
        mfaVerifiedAt: null,
      }),
    };
    const policyService = {
      resolve: jest.fn().mockResolvedValue({
        effective: { enforceMfa: true, enforceSso: false },
      }),
      getWorkspaceValues: jest.fn().mockReturnValue({
        enforceMfa: false,
        enforceSso: false,
      }),
      evaluateAuthentication: jest.fn((values) => ({
        satisfied: values.enforceMfa !== true,
      })),
    };
    const refreshedGateway = new WsGatewayClass(
      {} as any,
      memberRepo as any,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'user-1',
          workspaceId: 'workspace-1',
          deactivatedAt: null,
          deletedAt: null,
        }),
      } as any,
      {} as any,
      accessService as any,
      sessionRepo as any,
      presenceService as any,
      { findById: jest.fn().mockResolvedValue({ id: 'workspace-1' }) } as any,
      policyService as any,
      { findPageUsagesBySource: jest.fn() } as any,
    );
    const leave = jest.fn();
    const socket = {
      id: 'socket-1',
      data: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        authorizedRooms: new Set([
          'user-user-1',
          'workspace-workspace-1',
          'space-space-a',
        ]),
      },
      rooms: new Set([
        'socket-1',
        'user-user-1',
        'workspace-workspace-1',
        'space-space-a',
      ]),
      leave,
      join: jest.fn(),
    } as any;

    await expect(
      (refreshedGateway as any).refreshClientAuthorization(socket),
    ).resolves.toBe(true);

    expect(leave).toHaveBeenCalledWith('space-space-a');
    expect(socket.data.authorizedRooms).toEqual(
      new Set(['user-user-1', 'workspace-workspace-1']),
    );
  });
});
