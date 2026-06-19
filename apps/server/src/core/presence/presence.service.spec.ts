import { PresenceService } from './presence.service';

class FakeRedis {
  values = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  expires = new Map<string, number>();

  get(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  async smembers(key: string) {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  async srem(key: string, ...members: string[]) {
    const set = this.sets.get(key);
    if (!set) return 0;

    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    return removed;
  }

  async del(key: string) {
    const existed = this.values.delete(key);
    this.sets.delete(key);
    return existed ? 1 : 0;
  }

  multi() {
    const commands: Array<() => Promise<unknown> | unknown> = [];
    const chain = {
      set: (key: string, value: string, _mode: string, ttl: number) => {
        commands.push(() => {
          this.values.set(key, value);
          this.expires.set(key, ttl);
        });
        return chain;
      },
      sadd: (key: string, member: string) => {
        commands.push(() => {
          const set = this.sets.get(key) ?? new Set<string>();
          set.add(member);
          this.sets.set(key, set);
        });
        return chain;
      },
      pexpire: (key: string, ttl: number) => {
        commands.push(() => {
          this.expires.set(key, ttl);
        });
        return chain;
      },
      del: (key: string) => {
        commands.push(() => this.del(key));
        return chain;
      },
      srem: (key: string, member: string) => {
        commands.push(() => this.srem(key, member));
        return chain;
      },
      exec: async () => {
        for (const command of commands) {
          await command();
        }
        return [];
      },
    };

    return chain;
  }
}

function createService(overrides: Record<string, unknown> = {}) {
  const redis = new FakeRedis();
  const pageRepo = {
    findById: jest.fn(),
  };
  const spaceRepo = {
    findById: jest.fn(),
  };
  const spaceMemberRepo = {
    getUserSpaceIds: jest.fn(async () => ['space-1']),
  };
  const pageAccessService = {
    getEffectiveAccess: jest.fn(async () => ({
      capabilities: { canRead: true },
    })),
    isWorkspaceBypassUser: jest.fn(() => false),
  };
  Object.assign(pageRepo, overrides.pageRepo ?? {});
  Object.assign(spaceRepo, overrides.spaceRepo ?? {});
  Object.assign(pageAccessService, overrides.pageAccessService ?? {});

  const service = new PresenceService(
    { getOrThrow: () => redis } as any,
    pageRepo as any,
    spaceRepo as any,
    spaceMemberRepo as any,
    pageAccessService as any,
  );

  return {
    service,
    redis,
    pageRepo,
    spaceRepo,
    spaceMemberRepo,
    pageAccessService,
  };
}

describe('PresenceService', () => {
  const user = {
    id: 'user-1',
    workspaceId: 'workspace-1',
    role: 'member',
  } as any;

  it('groups multiple sockets by session and dedupes locations', async () => {
    const { service } = createService();

    await service.updateConnection(
      {
        socketId: 'socket-1',
        user,
        sessionId: 'session-1',
        deviceName: 'Chrome on Windows',
      },
      { type: 'workspace', path: '/home', tabId: 'tab-1' },
    );

    await service.updateConnection(
      {
        socketId: 'socket-2',
        user,
        sessionId: 'session-1',
        deviceName: 'Chrome on Windows',
      },
      { type: 'workspace', path: '/settings/members', tabId: 'tab-2' },
    );

    await service.updateConnection(
      {
        socketId: 'socket-3',
        user,
        sessionId: 'session-2',
        deviceName: 'Firefox on Linux',
      },
      { type: 'workspace', path: '/home', tabId: 'tab-3' },
    );

    const result = await service.getWorkspaceMembersPresence('workspace-1', [
      'user-1',
    ]);

    expect(result.users['user-1'].isOnline).toBe(true);
    expect(result.users['user-1'].sessions).toHaveLength(2);
    expect(
      result.users['user-1'].sessions.find(
        (session) => session.sessionId === 'session-1',
      )?.locations,
    ).toHaveLength(2);
  });

  it('removes stale socket ids while reading member presence', async () => {
    const { service, redis } = createService();
    redis.sets.set(
      'presence:workspace:workspace-1:user:user-1:connections',
      new Set(['stale-socket']),
    );

    const result = await service.getWorkspaceMembersPresence('workspace-1', [
      'user-1',
    ]);

    expect(result.users['user-1'].isOnline).toBe(false);
    expect(
      redis.sets.get('presence:workspace:workspace-1:user:user-1:connections')
        ?.size,
    ).toBe(0);
  });

  it('canonicalizes readable page locations before storing presence', async () => {
    const setup = createService();
    setup.pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      title: 'Roadmap',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      deletedAt: null,
      space: { name: 'Product', slug: 'product' },
    });

    await setup.service.updateConnection(
      {
        socketId: 'socket-1',
        user,
        sessionId: 'session-1',
        deviceName: 'Chrome on Windows',
      },
      { type: 'page', pageId: 'page-1', path: '/s/product/p/roadmap' },
    );

    const raw = setup.redis.values.get('presence:connection:socket-1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).location).toEqual(
      expect.objectContaining({
        type: 'page',
        pageId: 'page-1',
        title: 'Roadmap',
        spaceName: 'Product',
      }),
    );
  });

  it('does not store unreadable page locations', async () => {
    const setup = createService({
      pageAccessService: {
        getEffectiveAccess: jest.fn(async () => ({
          capabilities: { canRead: false },
        })),
      },
    });
    setup.pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      title: 'Hidden',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      deletedAt: null,
      space: { name: 'Product', slug: 'product' },
    });

    await setup.service.updateConnection(
      {
        socketId: 'socket-1',
        user,
        sessionId: 'session-1',
        deviceName: 'Chrome on Windows',
      },
      { type: 'page', pageId: 'page-1', path: '/s/product/p/hidden' },
    );

    expect(setup.redis.values.has('presence:connection:socket-1')).toBe(false);
  });
});
