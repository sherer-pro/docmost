jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { RagContentExportService as RagService } from './rag-content-export.service';

class TestPostgresDialect {
  constructor(private readonly driver: any = new DummyDriver()) {}

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return this.driver;
  }

  createIntrospector(db: Kysely<any>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

type MicrosecondAttachmentRow = {
  id: string;
  updatedAtMicroseconds: number;
};

class MicrosecondAttachmentDriver extends DummyDriver {
  private cursor: { timestampMs: number; id: string } | null = null;

  constructor(private readonly sourceRows: MicrosecondAttachmentRow[]) {
    super();
  }

  setCursor(value?: string | null) {
    this.cursor = value
      ? (JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
          timestampMs: number;
          id: string;
        })
      : null;
  }

  override async acquireConnection() {
    return {
      executeQuery: async (query: any) => {
        const usesMillisecondPrecision = query.sql.includes(
          "date_trunc('milliseconds'",
        );
        const orderedRows = this.sourceRows
          .filter((row) => {
            if (!this.cursor) {
              return true;
            }
            const timestamp = usesMillisecondPrecision
              ? Math.floor(row.updatedAtMicroseconds / 1000)
              : row.updatedAtMicroseconds;
            const cursorTimestamp = usesMillisecondPrecision
              ? this.cursor.timestampMs
              : this.cursor.timestampMs * 1000;
            return (
              timestamp > cursorTimestamp ||
              (timestamp === cursorTimestamp && row.id > this.cursor.id)
            );
          })
          .sort((left, right) => {
            const leftTimestamp = usesMillisecondPrecision
              ? Math.floor(left.updatedAtMicroseconds / 1000)
              : left.updatedAtMicroseconds;
            const rightTimestamp = usesMillisecondPrecision
              ? Math.floor(right.updatedAtMicroseconds / 1000)
              : right.updatedAtMicroseconds;
            return (
              leftTimestamp - rightTimestamp || left.id.localeCompare(right.id)
            );
          });
        const queryLimit = [...query.parameters]
          .reverse()
          .find((parameter) => Number.isSafeInteger(parameter));
        const rows = orderedRows
          .slice(0, typeof queryLimit === 'number' ? queryLimit : undefined)
          .map((row) => {
            const updatedAt = new Date(
              Math.floor(row.updatedAtMicroseconds / 1000),
            );
            return {
              id: row.id,
              file_name: `${row.id}.txt`,
              file_size: 1,
              file_ext: 'txt',
              mime_type: 'text/plain',
              page_id: 'page-1',
              space_id: 'space-1',
              created_at: updatedAt,
              updated_at: updatedAt,
            };
          });
        return { rows };
      },
      async *streamQuery() {},
    } as any;
  }
}

const defaultDocumentFields = {
  status: false,
  assignee: false,
  stakeholders: false,
  aiRole: false,
};

const createService = (
  db: Kysely<any>,
  documentFields = defaultDocumentFields,
) =>
  new RagService(
    db as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    // Page access rules are not the subject of these pagination tests.
    {
      getSidebarAccessSnapshot: async () => ({
        readablePageIds: new Set<string>(['page-1']),
        visiblePageIds: { has: () => true } as unknown as Set<string>,
        writablePageIds: { has: () => true } as unknown as Set<string>,
      }),
    } as any,
    {
      getExcludedPageIds: async () => new Set<string>(),
      getEffectivePolicy: async () => ({
        revision: 0,
        fingerprint: 'policy-fingerprint',
        ragSearchDoneOnly: false,
        excludedPageIds: [],
      }),
      getRagSearchPolicy: async () => ({
        revision: 0,
        fingerprint: 'policy-fingerprint',
        ragSearchFingerprint: 'rag-search-fingerprint',
        ragSearchDoneOnly: false,
        excludedPageIds: [],
        statusBlockedPageIds: [],
      }),
    } as any,
    {
      version: 1,
      fingerprintInput: () => ({
        projectionVersion: 1,
        documentFields,
        dictionaryEnabled: false,
      }),
      getDocumentFieldsConfig: () => documentFields,
      buildCustomFields: () => undefined,
      resolveMembers: async () => new Map(),
      memberNames: () => new Map(),
      projectionUpdatedAtFromMembers: (updatedAt: Date | string) =>
        new Date(updatedAt),
      renderPageKnowledgeMarkdown: () => '',
    } as any,
  );

const feedCursor = (
  kind: string,
  scopeFingerprint: string,
  watermarkMs: number | null,
  timestampMs = 1000,
  id = 'page-0',
) =>
  Buffer.from(
    JSON.stringify({
      version: 2,
      kind,
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      scopeFingerprint,
      watermarkMs,
      snapshotUpperBoundMs: Date.UTC(2030, 0, 1),
      timestampMs,
      id,
    }),
    'utf8',
  ).toString('base64url');

describe('RagService getUpdates SQL generation', () => {
  let queries: string[] = [];

  const db = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
    plugins: [new CamelCasePlugin()],
    log: (event) => {
      if (event.level === 'query') {
        queries.push(event.query.sql);
      }
    },
  });

  const service = createService(db);

  const scope = {
    user: { id: 'user-1' },
    workspace: { id: 'workspace-1' },
    space: { id: 'space-1', settings: {} },
  } as any;

  beforeEach(() => {
    queries = [];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('uses snake_case identifiers in updates aggregation SQL', async () => {
    await expect(service.getUpdates(scope, 0)).resolves.toMatchObject({
      items: [],
      hasMore: false,
      nextCursor: null,
    });

    const aggregationQuery = queries.find((query) =>
      query.includes('GREATEST('),
    );

    expect(aggregationQuery).toBeDefined();
    expect(aggregationQuery).toContain('"databases"."updated_at"');
    expect(aggregationQuery).toContain('"database_pages"."updated_at"');
    expect(aggregationQuery).toContain(
      '"properties_changes"."properties_updated_at"',
    );
    expect(aggregationQuery).toContain('"rows_changes"."rows_updated_at"');
    expect(aggregationQuery).toContain('"cells_changes"."cells_updated_at"');
    expect(aggregationQuery).toContain(
      '"row_pages_changes"."row_pages_updated_at"',
    );
    expect(aggregationQuery).not.toContain('"updatedAt"');
    expect(aggregationQuery).not.toContain('"propertiesUpdatedAt"');
    expect(aggregationQuery).not.toContain('"rowsUpdatedAt"');
    expect(aggregationQuery).not.toContain('"cellsUpdatedAt"');
    expect(aggregationQuery).not.toContain('"rowPagesUpdatedAt"');
  });

  it('pushes paginated update limits into both SQL streams', async () => {
    await service.getUpdates(scope, 0, { limit: 500 });

    const pageQuery = queries.find((query) => query.includes('from "pages"'));
    const databaseQuery = queries.find((query) => query.includes('GREATEST('));

    expect(pageQuery).toContain(
      'order by date_trunc(\'milliseconds\', "pages"."updated_at") asc',
    );
    expect(pageQuery).toContain('limit $');
    expect(databaseQuery).toContain(
      "order by date_trunc('milliseconds', GREATEST(",
    );
    expect(databaseQuery).toContain('limit $');
  });

  it('casts UUID member ids to text in document projection filters', async () => {
    const memberProjectionService = createService(db, {
      ...defaultDocumentFields,
      assignee: true,
      stakeholders: true,
    });

    await memberProjectionService.getUpdates(scope, 0);

    const pageQuery = queries.find(
      (query) =>
        query.includes('from "pages"') &&
        query.includes('projection_users.id::text'),
    );

    expect(pageQuery).toContain(
      `projection_users.id::text = "pages"."settings" ->> 'assigneeId'`,
    );
    expect(pageQuery).toContain(
      `COALESCE("pages"."settings" -> 'stakeholderIds', '[]'::jsonb) ? projection_users.id::text`,
    );
  });

  it('pushes pagination into deleted and attachment SQL streams', async () => {
    await service.getDeleted(scope, 0, { limit: 500 });
    await service.getAttachmentUpdates(scope, 0, { limit: 500 });
    await service.getAttachmentDeleted(scope, 0, { limit: 500 });

    const deletedQueries = queries.filter(
      (query) => query.includes('deleted_at') || query.includes('archived_at'),
    );
    expect(
      deletedQueries.filter((query) => query.includes('limit $')).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      queries.some(
        (query) =>
          query.includes('from "attachments"') &&
          query.includes(
            'order by date_trunc(\'milliseconds\', "attachments"."updated_at") asc',
          ) &&
          query.includes('limit $'),
      ),
    ).toBe(true);
  });

  it('excludes attachment updates whose parent page is unavailable', async () => {
    await service.getAttachmentUpdates(scope, 0, { limit: 500 });

    const attachmentQuery = queries.find((query) =>
      query.includes('from "attachments"'),
    );

    expect(attachmentQuery).toContain(
      'inner join "pages" as "attachment_pages" on "attachment_pages"."id" = "attachments"."page_id"',
    );
    expect(attachmentQuery).toContain('"attachment_pages"."workspace_id" = $');
    expect(attachmentQuery).toContain('"attachment_pages"."space_id" = $');
    expect(attachmentQuery).toContain(
      '"attachment_pages"."deleted_at" is null',
    );
  });

  it('pushes optional page listing pagination into both SQL streams', async () => {
    await service.listPages(scope, false, { limit: 500 });

    expect(
      queries.some(
        (query) =>
          query.includes('from "pages"') &&
          query.includes(
            'order by date_trunc(\'milliseconds\', "pages"."updated_at") asc',
          ) &&
          query.includes('limit $'),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.includes('from "databases"') &&
          query.includes(
            'order by date_trunc(\'milliseconds\', "databases"."updated_at") asc',
          ) &&
          query.includes('limit $'),
      ),
    ).toBe(true);
  });

  it('uses encoded-cursor millisecond precision in every feed SQL stream', async () => {
    const scopeFingerprint = await (service as any).getFeedScopeFingerprint(
      scope,
    );
    await service.listPages(scope, false, {
      limit: 1,
      cursor: feedCursor('pages', scopeFingerprint, null),
    });
    await service.getUpdates(scope, 0, {
      limit: 1,
      cursor: feedCursor('updates', scopeFingerprint, 0),
    });
    await service.getDeleted(scope, 0, {
      limit: 1,
      cursor: feedCursor('deleted', scopeFingerprint, 0),
    });
    await service.getAttachmentUpdates(scope, 0, {
      limit: 1,
      cursor: feedCursor('attachment-updates', scopeFingerprint, 0),
    });
    await service.getAttachmentDeleted(scope, 0, {
      limit: 1,
      cursor: feedCursor('attachment-deleted', scopeFingerprint, 0),
    });

    const boundedFeedQueries = queries.filter((query) =>
      query.includes('limit $'),
    );
    expect(boundedFeedQueries).toHaveLength(9);
    for (const query of boundedFeedQueries) {
      expect(
        query.match(/date_trunc\('milliseconds'/g)?.length ?? 0,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not skip sub-millisecond rows or report a false end of feed', async () => {
    const baseTimestampMs = Date.UTC(2026, 0, 1);
    const driver = new MicrosecondAttachmentDriver([
      { id: 'a', updatedAtMicroseconds: baseTimestampMs * 1000 + 100 },
      { id: 'b', updatedAtMicroseconds: baseTimestampMs * 1000 + 200 },
      { id: 'c', updatedAtMicroseconds: baseTimestampMs * 1000 + 900 },
      { id: 'd', updatedAtMicroseconds: (baseTimestampMs + 1) * 1000 + 100 },
    ]);
    const pagedDb = new Kysely<any>({
      dialect: new TestPostgresDialect(driver) as any,
      plugins: [new CamelCasePlugin()],
    });
    const pagedService = createService(pagedDb);
    const ids: string[] = [];
    const hasMore: boolean[] = [];
    let cursor: string | null = null;

    try {
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        driver.setCursor(cursor);
        const page = await pagedService.getAttachmentUpdates(scope, 0, {
          limit: 1,
          ...(cursor ? { cursor } : {}),
        });
        ids.push(...page.items.map((item) => item.id));
        hasMore.push(page.hasMore);
        cursor = page.nextCursor;
        if (!page.hasMore) {
          break;
        }
      }
    } finally {
      await pagedDb.destroy();
    }

    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    expect(hasMore).toEqual([true, true, true, false]);
  });

  it('uses timestamp and id as an opaque pagination tie-breaker', () => {
    const items = [
      { id: 'a', updatedAtMs: 100 },
      { id: 'b', updatedAtMs: 100 },
      { id: 'c', updatedAtMs: 101 },
    ];
    const first = (service as any).paginateFeed(
      items,
      'updates',
      { limit: 1 },
      (item: any) => item.updatedAtMs,
      (item: any) => item.id,
      {
        cursor: null,
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 0,
        snapshotUpperBoundMs: 1000,
      },
    );
    const decoded = (service as any).decodeFeedCursor(first.nextCursor, {
      kind: 'updates',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      scopeFingerprint: 'scope-fingerprint',
      watermarkMs: 0,
    });
    const second = (service as any).paginateFeed(
      items,
      'updates',
      { limit: 2, cursor: first.nextCursor },
      (item: any) => item.updatedAtMs,
      (item: any) => item.id,
      {
        cursor: decoded,
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 0,
        snapshotUpperBoundMs: 1000,
      },
    );

    expect(first).toMatchObject({
      items: [{ id: 'a', updatedAtMs: 100 }],
      hasMore: true,
    });
    expect(second).toEqual({
      items: [
        { id: 'b', updatedAtMs: 100 },
        { id: 'c', updatedAtMs: 101 },
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('rejects v1 cursors and cursors from another feed', () => {
    const v1Cursor = Buffer.from(
      JSON.stringify({
        version: 1,
        kind: 'updates',
        timestampMs: 100,
        id: 'a',
      }),
      'utf8',
    ).toString('base64url');
    const cursor = Buffer.from(
      JSON.stringify({
        version: 2,
        kind: 'deleted',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 0,
        snapshotUpperBoundMs: 1000,
        timestampMs: 100,
        id: 'a',
      }),
      'utf8',
    ).toString('base64url');

    expect(() =>
      (service as any).decodeFeedCursor(cursor, {
        kind: 'updates',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 0,
      }),
    ).toThrow('Invalid RAG feed cursor');
    expect(() =>
      (service as any).decodeFeedCursor(v1Cursor, {
        kind: 'updates',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 0,
      }),
    ).toThrow('Invalid RAG feed cursor');
  });

  it('rejects cursor reuse across scope and watermark changes', () => {
    const cursor = feedCursor('updates', 'scope-fingerprint', 100, 200, 'a');
    for (const expected of [
      {
        kind: 'updates',
        workspaceId: 'other-workspace',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 100,
      },
      {
        kind: 'updates',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'changed-fingerprint',
        watermarkMs: 100,
      },
      {
        kind: 'updates',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        scopeFingerprint: 'scope-fingerprint',
        watermarkMs: 101,
      },
    ]) {
      expect(() => (service as any).decodeFeedCursor(cursor, expected)).toThrow(
        'Invalid RAG feed cursor',
      );
    }
  });

  it('publishes the snapshot upper watermark only on the terminal page', () => {
    expect(
      (service as any).feedWatermark(
        { items: [{ updatedAtMs: 120 }], hasMore: true },
        (item: any) => item.updatedAtMs,
        100,
        500,
      ),
    ).toBe(120);
    expect(
      (service as any).feedWatermark(
        { items: [], hasMore: false },
        (item: any) => item.updatedAtMs,
        100,
        500,
      ),
    ).toBe(500);
  });

  it('keeps cursor scope stable across ordinary content-set changes', async () => {
    const first = await (service as any).getFeedScopeFingerprint(scope);
    const second = await (service as any).getFeedScopeFingerprint({
      ...scope,
      space: { ...scope.space, updatedAt: new Date() },
    });

    expect(second).toBe(first);
  });
});
