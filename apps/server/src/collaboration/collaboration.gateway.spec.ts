import { EventEmitter } from 'node:events';

jest.mock('lib0/decoding.js', () => ({
  readVarString: jest.fn(),
}));
jest.mock('nanoid', () => ({
  customAlphabet: jest.fn(() => jest.fn(() => 'synthetic-nanoid')),
  nanoid: jest.fn(() => 'synthetic-server-id'),
}));

describe('CollaborationGateway', () => {
  it('closes a proxied client when Redis message forwarding fails', async () => {
    const { CollaborationGateway } = await import('./collaboration.gateway');
    const gateway = Object.create(
      CollaborationGateway.prototype,
    ) as InstanceType<typeof CollaborationGateway>;
    const forwardingFailure = new Error('synthetic redis publish failure');
    const rejectedForward = {
      catch: jest.fn((handler: (error: Error) => void) => {
        handler(forwardingFailure);
        return Promise.resolve();
      }),
    };
    const redisSync = {
      onSocketOpen: jest.fn(),
      onSocketMessage: jest.fn(() => rejectedForward),
      onSocketClose: jest.fn(),
    };
    const client = new EventEmitter() as EventEmitter & {
      close: jest.Mock;
      ping: jest.Mock;
      send: jest.Mock;
    };
    client.close = jest.fn();
    client.ping = jest.fn();
    client.send = jest.fn();
    (gateway as any).redisSync = redisSync;
    (gateway as any).logger = { error: jest.fn() };

    gateway.handleConnection(client as any, {
      method: 'GET',
      url: '/collab',
      headers: {
        'sec-websocket-key': 'synthetic-socket-id',
        'sec-websocket-protocol': '',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as any);

    client.emit('message', Buffer.from([0]));

    expect(rejectedForward.catch).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledWith(
      1011,
      'Collaboration forwarding failed',
    );
  });
});
