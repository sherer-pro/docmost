jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';

describe('DatabaseService mixed tree flows', () => {
  const databaseRepo = {
    findById: jest.fn(),
    softDeleteDatabase: jest.fn(),
    updateDatabase: jest.fn(),
  };
  const databaseRowRepo = {
    findByDatabaseAndPage: jest.fn(),
    archiveByPageIds: jest.fn(),
    archiveByDatabaseId: jest.fn(),
    softDetachRowLink: jest.fn(),
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

  const trx = {
    updateTable: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            where: jest.fn(() => ({ execute: jest.fn() })),
          })),
        })),
      })),
    })),
  };

  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn(async (cb) => cb(trx)),
    })),
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
    db as any,
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

  it('soft-detaches descendants row links and removes descendants pages on row delete', async () => {
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

    expect(databaseRowRepo.softDetachRowLink).toHaveBeenCalledTimes(2);
    expect(databaseRowRepo.softDetachRowLink).toHaveBeenNthCalledWith(
      1,
      'db-1',
      'row-page-1',
      'ws-1',
    );
    expect(databaseRowRepo.softDetachRowLink).toHaveBeenNthCalledWith(
      2,
      'db-1',
      'row-page-1-child',
      'ws-1',
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

  it('converts database to page without deleting row cell values', async () => {
    pageRepo.findById.mockResolvedValue({ id: 'db-root-page' });

    await service.convertDatabaseToPage('db-1', user, 'ws-1');

    expect(databaseRowRepo.archiveByDatabaseId).toHaveBeenCalledWith('db-1', 'ws-1', trx);
    expect(databaseCellRepo.softDeleteByDatabaseId).not.toHaveBeenCalled();
    expect(databaseViewRepo.softDeleteByDatabaseId).toHaveBeenCalledWith('db-1', 'ws-1', trx);
    expect(databaseRepo.updateDatabase).toHaveBeenCalled();
  });
});
