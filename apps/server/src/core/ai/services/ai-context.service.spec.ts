import { ConflictException } from '@nestjs/common';
import { AiContextService } from './ai-context.service';

describe('AiContextService revisions', () => {
  const user = { id: 'user' } as any;
  const workspace = { id: 'workspace' } as any;
  const dto = {
    expectedRevision: 3,
    includeCurrentDocument: true,
    sources: [],
    fileIds: [],
    attachmentIds: [],
  };

  function createService(lockedOverrides: Record<string, unknown> = {}) {
    const conversation = {
      id: 'conversation',
      userId: user.id,
      workspaceId: workspace.id,
      spaceId: 'space',
      pageId: 'page',
      includeCurrentDocument: true,
      contextRevision: 3,
      contextFingerprint: '',
      contextChatFileIds: [],
      contextAttachmentIds: [],
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
      ...lockedOverrides,
    };
    const sourceListQuery: any = {
      selectAll: jest.fn(() => sourceListQuery),
      where: jest.fn(() => sourceListQuery),
      orderBy: jest.fn(() => sourceListQuery),
      execute: jest.fn(async () => []),
    };
    const lockedQuery: any = {
      selectAll: jest.fn(() => lockedQuery),
      where: jest.fn(() => lockedQuery),
      forUpdate: jest.fn(() => lockedQuery),
      executeTakeFirst: jest.fn(async () => conversation),
    };
    const trx = {
      selectFrom: jest.fn(() => lockedQuery),
      deleteFrom: jest.fn(),
      updateTable: jest.fn(),
    };
    const db = {
      selectFrom: jest.fn(() => sourceListQuery),
      transaction: jest.fn(() => ({
        execute: (callback: (value: typeof trx) => unknown) => callback(trx),
      })),
    };
    const service = new AiContextService(
      db as any,
      { getOwnedEntity: jest.fn(async () => conversation) } as any,
      {} as any,
      {} as any,
    );
    return { service, conversation, trx };
  }

  it('returns the current context for an identical repeated update', async () => {
    const { service, conversation, trx } = createService();
    conversation.contextFingerprint = (service as any).fingerprint({
      includeCurrentDocument: true,
      sources: [],
      fileIds: [],
      attachmentIds: [],
    });

    await expect(
      service.update('conversation', dto as any, user, workspace),
    ).resolves.toMatchObject({
      revision: 3,
      includeCurrentDocument: true,
    });
    expect(trx.deleteFrom).not.toHaveBeenCalled();
    expect(trx.updateTable).not.toHaveBeenCalled();
  });

  it('rejects a conflicting stale revision', async () => {
    const { service, trx } = createService({
      contextRevision: 4,
      contextFingerprint: 'different',
    });

    await expect(
      service.update('conversation', dto as any, user, workspace),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(trx.deleteFrom).not.toHaveBeenCalled();
  });
});

describe('AiContextService search', () => {
  it('returns row icons and accessible breadcrumbs', async () => {
    const rowQuery: any = {
      select: jest.fn(() => rowQuery),
      where: jest.fn(() => rowQuery),
      execute: jest.fn(async () => [
        { id: 'database-row-id', pageId: 'row-page-id' },
      ]),
    };
    const db = {
      selectFrom: jest.fn(() => rowQuery),
    };
    const searchService = {
      searchPage: jest.fn(async () => ({
        items: [
          {
            id: 'page-id',
            databaseId: null,
            title: 'Page',
            icon: '📄',
            breadcrumbs: [],
          },
          {
            id: 'page-id',
            databaseId: null,
            title: 'Duplicate page hit',
            icon: '📄',
            breadcrumbs: [],
          },
          {
            id: 'database-page-id',
            databaseId: 'database-id',
            title: 'Database',
            icon: '🗃️',
            breadcrumbs: [{ id: 'root-page', title: 'Root' }],
          },
          {
            id: 'row-page-id',
            databaseId: null,
            title: 'Database row',
            icon: '📋',
            breadcrumbs: [
              { id: 'root-page', title: 'Root' },
              { id: 'database-page', title: 'Database' },
            ],
          },
        ],
      })),
    };
    const service = new AiContextService(
      db as any,
      {
        getOwnedEntity: jest.fn(async () => ({
          id: 'conversation',
          spaceId: 'space',
        })),
      } as any,
      {} as any,
      searchService as any,
    );

    await expect(
      service.search(
        'conversation',
        { query: 'row', cursor: 0, limit: 20 } as any,
        { id: 'user' } as any,
        { id: 'workspace' } as any,
      ),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          sourceType: 'page',
          sourceId: 'page-id',
          pageId: 'page-id',
          title: 'Page',
          icon: '📄',
          breadcrumbs: [],
        }),
        expect.objectContaining({
          sourceType: 'database',
          sourceId: 'database-id',
          pageId: 'database-page-id',
          title: 'Database',
          icon: '🗃️',
          breadcrumbs: ['Root'],
        }),
        expect.objectContaining({
          sourceType: 'database_row',
          sourceId: 'database-row-id',
          pageId: 'row-page-id',
          title: 'Database row',
          icon: '📋',
          breadcrumbs: ['Root', 'Database'],
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });
});
