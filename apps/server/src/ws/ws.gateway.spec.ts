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
  data: {
    authorizedRooms?: Set<string>;
    user?: Record<string, unknown>;
    sessionId?: string | null;
    deviceName?: string | null;
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
    );
    (gateway as any).server = {
      sockets: {
        adapter: {
          rooms: new Map(),
        },
        sockets: new Map(),
      },
    };
    jest.clearAllMocks();
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
});
