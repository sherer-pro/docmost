jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';

describe('DatabaseService mixed tree flows', () => {
  const databaseRepo = {
    findById: jest.fn(),
    softDeleteDatabase: jest.fn(),
  };
  const databaseRowRepo = {
    findByDatabaseAndPage: jest.fn(),
    archiveByPageIds: jest.fn(),
    archiveByDatabaseId: jest.fn(),
  };
  const databaseCellRepo = {
    softDeleteByDatabaseId: jest.fn(),
  };
  const databasePropertyRepo = {};
  const databaseViewRepo = {
    softDeleteByDatabaseId: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
    getPageAndDescendants: jest.fn(),
    removePage: jest.fn(),
  };
  const pageService = { create: jest.fn() };
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };

  const service = new DatabaseService(
    databaseRepo as any,
    databaseRowRepo as any,
    databaseCellRepo as any,
    databasePropertyRepo as any,
    databaseViewRepo as any,
    pageRepo as any,
    pageService as any,
    spaceAbility as any,
  );

  const user = { id: 'u-1' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    databaseRepo.findById.mockResolvedValue({
      id: 'db-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      pageId: 'db-root-page',
      creatorId: 'u-1',
      lastUpdatedById: 'u-2',
    });
  });

  it('archives descendants rows and removes descendants pages on row delete', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'row-page-1',
      workspaceId: 'ws-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue({
      databaseId: 'db-1',
      pageId: 'row-page-1',
      archivedAt: null,
    });
    pageRepo.getPageAndDescendants.mockResolvedValue([
      { id: 'row-page-1' },
      { id: 'row-page-1-child' },
    ]);

    await service.deleteRow('db-1', 'row-page-1', user, 'ws-1');

    expect(databaseRowRepo.archiveByPageIds).toHaveBeenCalledWith(
      'db-1',
      'ws-1',
      ['row-page-1', 'row-page-1-child'],
    );
    expect(pageRepo.removePage).toHaveBeenCalledWith('row-page-1', 'u-1', 'ws-1');
  });

  it('throws when row page is not accessible in current space', async () => {
    pageRepo.findById.mockResolvedValue(null);

    await expect(
      service.deleteRow('db-1', 'row-page-1', user, 'ws-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives database descendants and removes root page on database delete', async () => {
    pageRepo.getPageAndDescendants.mockResolvedValue([
      { id: 'db-root-page' },
      { id: 'row-page-1' },
      { id: 'regular-page-under-db' },
    ]);

    await service.deleteDatabase('db-1', 'ws-1');

    expect(databaseCellRepo.softDeleteByDatabaseId).toHaveBeenCalledWith('db-1', 'ws-1');
    expect(databaseViewRepo.softDeleteByDatabaseId).toHaveBeenCalledWith('db-1', 'ws-1');
    expect(databaseRowRepo.archiveByPageIds).toHaveBeenCalledWith(
      'db-1',
      'ws-1',
      ['db-root-page', 'row-page-1', 'regular-page-under-db'],
    );
    expect(pageRepo.removePage).toHaveBeenCalledWith('db-root-page', 'u-2', 'ws-1');
    expect(databaseRepo.softDeleteDatabase).toHaveBeenCalledWith('db-1', 'ws-1');
  });
});
