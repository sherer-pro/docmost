jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { ConflictException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import {
  deserializeCustomEventError,
  RedisSyncExtension,
  serializeCustomEventError,
} from './redis-sync.extension';

class MemoryRedisBackend {
  readonly locks = new Map<string, string>();
  readonly clients: MemoryRedisClient[] = [];
}

class MemoryRedisClient extends EventEmitter {
  readonly subscribe = jest.fn().mockResolvedValue(2);
  readonly publish = jest.fn().mockResolvedValue(1);
  readonly disconnect = jest.fn();
  readonly set = jest.fn(
    async (key: string, owner: string, ...args: unknown[]) => {
      const isClaim = args.includes('NX') && args.includes('GET');
      if (!isClaim) {
        this.backend.locks.set(key, owner);
        return 'OK';
      }

      const existing = this.backend.locks.get(key);
      if (existing) {
        return existing;
      }
      this.backend.locks.set(key, owner);
      return null;
    },
  );
  readonly eval = jest.fn(
    async (script: string, _keyCount: number, key: string, owner: string) => {
      if (this.backend.locks.get(key) !== owner) {
        return 0;
      }
      if (script.includes("redis.call('DEL'")) {
        this.backend.locks.delete(key);
      }
      return 1;
    },
  );

  constructor(private readonly backend: MemoryRedisBackend) {
    super();
    backend.clients.push(this);
  }

  duplicate(): MemoryRedisClient {
    return new MemoryRedisClient(this.backend);
  }
}

type TestEvents = {
  noop: (documentName: string, payload: unknown) => Promise<unknown>;
};

function createExtension(
  backend: MemoryRedisBackend,
  serverId: string,
  lockTTL = 1_000,
  onLeaseLoss?: (documentName: string) => Promise<void> | void,
): RedisSyncExtension<TestEvents> {
  return new RedisSyncExtension<TestEvents>({
    redis: new MemoryRedisClient(backend) as any,
    serverId,
    lockTTL,
    pack: (message) => Buffer.from(JSON.stringify(message)),
    unpack: (message) => JSON.parse(Buffer.from(message).toString('utf8')),
    customEvents: {
      noop: async () => undefined,
    },
    onLeaseLoss,
  });
}

function createInstance(documentName?: string) {
  const documents = new Map<string, any>();
  if (documentName) {
    documents.set(documentName, { name: documentName });
  }

  return {
    documents,
    closeConnections: jest.fn(),
    unloadDocument: jest.fn(async (document: { name: string }) => {
      documents.delete(document.name);
    }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RedisSyncExtension custom event errors', () => {
  it('preserves a structured HTTP 409 across the Redis envelope', () => {
    const serialized = serializeCustomEventError(
      new ConflictException({
        code: 'page_template_stale',
        message: 'The document changed',
      }),
    );
    const restored = deserializeCustomEventError(serialized);

    expect(restored.getStatus()).toBe(409);
    expect(restored.getResponse()).toEqual({
      code: 'page_template_stale',
      message: 'The document changed',
    });
  });

  it('does not expose unexpected internal errors', () => {
    expect(serializeCustomEventError(new Error('database secret'))).toEqual({
      status: 500,
      response: { message: 'Collaboration operation failed' },
      message: 'Collaboration operation failed',
    });
  });
});

describe('RedisSyncExtension document lease', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows only the owner to renew or release a document lock', async () => {
    const backend = new MemoryRedisBackend();
    const first = createExtension(backend, 'server-a');
    const second = createExtension(backend, 'server-b');
    await first.onConfigure({ instance: createInstance() } as any);
    await second.onConfigure({ instance: createInstance() } as any);

    const releaseFirst = await first.lockDocument('page-1');
    await expect(second.lockDocument('page-1')).rejects.toThrow(
      'Could not lock document',
    );

    expect(await releaseFirst()).toBe(1);
    jest.advanceTimersByTime(500);
    await flushPromises();
    const releaseSecond = await second.lockDocument('page-1');
    expect(backend.locks.get('collabLock:page-1')).toBe('server-b');

    expect(await releaseFirst()).toBe(0);
    expect(backend.locks.get('collabLock:page-1')).toBe('server-b');

    await releaseSecond();
    await first.onDestroy();
    await second.onDestroy();
  });

  it('runs lease renewals sequentially', async () => {
    const backend = new MemoryRedisBackend();
    const extension = createExtension(backend, 'server-a');
    await extension.onConfigure({ instance: createInstance() } as any);
    const release = await extension.lockDocument('page-1');
    const publisher = backend.clients[1];

    let resolveRenewal!: (value: 0 | 1) => void;
    publisher.eval.mockImplementationOnce(
      () =>
        new Promise<0 | 1>((resolve) => {
          resolveRenewal = resolve;
        }),
    );

    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(publisher.eval).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(2_000);
    await flushPromises();
    expect(publisher.eval).toHaveBeenCalledTimes(2);

    resolveRenewal(1);
    await flushPromises();
    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(publisher.eval).toHaveBeenCalledTimes(3);

    await release();
    await extension.onDestroy();
  });

  it('closes connections and unloads the document after ownership loss', async () => {
    const backend = new MemoryRedisBackend();
    const extension = createExtension(backend, 'server-a');
    const instance = createInstance('page-1');
    await extension.onConfigure({ instance } as any);
    await extension.lockDocument('page-1');

    backend.locks.set('collabLock:page-1', 'server-b');
    jest.advanceTimersByTime(500);
    await flushPromises();

    expect(instance.closeConnections).toHaveBeenCalledWith('page-1');
    expect(instance.unloadDocument).toHaveBeenCalledWith({ name: 'page-1' });
    expect(instance.documents.has('page-1')).toBe(false);

    await extension.onDestroy();
  });

  it('abandons a dirty local document before lease-loss unload', async () => {
    const backend = new MemoryRedisBackend();
    let dirty = true;
    const onLeaseLoss = jest.fn(async () => {
      dirty = false;
    });
    const extension = createExtension(
      backend,
      'server-a',
      1_000,
      onLeaseLoss,
    );
    const documents = new Map<string, any>([
      ['page-1', { name: 'page-1' }],
    ]);
    const instance = {
      documents,
      closeConnections: jest.fn(),
      unloadDocument: jest.fn(async (document: { name: string }) => {
        if (!dirty) {
          documents.delete(document.name);
        }
      }),
    };
    await extension.onConfigure({ instance } as any);
    await extension.lockDocument('page-1');

    backend.locks.set('collabLock:page-1', 'server-b');
    jest.advanceTimersByTime(500);
    await flushPromises();

    expect(onLeaseLoss).toHaveBeenCalledWith('page-1');
    expect(instance.unloadDocument).toHaveBeenCalled();
    expect(documents.has('page-1')).toBe(false);

    await extension.onDestroy();
  });

  it('closes proxy sockets locally during shutdown', async () => {
    const backend = new MemoryRedisBackend();
    const extension = createExtension(backend, 'server-a');
    const proxySocket = { emit: jest.fn() };
    (extension as any).proxySockets = { socket: proxySocket };

    extension.closeProxyConnectionsForShutdown();

    expect(proxySocket.emit).toHaveBeenCalledWith(
      'close',
      1000,
      Buffer.from('provider_initiated', 'utf-8'),
    );
    expect((extension as any).proxySockets).toEqual({});

    await extension.onDestroy();
    expect(backend.clients).toHaveLength(3);
    expect(
      backend.clients.every(
        (client) => client.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
});
