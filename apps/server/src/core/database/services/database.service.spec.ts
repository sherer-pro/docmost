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
    findByDatabaseId: jest.fn(),
    archiveByPageIds: jest.fn(),
    archiveByDatabaseId: jest.fn(),
    softDetachRowLink: jest.fn(),
  };
  const databaseCellRepo = {
    findByDatabaseAndPage: jest.fn(),
    upsertCell: jest.fn(),
    updateCell: jest.fn(),
    softDeleteByDatabaseId: jest.fn(),
  };
  const databasePropertyRepo = {
    findById: jest.fn(),
    findByDatabaseId: jest.fn(),
    updateProperty: jest.fn(),
  };
  const databaseViewRepo = {
    softDeleteByDatabaseId: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
    getPageAndDescendants: jest.fn(),
    removePage: jest.fn(),
  };
  const pageService = { create: jest.fn() };
  const exportService = { exportPages: jest.fn() };
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const notificationQueue = {
    add: jest.fn(),
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
    exportService as any,
    spaceAbility as any,
    notificationQueue as any,
    db as any,
  );

  const user = { id: 'u-1' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([]);
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

  it('converts checkbox values to multiline text when property type changes', async () => {
    databasePropertyRepo.findById.mockResolvedValue({
      id: 'prop-1',
      databaseId: 'db-1',
      type: 'checkbox',
    });
    databasePropertyRepo.updateProperty.mockResolvedValue({ id: 'prop-1', type: 'multiline_text' });
    databaseRowRepo.findByDatabaseId.mockResolvedValue([{ pageId: 'page-1' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-1', propertyId: 'prop-1', value: true },
    ]);

    await service.updateProperty('db-1', 'prop-1', { type: 'multiline_text' }, 'ws-1');

    expect(databaseCellRepo.updateCell).toHaveBeenCalledWith('cell-1', {
      value: 'Да',
    });
  });

  it('stores fallback payload for non-convertible transitions', async () => {
    databasePropertyRepo.findById.mockResolvedValue({
      id: 'prop-1',
      databaseId: 'db-1',
      type: 'text',
    });
    databasePropertyRepo.updateProperty.mockResolvedValue({ id: 'prop-1', type: 'select' });
    databaseRowRepo.findByDatabaseId.mockResolvedValue([{ pageId: 'page-1' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-1', propertyId: 'prop-1', value: 'legacy' },
    ]);

    await service.updateProperty('db-1', 'prop-1', { type: 'select' }, 'ws-1');

    expect(databaseCellRepo.updateCell).toHaveBeenCalledWith('cell-1', {
      value: {
        value: null,
        rawValueBeforeTypeChange: 'legacy',
      },
    });
  });

  it('rolls back to source type using preserved fallback value', async () => {
    databasePropertyRepo.findById.mockResolvedValue({
      id: 'prop-1',
      databaseId: 'db-1',
      type: 'select',
    });
    databasePropertyRepo.updateProperty.mockResolvedValue({ id: 'prop-1', type: 'multiline_text' });
    databaseRowRepo.findByDatabaseId.mockResolvedValue([{ pageId: 'page-1' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      {
        id: 'cell-1',
        propertyId: 'prop-1',
        value: {
          value: null,
          rawValueBeforeTypeChange: 'legacy',
        },
      },
    ]);

    await service.updateProperty('db-1', 'prop-1', { type: 'multiline_text' }, 'ws-1');

    expect(databaseCellRepo.updateCell).toHaveBeenCalledWith('cell-1', {
      value: 'legacy',
    });
  });

  it('sends notification when user cell assignee changes', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'row-page-1',
      workspaceId: 'ws-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue({
      id: 'row-1',
      databaseId: 'db-1',
      pageId: 'row-page-1',
      archivedAt: null,
    });
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([{ id: 'prop-user', type: 'user' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-old', propertyId: 'prop-user', value: { id: 'user-old' } },
    ]);
    databaseCellRepo.upsertCell.mockResolvedValue({
      id: 'cell-new',
      propertyId: 'prop-user',
      value: { id: 'user-new' },
    });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      { cells: [{ propertyId: 'prop-user', value: { id: 'user-new' } }] },
      user,
      'ws-1',
    );

    expect(notificationQueue.add).toHaveBeenCalledWith(
      'page-recipient-notification',
      expect.objectContaining({
        reason: 'database-user-assigned',
        candidateUserIds: ['user-new'],
      }),
    );
  });

  it('does not send duplicate notification when user value remains the same', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'row-page-1',
      workspaceId: 'ws-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue({
      id: 'row-1',
      databaseId: 'db-1',
      pageId: 'row-page-1',
      archivedAt: null,
    });
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([{ id: 'prop-user', type: 'user' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-old', propertyId: 'prop-user', value: { id: 'user-old' } },
    ]);
    databaseCellRepo.upsertCell.mockResolvedValue({
      id: 'cell-new',
      propertyId: 'prop-user',
      value: { id: 'user-old' },
    });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      { cells: [{ propertyId: 'prop-user', value: { id: 'user-old' } }] },
      user,
      'ws-1',
    );

    expect(notificationQueue.add).not.toHaveBeenCalled();
  });

});
