import { UserTokenRepo } from './user-token.repo';

describe('UserTokenRepo', () => {
  it('consumes a reset token with an atomic unused-and-unexpired predicate', async () => {
    const consumed = { id: 'token-1', usedAt: new Date() };
    const query: any = {
      set: jest.fn(() => query),
      where: jest.fn(() => query),
      returningAll: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(consumed),
    };
    const repo = new UserTokenRepo({
      updateTable: jest.fn(() => query),
    } as any);

    await expect(
      repo.consumeActiveToken('token-1', 'workspace-1', 'forgot-password'),
    ).resolves.toBe(consumed);

    expect(query.where).toHaveBeenCalledWith('id', '=', 'token-1');
    expect(query.where).toHaveBeenCalledWith('workspaceId', '=', 'workspace-1');
    expect(query.where).toHaveBeenCalledWith('type', '=', 'forgot-password');
    expect(query.where).toHaveBeenCalledWith('usedAt', 'is', null);
    expect(query.where).toHaveBeenCalledWith(
      'expiresAt',
      '>',
      expect.any(Date),
    );
  });
});
