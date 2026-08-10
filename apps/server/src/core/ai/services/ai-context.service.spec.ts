jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

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

  it('extracts only stable heading anchors in document order', () => {
    const { service } = createService();
    const headings = (service as any).extractCitationHeadings({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { id: 'stable-one', level: 2 },
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'heading',
          attrs: { id: 'not stable', level: 3 },
          content: [{ type: 'text', text: 'Ignored' }],
        },
        {
          type: 'heading',
          attrs: { id: 'stable-two', level: 9 },
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    });

    expect(
      headings.map(({ id, title, level }: any) => ({ id, title, level })),
    ).toEqual([
      { id: 'stable-one', title: 'First', level: 2 },
      { id: 'stable-two', title: 'Second', level: 6 },
    ]);
    expect(headings[0].position).toBeLessThan(headings[1].position);
  });
});

describe('AiContextService run capture', () => {
  it('persists prepared context without opening a nested database query', async () => {
    const db = { selectFrom: jest.fn() };
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      execute: jest.fn(async () => undefined),
    };
    const insertQuery: any = {
      values: jest.fn(() => insertQuery),
      execute: jest.fn(async () => undefined),
    };
    const trx = {
      updateTable: jest.fn(() => updateQuery),
      insertInto: jest.fn(() => insertQuery),
    };
    const service = new AiContextService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.captureRunContext(trx, 'run-id', {
      clearCurrentDocumentSnapshot: true,
      snapshots: [
        {
          origin: 'current_document',
          sourceType: 'page',
          sourceId: 'page-id',
          pageId: 'page-id',
          sourceTitle: 'Page',
          sourceUrl: null,
          markdownSnapshot: '# Page',
          citationHeadings: [],
          contentSha256: 'hash',
          position: 0,
        },
      ],
    });

    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(trx.updateTable).toHaveBeenCalledWith('aiRuns');
    expect(trx.insertInto).toHaveBeenCalledWith('aiRunContextSources');
    expect(insertQuery.values).toHaveBeenCalledWith([
      expect.objectContaining({ runId: 'run-id', sourceId: 'page-id' }),
    ]);
  });

  it('copies prepared retry context without opening a nested database query', async () => {
    const db = { selectFrom: jest.fn() };
    const insertQuery: any = {
      values: jest.fn(() => insertQuery),
      returning: jest.fn(() => insertQuery),
      executeTakeFirstOrThrow: jest.fn(async () => ({ id: 'copied-source' })),
      execute: jest.fn(async () => undefined),
    };
    const trx = { insertInto: jest.fn(() => insertQuery) };
    const service = new AiContextService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.copyRunContext(trx, 'target-run', 'assistant-message', {
      sources: [
        {
          id: 'source-context',
          origin: 'explicit',
          sourceType: 'page',
          sourceId: 'page-id',
          pageId: 'page-id',
          sourceTitle: 'Page',
          sourceUrl: null,
          markdownSnapshot: '# Page',
          citationHeadings: [],
          contentSha256: 'hash',
        } as any,
      ],
      dependencies: [
        {
          contextSourceId: 'source-context',
          pageId: 'page-id',
        } as any,
      ],
    });

    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(trx.insertInto).toHaveBeenCalledWith('aiRunContextSources');
    expect(trx.insertInto).toHaveBeenCalledWith('aiRunSourceDependencies');
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'target-run',
          messageId: 'assistant-message',
          contextSourceId: 'copied-source',
        }),
      ]),
    );
  });

  it('does not reuse a snapshot when one of its page dependencies is no longer readable', async () => {
    const dependencyQuery: any = {
      selectAll: jest.fn(() => dependencyQuery),
      where: jest.fn(() => dependencyQuery),
      execute: jest.fn(async () => [
        {
          runId: 'source-run',
          contextSourceId: 'source-context',
          pageId: 'database-page',
        },
        {
          runId: 'source-run',
          contextSourceId: 'source-context',
          pageId: 'revoked-row-page',
        },
      ]),
    };
    const sourceQuery: any = {
      selectAll: jest.fn(() => sourceQuery),
      where: jest.fn(() => sourceQuery),
      orderBy: jest.fn(() => sourceQuery),
      execute: jest.fn(async () => [
        {
          id: 'source-context',
          runId: 'source-run',
          pageId: 'database-page',
          markdownSnapshot: 'database snapshot contains revoked row canary',
        },
      ]),
    };
    const service = new AiContextService(
      {
        selectFrom: jest.fn((table: string) =>
          table === 'aiRunSourceDependencies'
            ? dependencyQuery
            : sourceQuery,
        ),
      } as any,
      {} as any,
      {
        getSidebarAccessSnapshot: jest.fn(async () => ({
          readablePageIds: new Set(['database-page']),
        })),
      } as any,
      {} as any,
      {} as any,
      { getExcludedPageIds: jest.fn(async () => new Set()) } as any,
    );

    await expect(
      service.prepareCopiedRunContext(
        {
          id: 'source-run',
          spaceId: 'space',
          workspaceId: 'workspace',
        },
        { id: 'user' } as any,
      ),
    ).resolves.toEqual({ sources: [], dependencies: [] });
  });

  it('fails instead of silently dropping a captured source after access changes', async () => {
    const sourceQuery: any = {
      selectAll: jest.fn(() => sourceQuery),
      where: jest.fn(() => sourceQuery),
      orderBy: jest.fn(() => sourceQuery),
      execute: jest.fn(async () => [
        {
          id: 'source-context',
          runId: 'run-id',
          pageId: 'revoked-page',
          origin: 'current_document',
          sourceType: 'page',
          sourceId: 'revoked-page',
          sourceTitle: 'Revoked page',
          sourceUrl: null,
          markdownSnapshot: 'selection canary',
          citationHeadings: [],
          contentSha256: 'hash',
          position: 0,
        },
      ]),
    };
    const service = new AiContextService(
      { selectFrom: jest.fn(() => sourceQuery) } as any,
      {} as any,
      {
        getSidebarAccessSnapshot: jest.fn(async () => ({
          readablePageIds: new Set<string>(),
        })),
      } as any,
      {} as any,
      {} as any,
      { getExcludedPageIds: jest.fn(async () => new Set()) } as any,
    );

    await expect(
      service.resolveRunContext(
        {
          id: 'run-id',
          spaceId: 'space',
          workspaceId: 'workspace',
        } as any,
        { id: 'user' } as any,
        10_000,
      ),
    ).rejects.toMatchObject({ aiErrorCode: 'source_access_changed' });
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
