import { PushSubscriptionRepo } from './push-subscription.repo';

describe('Push subscription quota decisions', () => {
  const subscription = {
    userId: 'user',
    workspaceId: 'workspace',
    endpoint: 'https://push.example/device',
    p256dh: 'key',
    auth: 'auth',
  };
  function setup(count: number, existing = false) {
    const query: any = {};
    for (const key of [
      'select',
      'where',
      'forUpdate',
      'values',
      'onConflict',
      'returningAll',
    ])
      query[key] = jest.fn(() => query);
    query.executeTakeFirst = jest.fn(async () =>
      existing ? { id: 'existing' } : undefined,
    );
    query.executeTakeFirstOrThrow = jest
      .fn()
      .mockResolvedValueOnce({ id: 'user' });
    if (!existing)
      query.executeTakeFirstOrThrow.mockResolvedValueOnce({
        count: String(count),
      });
    query.executeTakeFirstOrThrow.mockResolvedValue({ id: 'saved' });
    const trx = {
      selectFrom: jest.fn(() => query),
      insertInto: jest.fn(() => query),
    };
    const db = {
      transaction: () => ({ execute: (callback) => callback(trx) }),
    };
    return { repo: new PushSubscriptionRepo(db as any), trx, query };
  }
  it.each([10, 13])(
    'rejects new subscriptions at %s active without deleting old devices',
    async (count) => {
      const { repo, trx, query } = setup(count);
      await expect(repo.upsert(subscription)).rejects.toMatchObject({
        status: 429,
        response: { code: 'push_subscription_limit' },
      });
      expect(trx.insertInto).not.toHaveBeenCalled();
      expect(query.forUpdate).toHaveBeenCalledTimes(1);
      expect(query.where).toHaveBeenCalledWith('workspaceId', '=', 'workspace');
    },
  );
  it.each([10, 13])(
    'allows renewal at %s active subscriptions',
    async (count) => {
      const { repo, trx } = setup(count, true);
      await expect(repo.upsert(subscription)).resolves.toEqual({ id: 'saved' });
      expect(trx.insertInto).toHaveBeenCalledTimes(1);
    },
  );
  it('admits the tenth device after counting only active subscriptions', async () => {
    const { repo, query } = setup(9);
    await expect(repo.upsert(subscription)).resolves.toEqual({ id: 'saved' });
    expect(query.where).toHaveBeenCalledWith('revokedAt', 'is', null);
  });
});
