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
  data: { authorizedRooms?: Set<string> };
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

  beforeAll(async () => {
    ({ WsGateway: WsGatewayClass } = await import('./ws.gateway'));
  });

  beforeEach(() => {
    gateway = new WsGatewayClass({} as any, {} as any);
  });

  it('ретранслирует сообщение только в авторизованную space-комнату', () => {
    const socket = createSocketMock(['space-space-a']);

    gateway.handleMessage(socket as any, {
      operation: 'updateOne',
      targetRoom: 'space-space-a',
      spaceId: 'space-a',
      data: { pageId: 'p-1' },
    });

    expect(socket.broadcast.to).toHaveBeenCalledWith('space-space-a');
    expect(socket.broadcast.to.mock.results[0].value.emit).toHaveBeenCalledWith(
      'message',
      expect.objectContaining({ targetRoom: 'space-space-a' }),
    );
  });

  it('блокирует межпространственную ретрансляцию в неавторизованную комнату', () => {
    const socket = createSocketMock(['space-space-a']);

    gateway.handleMessage(socket as any, {
      operation: 'updateOne',
      targetRoom: 'space-space-b',
      spaceId: 'space-b',
      data: { pageId: 'p-2' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('блокирует ретрансляцию, если сокет не состоит в целевой комнате', () => {
    const socket = createSocketMock(['workspace-workspace-a'], []);

    gateway.handleMessage(socket as any, {
      operation: 'workspace-event',
      targetRoom: 'workspace-workspace-a',
      workspaceId: 'workspace-a',
      data: { title: 'new title' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('отклоняет payload без обязательного workspaceId для workspace-комнаты', () => {
    const socket = createSocketMock(['workspace-workspace-a']);

    gateway.handleMessage(socket as any, {
      operation: 'workspace-event',
      targetRoom: 'workspace-workspace-a',
      data: { title: 'new title' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });

  it('отклоняет payload с несогласованными room и spaceId', () => {
    const socket = createSocketMock(['space-space-a']);

    gateway.handleMessage(socket as any, {
      operation: 'updateOne',
      targetRoom: 'space-space-a',
      spaceId: 'space-b',
      data: { pageId: 'p-2' },
    });

    expect(socket.broadcast.to).not.toHaveBeenCalled();
  });
});
