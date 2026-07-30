import { BadRequestException, ConflictException } from '@nestjs/common';
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
      currentDocumentDescendantMode: 'none',
      currentDocumentSelectedPageIds: [],
      contextRevision: 3,
      contextFingerprint: '',
      contextChatFileIds: [],
      contextAttachmentIds: [],
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
      ...lockedOverrides,
    };
    const sourceListQuery: any = {
      select: jest.fn(() => sourceListQuery),
      selectAll: jest.fn(() => sourceListQuery),
      where: jest.fn(() => sourceListQuery),
      limit: jest.fn(() => sourceListQuery),
      orderBy: jest.fn(() => sourceListQuery),
      execute: jest.fn(async () => []),
      executeTakeFirst: jest.fn(async () => ({
        id: 'page',
        title: 'Page',
        icon: null,
        spaceId: 'space',
        workspaceId: 'workspace',
      })),
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
      {
        getSidebarAccessSnapshot: jest.fn(async () => ({
          readablePageIds: new Set(['page']),
        })),
      } as any,
      {} as any,
      {
        getPageAndDescendants: jest.fn(async () => [
          {
            id: 'page',
            spaceId: 'space',
            workspaceId: 'workspace',
          },
        ]),
      } as any,
      { getExcludedPageIds: jest.fn(async () => new Set()) } as any,
    );
    return { service, conversation, trx };
  }

  it('returns the current context for an identical repeated update', async () => {
    const { service, conversation, trx } = createService();
    conversation.contextFingerprint = (service as any).fingerprint({
      includeCurrentDocument: true,
      currentDocumentDescendants: { mode: 'none', pageIds: [] },
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
    const emptyQuery: any = {
      select: jest.fn(() => emptyQuery),
      where: jest.fn(() => emptyQuery),
      limit: jest.fn(() => emptyQuery),
      execute: jest.fn(async () => []),
      executeTakeFirst: jest.fn(async () => undefined),
    };
    const db = {
      selectFrom: jest.fn((table: string) =>
        table === 'databaseRows' ? rowQuery : emptyQuery,
      ),
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
      {
        getSidebarAccessSnapshot: jest.fn(async () => ({
          readablePageIds: new Set([
            'page-id',
            'database-page-id',
            'row-page-id',
          ]),
        })),
      } as any,
      searchService as any,
      {} as any,
      { getExcludedPageIds: jest.fn(async () => new Set()) } as any,
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

describe('AiContextService descendant expansion', () => {
  const root = source('root');
  const child = source('child');
  const nested = source('nested');
  const user = { id: 'user' } as any;

  function createService(tree: string[], readable = tree) {
    class Query {
      private filters = new Map<string, unknown>();

      constructor(private readonly table: string) {}

      select() {
        return this;
      }

      selectAll() {
        return this;
      }

      where(column: string, _operator: string, value: unknown) {
        this.filters.set(column, value);
        return this;
      }

      limit() {
        return this;
      }

      async execute() {
        return [];
      }

      async executeTakeFirst() {
        if (this.table !== 'pages') return undefined;
        const id = this.filters.get('id');
        return typeof id === 'string'
          ? { id, title: id, icon: null }
          : undefined;
      }
    }
    return new AiContextService(
      { selectFrom: (table: string) => new Query(table) } as any,
      {} as any,
      {
        getSidebarAccessSnapshot: async () => ({
          readablePageIds: new Set(readable),
        }),
      } as any,
      {} as any,
      {
        getPageAndDescendants: async (rootPageId: string) =>
          tree.map((id) => ({
            id,
            spaceId: 'space',
            workspaceId: 'workspace',
            parentPageId: id === rootPageId ? null : rootPageId,
          })),
      } as any,
      {} as any,
    );
  }

  it('expands nested all mode and deduplicates overlapping roots', async () => {
    const service = createService(['root', 'child', 'nested']);
    const expanded = await (service as any).expandRoots(
      [
        {
          source: root,
          descendants: { mode: 'all', pageIds: [] },
          origin: 'current_document',
        },
        {
          source: child,
          descendants: { mode: 'none', pageIds: [] },
          origin: 'explicit',
        },
      ],
      'space',
      'workspace',
      user,
      new Set(),
      true,
    );

    expect(expanded.map((item: any) => item.source.pageId)).toEqual([
      'root',
      'child',
      'nested',
    ]);
  });

  it('keeps selected descendants static while all mode follows tree changes', async () => {
    const first = createService(['root', 'child']);
    const moved = createService(['root', 'child', 'new-child']);
    const selectedRoot = {
      source: root,
      descendants: { mode: 'selected', pageIds: ['child'] },
      origin: 'explicit',
    };
    const allRoot = {
      source: root,
      descendants: { mode: 'all', pageIds: [] },
      origin: 'explicit',
    };

    const selected = await (moved as any).expandRoots(
      [selectedRoot],
      'space',
      'workspace',
      user,
      new Set(),
      true,
    );
    const before = await (first as any).expandRoots(
      [allRoot],
      'space',
      'workspace',
      user,
      new Set(),
      true,
    );
    const after = await (moved as any).expandRoots(
      [allRoot],
      'space',
      'workspace',
      user,
      new Set(),
      true,
    );

    expect(selected.map((item: any) => item.source.pageId)).toEqual([
      'root',
      'child',
    ]);
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
  });

  it('rejects invalid, unreadable, and excluded explicit descendants', async () => {
    const service = createService(['root', 'child'], ['root']);
    const invoke = (pageIds: string[], excluded = new Set<string>()) =>
      (service as any).expandRoots(
        [
          {
            source: root,
            descendants: { mode: 'selected', pageIds },
            origin: 'explicit',
          },
        ],
        'space',
        'workspace',
        user,
        excluded,
        true,
      );

    await expect(invoke(['outside'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(invoke(['child'])).rejects.toMatchObject({
      response: { code: 'context_source_unavailable' },
    });
    await expect(invoke(['child'], new Set(['child']))).rejects.toMatchObject({
      response: { code: 'ai_context_source_excluded' },
    });
  });
});

function source(pageId: string) {
  return {
    id: `page:${pageId}`,
    sourceType: 'page',
    sourceId: pageId,
    pageId,
    title: pageId,
    icon: null,
    breadcrumbs: [],
    url: null,
    position: 0,
    available: true,
    hasChildren: true,
    descendants: { mode: 'none', pageIds: [] },
  };
}
