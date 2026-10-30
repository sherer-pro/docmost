jest.mock('../../../common/helpers', () => ({
  hashPassword: jest.fn(async () => 'synthetic-hash'),
}));
import { UserRepo } from './user.repo';

describe('UserRepo initial editor preference', () => {
  function setup(mode: unknown) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn(async () => ({
        settings: { editor: { defaultPageEditMode: mode } },
      })),
    };
    const insert: any = {
      values: jest.fn(() => insert),
      returning: jest.fn(() => insert),
      executeTakeFirst: jest.fn(async () => insert.values.mock.calls[0][0]),
    };
    const db: any = {
      selectFrom: jest.fn(() => query),
      insertInto: jest.fn(() => insert),
    };
    return { repo: new UserRepo(db), db };
  }

  it('copies the workspace preference only when inserting a new user', async () => {
    const { repo, db } = setup('edit');
    const user = await repo.insertUser({
      email: 'new@example.test',
      workspaceId: 'workspace',
      settings: { preferences: { pageEditModeByPageId: { page: 'read' } } },
    } as any);
    expect(user.settings).toEqual({
      preferences: {
        defaultPageEditMode: 'edit',
        pageEditModeByPageId: { page: 'read' },
      },
    });
    expect(db.selectFrom).toHaveBeenCalledWith('workspaces');
  });

  it('preserves an explicit imported preference', async () => {
    const { repo } = setup('edit');
    const user = await repo.insertUser({
      email: 'new@example.test',
      workspaceId: 'workspace',
      settings: { preferences: { defaultPageEditMode: 'read' } },
    } as any);
    expect((user.settings as any).preferences.defaultPageEditMode).toBe('read');
  });

  it.each([undefined, 'invalid', 'read'])(
    'uses read for an unset or invalid workspace preference %p',
    async (mode) => {
      const { repo } = setup(mode);
      const user = await repo.insertUser({
        email: 'new@example.test',
        workspaceId: 'workspace',
      } as any);
      expect((user.settings as any).preferences.defaultPageEditMode).toBe(
        'read',
      );
    },
  );

  it('does not require a workspace during initial owner setup', async () => {
    const { repo, db } = setup('edit');
    await repo.insertUser({ email: 'owner@example.test' } as any);
    expect(db.selectFrom).not.toHaveBeenCalled();
  });
});
