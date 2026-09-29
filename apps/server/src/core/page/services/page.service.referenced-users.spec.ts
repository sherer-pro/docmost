jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { BadRequestException } from '@nestjs/common';
import { PageService } from './page.service';

const ASSIGNEE_ID = '11111111-1111-4111-8111-111111111111';
const STAKEHOLDER_ID = '22222222-2222-4222-8222-222222222222';
const CELL_USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';

describe('PageService referenced user identities', () => {
  const databaseRowRepo = { findActiveByPageId: jest.fn() };
  const databaseRepo = { findById: jest.fn() };
  const databasePropertyRepo = { findByDatabaseId: jest.fn() };
  const databaseCellRepo = { findByDatabaseAndPage: jest.fn() };
  const userRepo = { findByIds: jest.fn() };
  const pageAccessService = {
    getAssignableSpaceUserIds: jest.fn(),
  };
  const service = Object.create(PageService.prototype) as PageService;
  Object.assign(service, {
    databaseRowRepo,
    databaseRepo,
    databasePropertyRepo,
    databaseCellRepo,
    userRepo,
    pageAccessService,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    databaseRowRepo.findActiveByPageId.mockResolvedValue(null);
    databaseRepo.findById.mockResolvedValue({
      id: 'db-1',
      pageId: 'database-page-1',
      spaceId: 'space-1',
    });
    userRepo.findByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        name: `Name ${id.slice(0, 1)}`,
        email: 'private@example.test',
        avatarUrl: `/avatars/${id}`,
        workspaceId: 'workspace-1',
        deletedAt: null,
      })),
    );
  });

  const page = {
    id: 'page-1',
    spaceId: 'space-1',
    workspaceId: 'workspace-1',
    settings: {
      assigneeId: ASSIGNEE_ID,
      stakeholderIds: [STAKEHOLDER_ID],
    },
  } as any;

  it('resolves stored references without requiring current space access', async () => {
    const result = await service.resolveReferencedUsers(page, [
      ASSIGNEE_ID,
      STAKEHOLDER_ID,
      OTHER_USER_ID,
    ]);

    expect(userRepo.findByIds).toHaveBeenCalledWith(
      [ASSIGNEE_ID, STAKEHOLDER_ID],
      'workspace-1',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: ASSIGNEE_ID,
      name: 'Name 1',
      avatarUrl: `/avatars/${ASSIGNEE_ID}`,
    });
    expect(result[0]).not.toHaveProperty('email');
  });

  it('resolves only saved user cells and excludes deleted or foreign users', async () => {
    databaseRowRepo.findActiveByPageId.mockResolvedValue({ databaseId: 'db-1' });
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([
      { id: 'user-prop', type: 'user' },
      { id: 'text-prop', type: 'text' },
    ]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { propertyId: 'user-prop', value: { id: CELL_USER_ID } },
      { propertyId: 'text-prop', value: { id: OTHER_USER_ID } },
    ]);
    userRepo.findByIds.mockResolvedValue([
      {
        id: CELL_USER_ID,
        name: 'Saved User',
        avatarUrl: '/avatars/saved',
        workspaceId: 'workspace-1',
        deletedAt: null,
      },
      {
        id: ASSIGNEE_ID,
        name: 'Deleted user',
        avatarUrl: null,
        workspaceId: 'workspace-1',
        deletedAt: new Date(),
      },
      {
        id: STAKEHOLDER_ID,
        name: 'Foreign user',
        avatarUrl: null,
        workspaceId: 'workspace-2',
        deletedAt: null,
      },
    ]);

    const result = await service.resolveReferencedUsers(page, [
      CELL_USER_ID,
      ASSIGNEE_ID,
      STAKEHOLDER_ID,
      OTHER_USER_ID,
    ]);

    expect(result).toEqual([
      { id: CELL_USER_ID, name: 'Saved User', avatarUrl: '/avatars/saved' },
    ]);
    expect(databaseRowRepo.findActiveByPageId).toHaveBeenCalledWith(
      'page-1',
      'workspace-1',
    );
  });

  it('does not expose row cell users when the database is outside the page space', async () => {
    databaseRowRepo.findActiveByPageId.mockResolvedValue({ databaseId: 'db-1' });
    databaseRepo.findById.mockResolvedValue({ spaceId: 'space-2' });

    const result = await service.resolveReferencedUsers(
      page,
      [CELL_USER_ID],
    );

    expect(result).toEqual([]);
    expect(databaseCellRepo.findByDatabaseAndPage).not.toHaveBeenCalled();
  });

  it('preserves old assignments but rejects new assignments outside the space', async () => {
    pageAccessService.getAssignableSpaceUserIds.mockResolvedValue(
      new Set([CELL_USER_ID]),
    );

    await (service as any).assertNewAssignmentsAllowed(
      { assigneeId: ASSIGNEE_ID, stakeholderIds: [STAKEHOLDER_ID] },
      { assigneeId: ASSIGNEE_ID, stakeholderIds: [STAKEHOLDER_ID] },
      'space-1',
      'workspace-1',
    );
    expect(pageAccessService.getAssignableSpaceUserIds).not.toHaveBeenCalled();

    await expect(
      (service as any).assertNewAssignmentsAllowed(
        { assigneeId: null, stakeholderIds: [] },
        { assigneeId: ASSIGNEE_ID, stakeholderIds: [] },
        'space-1',
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
