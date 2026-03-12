jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
jest.mock('../../../integrations/export/utils', () => {
  const actual = jest.requireActual('../../../integrations/export/utils');

  return {
    ...actual,
    replaceInternalLinks: jest.fn((content: unknown) => content),
  };
});
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';
import * as JSZip from 'jszip';
import { DatabaseExportFormat } from '../dto/database.dto';
import { ExportFormat } from '../../../integrations/export/dto/export-dto';

describe('DatabaseService mixed tree flows', () => {
  const databaseRepo = {
    findById: jest.fn(),
    softDeleteDatabase: jest.fn(),
    updateDatabase: jest.fn(),
  };
  const databaseRowRepo = {
    findByDatabaseAndPage: jest.fn(),
    findByDatabaseId: jest.fn(),
    findByDatabaseIdPaginated: jest.fn(),
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
    insertProperty: jest.fn(),
    updateProperty: jest.fn(),
    softDeleteProperty: jest.fn(),
  };
  const databaseViewRepo = {
    softDeleteByDatabaseId: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
    updatePage: jest.fn(),
    getPageAndDescendants: jest.fn(),
    removePage: jest.fn(),
  };
  const pageService = { create: jest.fn() };
  const exportService = {
    exportPages: jest.fn(),
    turnPageMentionsToLinks: jest.fn(),
    buildPagePdfBody: jest.fn(),
    renderPdfFromHtmlDocument: jest.fn(),
  };
  const userRepo = { findById: jest.fn() };
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const pageHistoryRecorder = {
    recordPageEvent: jest.fn(),
    enqueuePageEvents: jest.fn(),
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
    userRepo as any,
    spaceAbility as any,
    pageHistoryRecorder as any,
    notificationQueue as any,
    db as any,
  );

  const user = { id: 'u-1', locale: 'ru-RU' } as any;

  const streamToBuffer = async (
    stream: NodeJS.ReadableStream,
  ): Promise<Buffer> => {
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
          return;
        }

        chunks.push(Buffer.from(chunk));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    const defaultPagesZip = new JSZip();
    defaultPagesZip.file('Root.pdf', Buffer.from('root-pdf-original'));
    defaultPagesZip.file(
      'docmost-metadata.json',
      JSON.stringify({
        pages: {
          'Root.pdf': {
            pageId: 'db-root-page',
            slugId: 'root-slug',
            parentPath: null,
            icon: null,
            position: 'a1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    exportService.exportPages.mockResolvedValue(
      defaultPagesZip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
      }),
    );
    exportService.turnPageMentionsToLinks.mockImplementation(async (content: unknown) => content);
    exportService.buildPagePdfBody.mockResolvedValue({
      title: 'Root',
      bodyHtml: '<article>Root content</article>',
      attachmentToken: 'attachment-page-token',
    });
    exportService.renderPdfFromHtmlDocument.mockResolvedValue(
      Buffer.from('%PDF-1.7 mock'),
    );
    databaseRowRepo.findByDatabaseId.mockResolvedValue([]);
    databaseRowRepo.findByDatabaseIdPaginated.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([]);
    userRepo.findById.mockResolvedValue(null);
    databaseRepo.findById.mockResolvedValue({
      id: 'db-1',
      name: 'Database',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      pageId: 'db-root-page',
      creatorId: 'u-1',
      lastUpdatedById: 'u-2',
    });
    pageRepo.findById.mockResolvedValue({
      id: 'db-root-page',
      title: 'Root',
      slugId: 'root-slug',
      content: { type: 'doc', content: [] },
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      parentPageId: null,
      deletedAt: null,
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

  it('exports database pdf as zip with merged root pdf only', async () => {
    const exported = await service.exportDatabase(
      'db-1',
      DatabaseExportFormat.PDF,
      user,
      'ws-1',
      false,
    );

    expect(exported.contentType).toBe('application/zip');
    expect(exported.fileName).toBe('database.zip');
    expect(exportService.exportPages).toHaveBeenCalledWith(
      'db-root-page',
      ExportFormat.PDF,
      false,
      false,
      'ru-RU',
    );
    expect(exportService.buildPagePdfBody).toHaveBeenCalledWith(
      expect.objectContaining({
        page: expect.objectContaining({
          id: 'db-root-page',
        }),
        locale: 'ru-RU',
      }),
    );
    expect(exportService.renderPdfFromHtmlDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Root',
        bodyHtml: expect.stringContaining('<table>'),
      }),
    );
    expect(exported.fileStream).toBeDefined();

    const zipBuffer = await streamToBuffer(exported.fileStream as NodeJS.ReadableStream);
    const zip = await JSZip.loadAsync(zipBuffer);
    const rootPdfEntry = zip.file('Root.pdf');
    const tablePdfEntry = zip.file('database-table.pdf');

    expect(rootPdfEntry).toBeDefined();
    expect(tablePdfEntry).toBeNull();
    if (!rootPdfEntry) {
      throw new Error('Root PDF entry is missing');
    }
    const rootPdfBuffer = await rootPdfEntry.async('nodebuffer');
    expect(rootPdfBuffer.toString('utf8')).toContain('%PDF-1.7 mock');
  });

  it('renders readable table values in database summary PDF html', async () => {
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([
      {
        id: 'prop-select',
        name: 'Status',
        type: 'select',
        settings: {
          options: [{ value: 'in_progress', label: 'In progress' }],
        },
      },
      { id: 'prop-user', name: 'Assignee', type: 'user', settings: {} },
      { id: 'prop-checkbox', name: 'Done', type: 'checkbox', settings: {} },
    ]);
    databaseRowRepo.findByDatabaseId.mockResolvedValue([
      {
        id: 'row-1',
        pageTitle: 'Task 1',
        cells: [
          { propertyId: 'prop-select', value: 'in_progress' },
          { propertyId: 'prop-user', value: { id: 'user-1' } },
          { propertyId: 'prop-checkbox', value: true },
        ],
      },
    ]);
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      name: 'Alice',
      workspaceId: 'ws-1',
    });

    await service.exportDatabase(
      'db-1',
      DatabaseExportFormat.PDF,
      user,
      'ws-1',
      false,
    );

    const payload = exportService.renderPdfFromHtmlDocument.mock.calls[0][0];
    expect(payload.bodyHtml).toContain('<td>In progress</td>');
    expect(payload.bodyHtml).toContain('<td>Alice</td>');
    expect(payload.bodyHtml).toContain('<td>true</td>');
  });

  it('keeps pages-like layout and replaces only root pdf when includeChildren=true', async () => {
    databaseRepo.findById.mockResolvedValue({
      id: 'db-1',
      name: 'Main Database',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      pageId: 'db-root-page',
      creatorId: 'u-1',
      lastUpdatedById: 'u-2',
    });

    const pagesZip = new JSZip();
    pagesZip.file('Root.pdf', Buffer.from('root-pdf-original'));
    pagesZip.file('rows/Row-1.pdf', Buffer.from('row-pdf'));
    pagesZip.file(
      'docmost-metadata.json',
      JSON.stringify({
        pages: {
          'Root.pdf': {
            pageId: 'db-root-page',
            slugId: 'root-slug',
            parentPath: null,
            icon: null,
            position: 'a1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          'rows/Row-1.pdf': {
            pageId: 'row-page-1',
            slugId: 'row-1',
            parentPath: 'Root.pdf',
            icon: null,
            position: 'a2',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    exportService.exportPages.mockResolvedValue(
      pagesZip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
      }),
    );

    const exported = await service.exportDatabase(
      'db-1',
      DatabaseExportFormat.PDF,
      user,
      'ws-1',
      true,
    );

    expect(exportService.exportPages).toHaveBeenCalledWith(
      'db-root-page',
      ExportFormat.PDF,
      false,
      true,
      'ru-RU',
    );
    expect(exportService.renderPdfFromHtmlDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Root',
      }),
    );

    const zipBuffer = await streamToBuffer(exported.fileStream as NodeJS.ReadableStream);
    const zip = await JSZip.loadAsync(zipBuffer);

    const rootPdfEntry = zip.file('Root.pdf');
    const childPdfEntry = zip.file('rows/Row-1.pdf');

    expect(zip.file('main-database-table.pdf')).toBeNull();
    expect(rootPdfEntry).toBeDefined();
    expect(childPdfEntry).toBeDefined();
    expect(zip.file('docmost-metadata.json')).toBeDefined();

    if (!rootPdfEntry || !childPdfEntry) {
      throw new Error('Expected root and child PDF entries in the archive');
    }

    const [rootPdfBuffer, childPdfBuffer] = await Promise.all([
      rootPdfEntry.async('nodebuffer'),
      childPdfEntry.async('nodebuffer'),
    ]);

    expect(rootPdfBuffer.toString('utf8')).toContain('%PDF-1.7 mock');
    expect(childPdfBuffer.toString('utf8')).toBe('row-pdf');
  });

  it('forwards includeChildren/includeAttachments for markdown export', async () => {
    const exported = await service.exportDatabase(
      'db-1',
      DatabaseExportFormat.Markdown,
      user,
      'ws-1',
      true,
      true,
    );

    expect(exportService.exportPages).toHaveBeenCalledWith(
      'db-root-page',
      ExportFormat.Markdown,
      true,
      true,
      'ru-RU',
    );
    expect(exported.contentType).toBe('application/zip');
    expect(exported.fileName).toBe('database.zip');
  });

  it('supports html database export via page export pipeline', async () => {
    const exported = await service.exportDatabase(
      'db-1',
      DatabaseExportFormat.HTML,
      user,
      'ws-1',
      false,
      true,
    );

    expect(exportService.exportPages).toHaveBeenCalledWith(
      'db-root-page',
      ExportFormat.HTML,
      true,
      false,
      'ru-RU',
    );
    expect(exported.contentType).toBe('application/zip');
    expect(exported.fileName).toBe('database.zip');
  });

  it('renames row, regenerates slug and records rename history event', async () => {
    pageRepo.findById
      .mockResolvedValueOnce({
        id: 'row-page-1',
        workspaceId: 'ws-1',
        spaceId: 'space-1',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'row-page-1',
        workspaceId: 'ws-1',
        spaceId: 'space-1',
        deletedAt: null,
        title: 'Old row title',
        slugId: 'old-row-slug',
      })
      .mockResolvedValueOnce({
        id: 'row-page-1',
        workspaceId: 'ws-1',
        spaceId: 'space-1',
        deletedAt: null,
        title: 'Renamed row title',
        slugId: 'new-row-slug',
      });
    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue({
      databaseId: 'db-1',
      pageId: 'row-page-1',
      archivedAt: null,
    });

    const result = await service.updateRow(
      'db-1',
      'row-page-1',
      { title: 'Renamed row title' } as any,
      user,
      'ws-1',
    );

    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Renamed row title',
        lastUpdatedById: 'u-1',
        workspaceId: 'ws-1',
      }),
      'row-page-1',
    );
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        slugId: expect.any(String),
      }),
      'row-page-1',
    );
    expect(result).toEqual({
      pageId: 'row-page-1',
      title: 'Renamed row title',
      slugId: 'new-row-slug',
    });
    expect(pageHistoryRecorder.enqueuePageEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'database.row.renamed',
      }),
    );
  });

  it('throws when renaming archived row', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'row-page-1',
      workspaceId: 'ws-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue({
      databaseId: 'db-1',
      pageId: 'row-page-1',
      archivedAt: new Date(),
    });

    await expect(
      service.updateRow(
        'db-1',
        'row-page-1',
        { title: 'Renamed row title' } as any,
        user,
        'ws-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when renaming non-existing row', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'row-page-1',
      workspaceId: 'ws-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue(null);

    await expect(
      service.updateRow(
        'db-1',
        'row-page-1',
        { title: 'Renamed row title' } as any,
        user,
        'ws-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enriches user cells in listRows with user display names', async () => {
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([
      { id: 'prop-user', type: 'user' },
    ]);
    databaseRowRepo.findByDatabaseId.mockResolvedValue([
      {
        id: 'row-1',
        pageId: 'row-page-1',
        cells: [
          {
            propertyId: 'prop-user',
            value: { id: 'user-42' },
          },
        ],
      },
    ]);
    userRepo.findById.mockResolvedValue({
      id: 'user-42',
      name: 'Jane Doe',
      workspaceId: 'ws-1',
    });

    const rows = await service.listRows('db-1', user, 'ws-1');

    expect(rows[0].cells[0].value).toEqual({
      id: 'user-42',
      name: 'Jane Doe',
    });
  });

  it('parses serialized user cell value and does not throw on invalid user lookup', async () => {
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([
      { id: 'prop-user', type: 'user' },
    ]);
    databaseRowRepo.findByDatabaseId.mockResolvedValue([
      {
        id: 'row-1',
        pageId: 'row-page-1',
        cells: [
          {
            propertyId: 'prop-user',
            value: '{"id":"019c8501-f413-737d-8d18-536a9f78d347"}',
          },
        ],
      },
    ]);
    userRepo.findById.mockRejectedValue(
      new Error('invalid input syntax for type uuid'),
    );

    const rows = await service.listRows('db-1', user, 'ws-1');

    expect(rows[0].cells[0].value).toEqual({
      id: '019c8501-f413-737d-8d18-536a9f78d347',
      name: '019c8501-f413-737d-8d18-536a9f78d347',
    });
  });

  it('uses paginated repository flow for listRows when limit is provided', async () => {
    databaseRowRepo.findByDatabaseIdPaginated.mockResolvedValue({
      items: [{ id: 'row-1', pageId: 'row-page-1', cells: [] }],
      nextCursor: 'cursor-next',
      hasMore: true,
    });

    const result = await service.listRows('db-1', user, 'ws-1', {
      limit: 25,
      cursor: 'cursor-current',
      sortField: 'title',
      sortDirection: 'desc',
      sortPropertyId: '00000000-0000-0000-0000-000000000001',
      filters: JSON.stringify([
        {
          propertyId: '11111111-1111-4111-8111-111111111112',
          operator: 'contains',
          value: 'hello',
        },
      ]),
    } as any);

    expect(databaseRowRepo.findByDatabaseId).not.toHaveBeenCalled();
    expect(databaseRowRepo.findByDatabaseIdPaginated).toHaveBeenCalledWith(
      'db-1',
      'ws-1',
      'space-1',
      expect.objectContaining({
        limit: 25,
        cursor: 'cursor-current',
        sortField: 'title',
        sortDirection: 'desc',
        sortPropertyId: '00000000-0000-0000-0000-000000000001',
        filters: [
          {
            propertyId: '11111111-1111-4111-8111-111111111112',
            operator: 'contains',
            value: 'hello',
          },
        ],
      }),
    );
    expect(result).toEqual({
      items: [{ id: 'row-1', pageId: 'row-page-1', cells: [] }],
      nextCursor: 'cursor-next',
      hasMore: true,
    });
  });

  it('throws BadRequestException for invalid rows filters', async () => {
    await expect(
      service.listRows('db-1', user, 'ws-1', {
        limit: 20,
        filters: JSON.stringify([
          {
            propertyId: '11111111-1111-4111-8111-111111111112',
            operator: 'invalid',
            value: 'hello',
          },
        ]),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseRowRepo.findByDatabaseId).not.toHaveBeenCalled();
    expect(databaseRowRepo.findByDatabaseIdPaginated).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for rows filters with non-uuid propertyId', async () => {
    await expect(
      service.listRows('db-1', user, 'ws-1', {
        limit: 20,
        filters: JSON.stringify([
          {
            propertyId: 'not-a-uuid',
            operator: 'contains',
            value: 'hello',
          },
        ]),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseRowRepo.findByDatabaseId).not.toHaveBeenCalled();
    expect(databaseRowRepo.findByDatabaseIdPaginated).not.toHaveBeenCalled();
  });

  it('keeps linked page slug unchanged when renaming database', async () => {
    databaseRepo.findById.mockResolvedValue({
      id: 'db-1',
      name: 'Old database',
      pageId: 'db-root-page',
      workspaceId: 'ws-1',
    });
    databaseRepo.updateDatabase.mockResolvedValue({
      id: 'db-1',
      name: 'Renamed database',
      pageId: 'db-root-page',
    });
    pageRepo.findById.mockResolvedValue({
      id: 'db-root-page',
      slugId: 'stable-db-slug',
      workspaceId: 'ws-1',
    });

    const result = await service.updateDatabase(
      'db-1',
      { name: 'Renamed database' },
      'u-1',
      'ws-1',
    );

    expect(databaseRepo.updateDatabase).toHaveBeenCalledWith('db-1', 'ws-1', {
      name: 'Renamed database',
      descriptionContent: undefined,
      lastUpdatedById: 'u-1',
    });
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      {
        title: 'Renamed database',
        lastUpdatedById: 'u-1',
        workspaceId: 'ws-1',
      },
      'db-root-page',
    );
    expect(result.pageSlugId).toBe('stable-db-slug');
  });

  it('does not update linked page slug field on database rename', async () => {
    databaseRepo.findById.mockResolvedValue({
      id: 'db-1',
      name: 'Old database',
      pageId: 'db-root-page',
      workspaceId: 'ws-1',
    });
    databaseRepo.updateDatabase.mockResolvedValue({
      id: 'db-1',
      name: 'Renamed database',
      pageId: 'db-root-page',
    });
    pageRepo.findById.mockResolvedValue({
      id: 'db-root-page',
      slugId: 'stable-db-slug',
      workspaceId: 'ws-1',
    });

    await service.updateDatabase('db-1', { name: 'Renamed database' }, 'u-1', 'ws-1');

    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      expect.not.objectContaining({ slugId: expect.any(String) }),
      'db-root-page',
    );
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
    expect(pageHistoryRecorder.recordPageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'db-root-page',
        changeType: 'database.converted.to-page',
      }),
    );
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
      value: {
        value: 'Yes',
        rawValueBeforeTypeChange: true,
        rawTypeBeforeTypeChange: 'checkbox',
      },
    });
  });

  it('converts user value to member name when changing user -> multiline_text', async () => {
    databasePropertyRepo.findById.mockResolvedValue({
      id: 'prop-1',
      databaseId: 'db-1',
      type: 'user',
    });
    databasePropertyRepo.updateProperty.mockResolvedValue({ id: 'prop-1', type: 'multiline_text' });
    databaseRowRepo.findByDatabaseId.mockResolvedValue([{ pageId: 'page-1' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-1', propertyId: 'prop-1', value: { id: 'user-42' } },
    ]);
    userRepo.findById.mockResolvedValue({
      id: 'user-42',
      name: 'Jane Doe',
      workspaceId: 'ws-1',
    });

    await service.updateProperty('db-1', 'prop-1', { type: 'multiline_text' }, 'ws-1');

    expect(databaseCellRepo.updateCell).toHaveBeenCalledWith('cell-1', {
      value: {
        value: 'Jane Doe',
        rawValueBeforeTypeChange: { id: 'user-42' },
        rawTypeBeforeTypeChange: 'user',
      },
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
        rawTypeBeforeTypeChange: 'multiline_text',
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

  it('restores original values for every A->B->A type pair before manual edits', async () => {
    const propertyTypes = [
      'checkbox',
      'user',
      'multiline_text',
      'code',
      'select',
      'page_reference',
    ] as const;

    const sampleValueByType: Record<(typeof propertyTypes)[number], unknown> = {
      checkbox: true,
      user: { id: 'user-7' },
      multiline_text: 'legacy text',
      code: 'const x = 1;',
      select: 'in_progress',
      page_reference: 'page-77',
    };

    for (const fromType of propertyTypes) {
      for (const toType of propertyTypes) {
        if (fromType === toType) {
          continue;
        }

        databaseCellRepo.updateCell.mockClear();
        databasePropertyRepo.findById.mockReset();
        databasePropertyRepo.updateProperty.mockReset();
        databaseRowRepo.findByDatabaseId.mockReset();
        databaseCellRepo.findByDatabaseAndPage.mockReset();

        const initialValue = sampleValueByType[fromType];

        databasePropertyRepo.findById
          .mockResolvedValueOnce({
            id: 'prop-1',
            databaseId: 'db-1',
            type: fromType,
          })
          .mockResolvedValueOnce({
            id: 'prop-1',
            databaseId: 'db-1',
            type: toType,
          });

        databasePropertyRepo.updateProperty
          .mockResolvedValueOnce({ id: 'prop-1', type: toType })
          .mockResolvedValueOnce({ id: 'prop-1', type: fromType });

        databaseRowRepo.findByDatabaseId.mockResolvedValue([{ pageId: 'page-1' }]);

        databaseCellRepo.findByDatabaseAndPage.mockResolvedValueOnce([
          { id: 'cell-1', propertyId: 'prop-1', value: initialValue },
        ]);

        await service.updateProperty('db-1', 'prop-1', { type: toType }, 'ws-1');

        const firstConvertedValue = databaseCellRepo.updateCell.mock.calls[0][1].value;
        databaseCellRepo.findByDatabaseAndPage.mockResolvedValueOnce([
          { id: 'cell-1', propertyId: 'prop-1', value: firstConvertedValue },
        ]);

        await service.updateProperty('db-1', 'prop-1', { type: fromType }, 'ws-1');

        const rollbackValue = databaseCellRepo.updateCell.mock.calls[1][1].value;
        expect(rollbackValue).toEqual(initialValue);
      }
    }
  });

  it('clears rollback payload after manual edit in converted type', async () => {
    databasePropertyRepo.findById.mockResolvedValueOnce({
      id: 'prop-1',
      databaseId: 'db-1',
      type: 'multiline_text',
    });
    databasePropertyRepo.updateProperty.mockResolvedValueOnce({ id: 'prop-1', type: 'select' });
    databaseRowRepo.findByDatabaseId.mockResolvedValueOnce([{ pageId: 'row-page-1' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValueOnce([
      { id: 'cell-1', propertyId: 'prop-1', value: 'legacy' },
    ]);

    await service.updateProperty('db-1', 'prop-1', { type: 'select' }, 'ws-1');

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
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([{ id: 'prop-1', type: 'select' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      {
        id: 'cell-1',
        propertyId: 'prop-1',
        value: {
          value: null,
          rawValueBeforeTypeChange: 'legacy',
          rawTypeBeforeTypeChange: 'multiline_text',
        },
      },
    ]);
    databaseCellRepo.upsertCell.mockResolvedValue({
      id: 'cell-1',
      propertyId: 'prop-1',
      value: 'in_progress',
    });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      { cells: [{ propertyId: 'prop-1', value: 'in_progress' }] },
      user,
      'ws-1',
    );

    databasePropertyRepo.findById.mockResolvedValueOnce({
      id: 'prop-1',
      databaseId: 'db-1',
      type: 'select',
    });
    databasePropertyRepo.updateProperty.mockResolvedValueOnce({ id: 'prop-1', type: 'multiline_text' });
    databaseRowRepo.findByDatabaseId.mockResolvedValueOnce([{ pageId: 'row-page-1' }]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValueOnce([
      { id: 'cell-1', propertyId: 'prop-1', value: 'in_progress' },
    ]);

    await service.updateProperty('db-1', 'prop-1', { type: 'multiline_text' }, 'ws-1');

    expect(databaseCellRepo.updateCell).toHaveBeenLastCalledWith('cell-1', {
      value: {
        value: 'in_progress',
        rawValueBeforeTypeChange: 'in_progress',
        rawTypeBeforeTypeChange: 'select',
      },
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

  it('updates row cells for checkbox and text/object payloads through batch endpoint flow', async () => {
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

    databaseCellRepo.upsertCell
      .mockResolvedValueOnce({ id: 'cell-bool-true', propertyId: 'prop-checkbox', value: true })
      .mockResolvedValueOnce({ id: 'cell-bool-false', propertyId: 'prop-checkbox', value: false })
      .mockResolvedValueOnce({ id: 'cell-text', propertyId: 'prop-text', value: 'plain text value' })
      .mockResolvedValueOnce({
        id: 'cell-object',
        propertyId: 'prop-object',
        value: { id: 'user-2' },
      });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      {
        cells: [
          { propertyId: 'prop-checkbox', value: true },
          { propertyId: 'prop-checkbox', value: false },
          { propertyId: 'prop-text', value: 'plain text value' },
          { propertyId: 'prop-object', value: { id: 'user-2' } },
        ],
      },
      user,
      'ws-1',
    );

    expect(databaseCellRepo.upsertCell).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        propertyId: 'prop-checkbox',
        value: true,
      }),
    );
    expect(databaseCellRepo.upsertCell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        propertyId: 'prop-checkbox',
        value: false,
      }),
    );
    expect(databaseCellRepo.upsertCell).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        propertyId: 'prop-text',
        value: 'plain text value',
      }),
    );
    expect(databaseCellRepo.upsertCell).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        propertyId: 'prop-object',
        value: { id: 'user-2' },
      }),
    );
  });

  it('soft-deletes cell with null value when operation=delete', async () => {
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
    databaseCellRepo.upsertCell.mockResolvedValue({
      id: 'cell-delete',
      propertyId: 'prop-delete',
      value: null,
    });
    databaseCellRepo.updateCell.mockResolvedValue({
      id: 'cell-delete',
      propertyId: 'prop-delete',
      value: null,
      deletedAt: new Date(),
    });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      {
        cells: [{ propertyId: 'prop-delete', operation: 'delete' }],
      },
      user,
      'ws-1',
    );

    expect(databaseCellRepo.upsertCell).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'prop-delete',
        value: null,
        attachmentId: null,
      }),
    );
    expect(databaseCellRepo.updateCell).toHaveBeenCalledWith(
      'cell-delete',
      expect.objectContaining({
        value: null,
        attachmentId: null,
        updatedById: 'u-1',
      }),
    );
  });

  it('records history for property creation in database and row timelines', async () => {
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([]);
    databasePropertyRepo.insertProperty.mockResolvedValue({
      id: 'prop-1',
      name: 'Status',
      type: 'select',
    });

    await service.createProperty(
      'db-1',
      { name: 'Status', type: 'select' } as any,
      'u-1',
      'ws-1',
    );

    expect(pageHistoryRecorder.enqueuePageEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'database.property.created',
      }),
    );
  });

  it('records history for batch row cell changes', async () => {
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
    databasePropertyRepo.findByDatabaseId.mockResolvedValue([
      { id: 'prop-text', type: 'multiline_text', name: 'Notes' },
    ]);
    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-1', propertyId: 'prop-text', value: 'old value' },
    ]);
    databaseCellRepo.upsertCell.mockResolvedValue({
      id: 'cell-1',
      propertyId: 'prop-text',
      value: 'new value',
    });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      { cells: [{ propertyId: 'prop-text', value: 'new value' }] },
      user,
      'ws-1',
    );

    expect(pageHistoryRecorder.enqueuePageEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'database.row.cells.updated',
      }),
    );
  });

  it('stores readable history payload for select, user, and page reference cells', async () => {
    pageRepo.findById.mockImplementation(async (pageId: string) => {
      const pages: Record<string, any> = {
        'row-page-1': {
          id: 'row-page-1',
          workspaceId: 'ws-1',
          spaceId: 'space-1',
          deletedAt: null,
        },
        'ref-page-1': {
          id: 'ref-page-1',
          workspaceId: 'ws-1',
          spaceId: 'space-1',
          deletedAt: null,
          title: 'Reference page one',
          slugId: 'ref-page-one',
        },
        'ref-page-2': {
          id: 'ref-page-2',
          workspaceId: 'ws-1',
          spaceId: 'space-1',
          deletedAt: null,
          title: 'Reference page two',
          slugId: 'ref-page-two',
        },
      };

      return pages[pageId] ?? null;
    });

    databaseRowRepo.findByDatabaseAndPage.mockResolvedValue({
      id: 'row-1',
      databaseId: 'db-1',
      pageId: 'row-page-1',
      archivedAt: null,
    });

    databasePropertyRepo.findByDatabaseId.mockResolvedValue([
      {
        id: 'prop-select',
        type: 'select',
        name: 'Select field',
        settings: {
          options: [
            { value: 'metka-2-r311', label: 'Label 2' },
            { value: 'metka-4-2ejm', label: 'Label 4' },
          ],
        },
      },
      { id: 'prop-user', type: 'user', name: 'User field', settings: {} },
      {
        id: 'prop-page',
        type: 'page_reference',
        name: 'Page field',
        settings: {},
      },
    ]);

    databaseCellRepo.findByDatabaseAndPage.mockResolvedValue([
      { id: 'cell-select', propertyId: 'prop-select', value: 'metka-2-r311' },
      { id: 'cell-user', propertyId: 'prop-user', value: null },
      { id: 'cell-page', propertyId: 'prop-page', value: 'ref-page-1' },
    ]);

    databaseCellRepo.upsertCell.mockImplementation(
      async (payload: { propertyId: string }) => {
        const valueByPropertyId: Record<string, unknown> = {
          'prop-select': 'metka-4-2ejm',
          'prop-user': { id: 'user-new' },
          'prop-page': 'ref-page-2',
        };

        return {
          id: `cell-${payload.propertyId}`,
          propertyId: payload.propertyId,
          value: valueByPropertyId[payload.propertyId],
        };
      },
    );

    userRepo.findById.mockImplementation(async (userId: string) => {
      if (userId !== 'user-new') {
        return null;
      }

      return {
        id: 'user-new',
        name: 'Pavel',
        workspaceId: 'ws-1',
      };
    });

    await service.batchUpdateRowCells(
      'db-1',
      'row-page-1',
      {
        cells: [
          { propertyId: 'prop-select', value: 'metka-4-2ejm' },
          { propertyId: 'prop-user', value: { id: 'user-new' } },
          { propertyId: 'prop-page', value: 'ref-page-2' },
        ],
      },
      user,
      'ws-1',
    );

    expect(pageHistoryRecorder.enqueuePageEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'database.row.cells.updated',
        changeData: expect.objectContaining({
          changes: expect.arrayContaining([
            expect.objectContaining({
              propertyId: 'prop-select',
              oldValue: { value: 'metka-2-r311', label: 'Label 2' },
              newValue: { value: 'metka-4-2ejm', label: 'Label 4' },
            }),
            expect.objectContaining({
              propertyId: 'prop-user',
              oldValue: null,
              newValue: { id: 'user-new', name: 'Pavel' },
            }),
            expect.objectContaining({
              propertyId: 'prop-page',
              oldValue: {
                id: 'ref-page-1',
                title: 'Reference page one',
                slugId: 'ref-page-one',
              },
              newValue: {
                id: 'ref-page-2',
                title: 'Reference page two',
                slugId: 'ref-page-two',
              },
            }),
          ]),
        }),
      }),
    );
  });

});
