import { RagContentExportService as RagService } from './rag-content-export.service';
import { KnowledgeProjectionService } from './knowledge-projection.service';

class FakeQuery<T> {
  constructor(private readonly rows: T[]) {}

  select() {
    return this;
  }

  where() {
    return this;
  }

  innerJoin() {
    return this;
  }

  leftJoin() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  execute(): Promise<T[]> {
    return Promise.resolve(this.rows);
  }

  executeTakeFirst(): Promise<T | undefined> {
    return Promise.resolve(this.rows[0]);
  }
}

const scope = {
  user: { id: 'user-1' },
  workspace: { id: 'workspace-1' },
  space: { id: 'space-1', settings: {} },
} as any;

function createService(options?: {
  readablePageIds?: string[];
  rows?: any[];
  paginatedRows?: {
    items: any[];
    hasMore: boolean;
    nextCursor: string | null;
  };
  pages?: any[];
  database?: any;
  deleted?: Record<string, any[]>;
  aiConfig?: Record<string, unknown>;
  excludedPageIds?: string[];
}) {
  const deleted = options?.deleted ?? {};
  const db = {
    dynamic: {
      ref: jest.fn((reference: string) => reference),
    },
    selectFrom: jest.fn((table: string) => {
      if (table === 'aiSpaceConfigs') {
        return new FakeQuery(options?.aiConfig ? [options.aiConfig] : []);
      }
      if (table === 'pages' && options?.pages) {
        return new FakeQuery(options.pages);
      }
      return new FakeQuery(deleted[table] ?? []);
    }),
  };
  const databaseRowRepo = {
    findByDatabaseId: jest.fn().mockResolvedValue(options?.rows ?? []),
    findByDatabaseIdPaginated: jest.fn().mockResolvedValue(
      options?.paginatedRows ?? {
        items: [],
        hasMore: false,
        nextCursor: null,
      },
    ),
  };
  const pageRepo = {
    findById: jest.fn((id: string) =>
      Promise.resolve(options?.pages?.find((page) => page.id === id)),
    ),
  };
  const databaseRepo = {
    findById: jest.fn().mockResolvedValue(options?.database ?? null),
    findByPageId: jest.fn().mockResolvedValue(options?.database ?? null),
  };
  const databasePropertyRepo = {
    findByDatabaseId: jest.fn().mockResolvedValue([]),
  };
  const pageAccess = {
    getSidebarAccessSnapshot: jest.fn().mockResolvedValue({
      readablePageIds: new Set(options?.readablePageIds ?? []),
    }),
  };
  const contentPolicy = {
    getExcludedPageIds: jest
      .fn()
      .mockResolvedValue(new Set(options?.excludedPageIds ?? [])),
    getEffectivePolicy: jest.fn().mockResolvedValue({
      fingerprint: 'policy-fingerprint',
      excludedPageIds: [],
    }),
    isPageExcluded: jest.fn().mockResolvedValue(false),
  };
  const service = new RagService(
    db as any,
    pageRepo as any,
    databaseRepo as any,
    databasePropertyRepo as any,
    databaseRowRepo as any,
    {} as any,
    {} as any,
    {} as any,
    pageAccess as any,
    contentPolicy as any,
    new KnowledgeProjectionService(db as any),
  );
  return { service, db, databaseRowRepo };
}

describe('RagService security boundaries', () => {
  it('includes scope identity and effective page access in the v2 fingerprint', async () => {
    const first = createService({ readablePageIds: ['page-1'] });
    const second = createService({ readablePageIds: ['page-1', 'page-2'] });

    const firstScope = await first.service.getScope(scope);
    const secondScope = await second.service.getScope(scope);
    const otherSpaceScope = await first.service.getScope({
      ...scope,
      space: { ...scope.space, id: 'space-2' },
    });

    expect(firstScope).toMatchObject({
      schemaVersion: 2,
      workspaceId: scope.workspace.id,
      spaceId: scope.space.id,
      syncTarget: null,
    });
    expect(firstScope.fingerprint).not.toBe(secondScope.fingerprint);
    expect(firstScope.fingerprint).not.toBe(otherSpaceScope.fingerprint);
  });

  it('returns the non-secret Open WebUI target configured for the space', async () => {
    const { service } = createService({
      aiConfig: {
        retrievalAdapter: 'open-webui-knowledge-v1',
        retrievalOpenWebuiBaseUrl: 'https://open-webui.example',
        retrievalOpenWebuiKnowledgeId: 'knowledge-1',
      },
    });

    await expect(service.getScope(scope)).resolves.toMatchObject({
      syncTarget: {
        adapter: 'open-webui-knowledge-v1',
        baseUrl: 'https://open-webui.example',
        knowledgeId: 'knowledge-1',
      },
    });
  });

  it('uses every policy-allowed page for the internal system scope', async () => {
    const { service } = createService({
      readablePageIds: [],
      pages: [{ id: 'page-allowed' }, { id: 'page-excluded' }],
      excludedPageIds: ['page-excluded'],
    });

    const systemScope = {
      accessMode: 'system' as const,
      workspace: scope.workspace,
      space: scope.space,
    };

    await expect(
      service.getBlockedPages(systemScope, { limit: 10 }),
    ).resolves.toEqual({
      items: [{ pageId: 'page-excluded' }],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('returns only opaque blocked page identifiers', async () => {
    const { service } = createService({
      readablePageIds: ['page-allowed'],
      pages: [
        { id: 'page-allowed', title: 'Allowed' },
        { id: 'page-blocked', title: 'Secret' },
      ],
    });

    await expect(
      service.getBlockedPages(scope, { limit: 10 }),
    ).resolves.toEqual({
      items: [{ pageId: 'page-blocked' }],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('filters database rows by the key creator page ACL before loading content', async () => {
    const { service, db } = createService({
      readablePageIds: ['row-page-allowed'],
      rows: [
        {
          id: 'row-allowed',
          databaseId: 'database-1',
          pageId: 'row-page-allowed',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          cells: [
            {
              propertyId: 'property-1',
              value: 'allowed',
              updatedAt: new Date('2026-03-01T00:00:00.000Z'),
            },
          ],
        },
        {
          id: 'row-denied',
          databaseId: 'database-1',
          pageId: 'row-page-denied',
          cells: [{ propertyId: 'property-1', value: 'secret' }],
        },
      ],
      pages: [
        {
          id: 'row-page-allowed',
          slugId: 'allowed',
          title: 'Allowed',
          content: null,
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    });

    const rows = await (service as any).loadRowsWithContent(
      'database-1',
      scope,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'row-allowed',
      pageId: 'row-page-allowed',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      projectionUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(db.selectFrom).toHaveBeenCalledTimes(1);
  });

  it('loads internal database sync rows through a capped cursor page', async () => {
    const databaseId = '11111111-1111-4111-8111-111111111111';
    const row = {
      id: 'row-1',
      databaseId,
      pageId: 'row-page-1',
      pageTitle: 'Row',
      cells: [],
    };
    const { service, databaseRowRepo } = createService({
      database: {
        id: databaseId,
        pageId: 'database-page-1',
        workspaceId: scope.workspace.id,
        spaceId: scope.space.id,
      },
      paginatedRows: {
        items: [row],
        hasMore: true,
        nextCursor: 'next-row-cursor',
      },
      pages: [
        {
          id: 'database-page-1',
          spaceId: scope.space.id,
          deletedAt: null,
        },
        {
          id: 'row-page-1',
          slugId: 'row',
          title: 'Row',
          content: null,
        },
      ],
    });
    const systemScope = {
      accessMode: 'system' as const,
      workspace: scope.workspace,
      space: scope.space,
    };

    await expect(
      service.getDatabaseSyncRowsPage(systemScope, databaseId, {
        cursor: 'row-cursor',
        limit: 500,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'row-1' })],
      hasMore: true,
      nextCursor: 'next-row-cursor',
    });
    expect(databaseRowRepo.findByDatabaseIdPaginated).toHaveBeenCalledWith(
      databaseId,
      scope.workspace.id,
      scope.space.id,
      { cursor: 'row-cursor', limit: 100 },
    );
  });

  it('returns deletion tombstones without user-controlled metadata', async () => {
    const deletedAt = new Date('2026-01-01T00:00:00.000Z');
    const { service } = createService({
      deleted: {
        pages: [
          {
            id: 'page-1',
            slugId: 'secret-slug',
            title: 'Secret title',
            parentPageId: 'parent-1',
            deletedAt,
          },
        ],
        databases: [],
        databaseRows: [],
      },
    });

    await expect(service.getDeleted(scope, 0)).resolves.toMatchObject({
      items: [
        {
          type: 'page',
          id: 'page-1',
          slugId: null,
          title: null,
          parentPageId: null,
        },
      ],
    });
  });

  it('returns attachment tombstones without page or space metadata', async () => {
    const deletedAt = new Date('2026-01-01T00:00:00.000Z');
    const { service } = createService({
      deleted: {
        attachments: [
          {
            id: 'attachment-1',
            pageId: 'page-1',
            spaceId: 'space-1',
            deletedAt,
          },
        ],
      },
    });

    await expect(service.getAttachmentDeleted(scope, 0)).resolves.toMatchObject(
      {
        items: [
          {
            id: 'attachment-1',
            fileId: 'attachment-1',
            pageId: null,
            spaceId: null,
          },
        ],
      },
    );
  });
});
