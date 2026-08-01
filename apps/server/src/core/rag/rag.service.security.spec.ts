import { RagService } from './rag.service';

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
}

const scope = {
  user: { id: 'user-1' },
  workspace: { id: 'workspace-1' },
  space: { id: 'space-1', settings: {} },
} as any;

function createService(options?: {
  readablePageIds?: string[];
  rows?: any[];
  pages?: any[];
  deleted?: Record<string, any[]>;
}) {
  const deleted = options?.deleted ?? {};
  const db = {
    selectFrom: jest.fn((table: string) => {
      if (table === 'pages' && options?.pages) {
        return new FakeQuery(options.pages);
      }
      return new FakeQuery(deleted[table] ?? []);
    }),
  };
  const databaseRowRepo = {
    findByDatabaseId: jest.fn().mockResolvedValue(options?.rows ?? []),
  };
  const pageAccess = {
    getSidebarAccessSnapshot: jest.fn().mockResolvedValue({
      readablePageIds: new Set(options?.readablePageIds ?? []),
    }),
  };
  const contentPolicy = {
    getExcludedPageIds: jest.fn().mockResolvedValue(new Set<string>()),
    getEffectivePolicy: jest.fn().mockResolvedValue({
      fingerprint: 'policy-fingerprint',
      excludedPageIds: [],
    }),
  };
  const service = new RagService(
    db as any,
    {} as any,
    {} as any,
    {} as any,
    databaseRowRepo as any,
    {} as any,
    {} as any,
    {} as any,
    pageAccess as any,
    contentPolicy as any,
  );
  return { service, db };
}

describe('RagService security boundaries', () => {
  it('includes effective page access in the v2 scope fingerprint', async () => {
    const first = createService({ readablePageIds: ['page-1'] });
    const second = createService({ readablePageIds: ['page-1', 'page-2'] });

    const firstScope = await first.service.getScope(scope);
    const secondScope = await second.service.getScope(scope);

    expect(firstScope).toMatchObject({ schemaVersion: 2 });
    expect(firstScope.fingerprint).not.toBe(secondScope.fingerprint);
  });

  it('returns only opaque blocked page identifiers', async () => {
    const { service } = createService({
      readablePageIds: ['page-allowed'],
      pages: [
        { id: 'page-allowed', title: 'Allowed' },
        { id: 'page-blocked', title: 'Secret' },
      ],
    });

    await expect(service.getBlockedPages(scope, { limit: 10 })).resolves.toEqual(
      {
        items: [{ pageId: 'page-blocked' }],
        hasMore: false,
        nextCursor: null,
      },
    );
  });

  it('filters database rows by the key creator page ACL before loading content', async () => {
    const { service, db } = createService({
      readablePageIds: ['row-page-allowed'],
      rows: [
        {
          id: 'row-allowed',
          databaseId: 'database-1',
          pageId: 'row-page-allowed',
          cells: [{ propertyId: 'property-1', value: 'allowed' }],
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
    });
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(db.selectFrom).toHaveBeenCalledTimes(1);
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
