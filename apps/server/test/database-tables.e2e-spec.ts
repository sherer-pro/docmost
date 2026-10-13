jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
jest.mock('../src/common/helpers/prosemirror/utils', () => ({
  ...jest.requireActual('../src/common/helpers/prosemirror/utils'),
  getAttachmentIds: () => [],
}));
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from '../src/database/postgres-client';
import { up as createDatabaseTables } from '../src/database/migrations/20260301T120000-databases';
import {
  up as addRevisions,
  down as removeRevisions,
} from '../src/database/migrations/20261013T120000-database-revisions';
import { DatabaseRepo } from '../src/database/repos/database/database.repo';
import { DatabaseRowRepo } from '../src/database/repos/database/database-row.repo';
import { DatabaseCellRepo } from '../src/database/repos/database/database-cell.repo';
import { DatabasePropertyRepo } from '../src/database/repos/database/database-property.repo';
import { DatabaseViewRepo } from '../src/database/repos/database/database-view.repo';
import { DatabaseViewQueryService } from '../src/core/database/services/database-view-query.service';
import { DatabaseService } from '../src/core/database/services/database.service';
import { normalizeDatabaseViewState } from '@docmost/api-contract';
import { ExportService } from '../src/integrations/export/export.service';
import { DocmostArchiveImportService } from '../src/integrations/import/services/docmost-archive-import.service';
import * as JSZip from 'jszip';
import { ForbiddenException } from '@nestjs/common';
import { QueueOutboxRepo } from '../src/database/repos/queue-outbox/queue-outbox.repo';
import { QueueOutboxService } from '../src/integrations/queue/outbox/queue-outbox.service';
import { up as createOutbox } from '../src/database/migrations/20260805T130000-queue-outbox';
import { up as allowNotificationDispatch } from '../src/database/migrations/20260809T140000-notification-dispatch-outbox';

const databaseUrl = process.env.DATABASE_TABLES_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('Database tables PostgreSQL acceptance', () => {
  const schema = `database_tables_${randomUUID().replace(/-/g, '')}`;
  const workspaceId = randomUUID();
  const spaceId = randomUUID();
  const databaseId = randomUUID();
  const actorId = randomUUID();
  const assignedId = randomUUID();
  const ids = Array.from({ length: 1000 }, () => randomUUID());
  const propertyIds = Array.from({ length: 20 }, () => randomUUID());
  let db: Kysely<any>;
  let queryService: DatabaseViewQueryService;
  let service: DatabaseService;
  let cells: DatabaseCellRepo;
  let properties: DatabasePropertyRepo;
  let views: DatabaseViewRepo;
  let rowRepo: DatabaseRowRepo;
  const readable = new Set(ids.slice(100));
  let queryCount = 0;
  let baseline: { ms: number; queries: number };
  const actor = { id: actorId, workspaceId, locale: 'en-US' } as any;
  const input = () => ({
    databaseId,
    workspaceId,
    spaceId,
    readablePageIds: [...readable],
    properties: [
      { id: propertyIds[0], type: 'number' },
      {
        id: propertyIds[1],
        type: 'multi_select',
        settings: {
          options: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ],
        },
      },
      { id: propertyIds[2], type: 'date' },
    ],
    state: normalizeDatabaseViewState({}),
  });

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('An isolated localhost test database is required');
    const connection = postgres(databaseUrl!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    db = new Kysely<any>({
      dialect: new PostgresJSDialect({ postgres: connection }),
      plugins: [new CamelCasePlugin()],
      log: (event) => {
        if (event.level === 'query') queryCount += 1;
      },
    });
    await db.schema.createSchema(schema).execute();
    await sql`create function gen_uuid_v7() returns uuid language sql as 'select gen_random_uuid()'`.execute(
      db,
    );
    await sql`create table workspaces(id uuid primary key)`.execute(db);
    await sql`create table users(id uuid primary key, workspace_id uuid, name text, email text)`.execute(
      db,
    );
    await sql`create table spaces(id uuid primary key, workspace_id uuid, name text, slug text, description text, settings jsonb default '{}')`.execute(
      db,
    );
    await sql`create table pages(id uuid primary key, title text, slug_id text, icon text, content jsonb, parent_page_id uuid, position text, workspace_id uuid, space_id uuid, settings jsonb default '{}', deleted_at timestamptz)`.execute(
      db,
    );
    await sql`create table labels(id uuid primary key, space_id uuid, name text)`.execute(
      db,
    );
    await sql`create table page_labels(page_id uuid, label_id uuid)`.execute(
      db,
    );
    await sql`create table attachments(id uuid primary key)`.execute(db);
    await createDatabaseTables(db);
    await sql`alter table databases add column page_id uuid, add column description_content jsonb`.execute(
      db,
    );
    await addRevisions(db);
    await createOutbox(db);
    await allowNotificationDispatch(db);
    await db.insertInto('workspaces').values({ id: workspaceId }).execute();
    await db
      .insertInto('spaces')
      .values({
        id: spaceId,
        workspaceId,
        name: 'Synthetic space',
        slug: 'synthetic',
      })
      .execute();
    await db
      .insertInto('users')
      .values([
        { id: actorId, workspaceId, name: 'Synthetic actor' },
        { id: assignedId, workspaceId, name: 'Synthetic assignee' },
      ])
      .execute();
    await db
      .insertInto('pages')
      .values(
        ids.map((id, index) => ({
          id,
          title: `Row ${index}`,
          slugId: id,
          position: String(index).padStart(5, '0'),
          workspaceId,
          spaceId,
        })),
      )
      .execute();
    await db
      .insertInto('databases')
      .values({
        id: databaseId,
        name: 'Synthetic database',
        workspaceId,
        spaceId,
      })
      .execute();
    await db
      .insertInto('databaseProperties')
      .values(
        propertyIds.map((id, index) => ({
          id,
          databaseId,
          workspaceId,
          name: `Field ${index}`,
          position: index,
          type:
            index === 0
              ? 'number'
              : index === 1
                ? 'multi_select'
                : index === 2
                  ? 'date'
                  : index === 3
                    ? 'user'
                    : index === 4
                      ? 'url'
                      : index === 5
                        ? 'email'
                        : index === 6
                          ? 'phone'
                          : 'multiline_text',
          settings:
            index === 1
              ? {
                  options: [
                    { value: 'a', label: 'Alpha' },
                    { value: 'b', label: 'Beta' },
                  ],
                }
              : null,
        })),
      )
      .execute();
    await db
      .insertInto('databaseRows')
      .values(ids.map((pageId) => ({ pageId, databaseId, workspaceId })))
      .execute();
    const records = ids.flatMap((pageId, index) =>
      propertyIds.map((propertyId, field) => ({
        pageId,
        propertyId,
        databaseId,
        workspaceId,
        value: sql`${JSON.stringify(field === 0 ? index : field === 1 ? (index % 2 ? ['a', 'b'] : ['a']) : field === 2 ? { start: index % 2 ? '2026-10-13' : '2026-10-12' } : field === 3 ? null : field === 4 ? 'https://example.test' : field === 5 ? 'synthetic@example.test' : field === 6 ? '+1 555 0100' : `Value ${index}`)}::text::jsonb`,
      })),
    );
    for (let index = 0; index < records.length; index += 1000)
      await db
        .insertInto('databaseCells')
        .values(records.slice(index, index + 1000))
        .execute();
    const databaseRepo = new DatabaseRepo(db as any);
    rowRepo = new DatabaseRowRepo(db as any);
    cells = new DatabaseCellRepo(db as any);
    properties = new DatabasePropertyRepo(db as any);
    views = new DatabaseViewRepo(db as any);
    queryService = new DatabaseViewQueryService(db as any, rowRepo);
    service = new DatabaseService(
      databaseRepo,
      rowRepo,
      cells,
      properties,
      views,
      {
        findById: async (id) =>
          db
            .selectFrom('pages')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst(),
      } as any,
      {} as any,
      {} as any,
      {
        findById: async (id) => ({
          id,
          name: 'Synthetic assignee',
          workspaceId,
        }),
      } as any,
      { createForUser: async () => ({ cannot: () => false }) } as any,
      {
        assertCanReadPage: async () => {},
        assertCanWritePage: async (page) => {
          if (!readable.has(page.id)) throw new ForbiddenException();
        },
        getSidebarAccessSnapshot: async () => ({
          readablePageIds: readable,
          writablePageIds: readable,
        }),
        getAssignableSpaceUserIds: async () => new Set([actorId, assignedId]),
      } as any,
      { enqueuePageEvents: async () => {} } as any,
      {} as any,
      db as any,
      undefined,
      undefined,
      new QueueOutboxService(
        db as any,
        new QueueOutboxRepo(db as any),
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      ),
      queryService,
    );
    queryCount = 0;
    const start = performance.now();
    await rowRepo.findByDatabaseIdPaginated(databaseId, workspaceId, spaceId, {
      limit: 100,
      readablePageIds: [...readable],
    });
    baseline = { ms: performance.now() - start, queries: queryCount };
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.schema.dropSchema(schema).cascade().execute();
      await db.destroy();
    }
  });

  it('applies ACL before pagination and computes global totals over 900 accessible rows', async () => {
    const view = input();
    view.state.calculations = {
      [propertyIds[0]]: 'sum',
      [propertyIds[2]]: 'earliest',
    };
    const page = await queryService.list(view, { limit: 100 });
    expect(page.items).toHaveLength(100);
    expect(page.items[0].pageId).toBe(ids[100]);
    const summary = await queryService.summary(view);
    expect(summary.count).toBe(900);
    expect(summary.values[propertyIds[0]]).toBe(494550);
    expect(summary.values[propertyIds[2]]).toBe('2026-10-12');
  });

  it('uses numerical multi-sort and has no duplicates across page boundaries', async () => {
    const view = input();
    view.state.sorts = [
      { propertyId: propertyIds[0], direction: 'desc' },
      { propertyId: 'title', direction: 'asc' },
    ];
    const first = await queryService.list(view, { limit: 100 });
    const second = await queryService.list(view, {
      limit: 100,
      cursor: first.nextCursor,
    });
    expect(first.items[0].pageId).toBe(ids[999]);
    expect(second.items[0].pageId).toBe(ids[899]);
    expect(
      new Set([...first.items, ...second.items].map((row) => row.pageId)).size,
    ).toBe(200);
  });

  it('supports nested OR filters and tag groups without double-counting global totals', async () => {
    const view = input();
    view.state.groupBy = propertyIds[1];
    view.state.filter = {
      conjunction: 'and',
      conditions: [
        {
          conjunction: 'or',
          conditions: [
            { propertyId: propertyIds[0], operator: 'equals', value: 102 },
            { propertyId: propertyIds[0], operator: 'equals', value: 103 },
          ],
        },
      ],
    };
    const summary = await queryService.summary(view);
    expect(summary.count).toBe(2);
    expect(summary.groups.map((group) => [group.label, group.count])).toEqual([
      ['Alpha', 2],
      ['Beta', 1],
    ]);
    const beta = await queryService.list(
      { ...view, groupKey: JSON.stringify('b') },
      { limit: 100 },
    );
    expect(beta.items.map((row) => row.pageId)).toEqual([ids[103]]);
  });

  it('filters legacy encoded text and references through read-only normalization', async () => {
    await cells.upsertCell({
      databaseId,
      workspaceId,
      pageId: ids[110],
      propertyId: propertyIds[7],
      value: JSON.stringify('legacy text'),
    });
    const view = input();
    view.properties.push({ id: propertyIds[7], type: 'multiline_text' });
    view.state.filter = {
      conjunction: 'and',
      conditions: [
        {
          propertyId: propertyIds[7],
          operator: 'equals',
          value: 'legacy text',
        },
      ],
    };
    expect(
      (await queryService.list(view, { limit: 100 })).items.map(
        (row) => row.pageId,
      ),
    ).toEqual([ids[110]]);
    expect(
      (await cells.findByDatabaseAndPage(databaseId, ids[110])).find(
        (cell) => cell.propertyId === propertyIds[7],
      ).value,
    ).toBe(JSON.stringify('legacy text'));
  });

  it('rejects stale cell and view revisions', async () => {
    const payload = {
      cells: [{ propertyId: propertyIds[0], value: 1234, expectedRevision: 1 }],
    };
    await service.batchUpdateRowCells(
      databaseId,
      ids[100],
      payload,
      actor,
      workspaceId,
    );
    expect(
      (await cells.findByDatabaseAndPage(databaseId, ids[100])).find(
        (cell) => cell.propertyId === propertyIds[0],
      )?.value,
    ).toBe(1234);
    await expect(
      service.batchUpdateRowCells(
        databaseId,
        ids[100],
        payload,
        actor,
        workspaceId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const created = await views.insertView({
      databaseId,
      workspaceId,
      name: 'View',
      type: 'table',
      config: null,
    });
    const results = await Promise.allSettled([
      views.updateView(created.id, { name: 'First' }, undefined, 1),
      views.updateView(created.id, { name: 'Second' }, undefined, 1),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason.status,
    ).toBe(409);
  });

  it('rolls back cells and notifications together when a later cell is invalid', async () => {
    const before = await cells.findByDatabaseAndPage(databaseId, ids[101]);
    await expect(
      service.batchUpdateRowCells(
        databaseId,
        ids[101],
        {
          cells: [
            { propertyId: propertyIds[3], value: { id: assignedId } },
            { propertyId: propertyIds[0], value: 'invalid number' },
          ],
        },
        actor,
        workspaceId,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await cells.findByDatabaseAndPage(databaseId, ids[101])).toEqual(
      before,
    );
    expect(await db.selectFrom('queueOutbox').selectAll().execute()).toEqual(
      [],
    );
  });

  it('rolls back property type and all cells if conversion fails', async () => {
    const initial = await properties.findById(propertyIds[0]);
    const originalUpdate = cells.updateCell.bind(cells);
    let writes = 0;
    const failure = jest
      .spyOn(cells, 'updateCell')
      .mockImplementation(async (...args) => {
        if (++writes === 2) throw new Error('Synthetic conversion failure');
        return originalUpdate(...args);
      });
    await expect(
      service.updateProperty(
        databaseId,
        propertyIds[0],
        { type: 'multiline_text' },
        actor,
        workspaceId,
      ),
    ).rejects.toThrow('Synthetic conversion failure');
    failure.mockRestore();
    expect(await properties.findById(propertyIds[0])).toEqual(initial);
    expect(
      (await cells.findByDatabaseAndPage(databaseId, ids[0])).find(
        (cell) => cell.propertyId === propertyIds[0],
      )?.value,
    ).toBe(0);
  });

  it('allows exactly one concurrent writer for the same cell revision', async () => {
    const results = await Promise.allSettled(
      [1, 2].map((value) =>
        service.batchUpdateRowCells(
          databaseId,
          ids[115],
          {
            cells: [{ propertyId: propertyIds[0], value, expectedRevision: 1 }],
          },
          actor,
          workspaceId,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason.status,
    ).toBe(409);
  });

  it('rechecks row ACL and reports partial failures without leaking restricted values', async () => {
    const before = await cells.findByDatabaseAndPage(databaseId, ids[0]);
    const result = await service.batchUpdateRows(
      databaseId,
      {
        rows: [
          {
            pageId: ids[0],
            operation: 'upsert_cells',
            cells: [{ propertyId: propertyIds[0], value: 888 }],
          },
          {
            pageId: ids[116],
            operation: 'upsert_cells',
            cells: [{ propertyId: propertyIds[0], value: 888 }],
          },
          {
            pageId: ids[117],
            operation: 'upsert_cells',
            cells: [{ propertyId: propertyIds[0], value: 'bad' }],
          },
        ],
      },
      actor,
      workspaceId,
    );
    expect(result.updatedRows).toEqual([ids[116]]);
    expect(result.failures).toEqual([
      { pageId: ids[0], code: 'forbidden' },
      { pageId: ids[117], code: 'invalid_value' },
    ]);
    expect(await cells.findByDatabaseAndPage(databaseId, ids[0])).toEqual(
      before,
    );
  });

  it('persists assignment dispatch in the real transactional outbox', async () => {
    await service.batchUpdateRowCells(
      databaseId,
      ids[118],
      { cells: [{ propertyId: propertyIds[3], value: { id: assignedId } }] },
      actor,
      workspaceId,
    );
    const entries = await db.selectFrom('queueOutbox').selectAll().execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'notification_dispatch',
      status: 'pending',
    });
    expect(entries[0].payload.jobData.candidateUserIds).toEqual([assignedId]);
  });

  it('sorts 2, 10, 100 numerically and preserves ties across cursors', async () => {
    for (const [offset, value] of [2, 10, 100, 100].entries())
      await cells.upsertCell({
        databaseId,
        workspaceId,
        pageId: ids[120 + offset],
        propertyId: propertyIds[0],
        value,
      });
    const view = input();
    view.state.filter = {
      conjunction: 'and',
      conditions: [
        { propertyId: 'title', operator: 'contains', value: 'Row 12' },
      ],
    };
    view.state.sorts = [{ propertyId: propertyIds[0], direction: 'asc' }];
    const first = await queryService.list(view, { limit: 3 });
    const second = await queryService.list(view, {
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(first.items.map((row) => row.pageId)).toEqual(ids.slice(120, 123));
    expect(second.items[0].pageId).toBe(ids[123]);
  });

  it('filters timed dates by their local calendar day and validates ranges', async () => {
    await cells.upsertCell({
      databaseId,
      workspaceId,
      pageId: ids[150],
      propertyId: propertyIds[2],
      value: {
        start: '2026-10-12T21:00:00.000Z',
        end: '2026-10-13T21:00:00.000Z',
        timeZone: 'Europe/Moscow',
      } as any,
    });
    const view = input();
    view.state.filter = {
      conjunction: 'and',
      conditions: [
        {
          conjunction: 'or',
          conditions: [150, 151].map((index) => ({
            propertyId: 'title',
            operator: 'equals',
            value: `Row ${index}`,
          })),
        },
        {
          propertyId: propertyIds[2],
          operator: 'between',
          value: ['2026-10-13', '2026-10-14'],
        },
      ],
    };
    expect(
      (await queryService.list(view, { limit: 100 })).items.map(
        (row) => row.pageId,
      ),
    ).toEqual([ids[150], ids[151]]);
    await expect(
      service.batchUpdateRowCells(
        databaseId,
        ids[152],
        {
          cells: [
            {
              propertyId: propertyIds[2],
              value: { start: '2026-10-14', end: '2026-10-13' },
            },
          ],
        },
        actor,
        workspaceId,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps a cell save behind atomic property conversion', async () => {
    let entered!: () => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const update = cells.updateCell.bind(cells);
    let first = true;
    const interception = jest
      .spyOn(cells, 'updateCell')
      .mockImplementation(async (...args) => {
        if (first) {
          first = false;
          entered();
          await gate;
        }
        return update(...args);
      });
    try {
      const conversion = service.updateProperty(
        databaseId,
        propertyIds[9],
        { type: 'number' },
        actor,
        workspaceId,
      );
      await locked;
      const save = service.batchUpdateRowCells(
        databaseId,
        ids[160],
        {
          cells: [
            { propertyId: propertyIds[9], value: 300, expectedRevision: 1 },
          ],
        },
        actor,
        workspaceId,
      );
      release();
      await conversion;
      await expect(save).rejects.toMatchObject({ status: 409 });
      const cell = (
        await cells.findByDatabaseAndPage(databaseId, ids[160])
      ).find((cell) => cell.propertyId === propertyIds[9]);
      expect(cell.value).toMatchObject({
        value: null,
        rawValueBeforeTypeChange: 'Value 160',
      });
    } finally {
      release();
      interception.mockRestore();
    }
  });

  it('measures a bounded number of queries for 1000 rows and 20 fields', async () => {
    queryCount = 0;
    const start = performance.now();
    await queryService.list(input(), { limit: 100 });
    const after = { ms: performance.now() - start, queries: queryCount };
    expect(after.queries).toBeLessThanOrEqual(baseline.queries + 1);
    const directory = resolve(process.cwd(), '../../artifacts/database');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 'postgres-results.json'),
      JSON.stringify(
        { rows: 1000, fields: 20, accessibleRows: 900, baseline, after },
        null,
        2,
      ),
    );
  });

  it('exports and imports legacy and V2 views with canonical values and remapped property identities', async () => {
    const rootId = randomUUID();
    await db
      .insertInto('pages')
      .values({
        id: rootId,
        title: 'Database root',
        slugId: rootId,
        workspaceId,
        spaceId,
      })
      .execute();
    await db
      .updateTable('databases')
      .set({ pageId: rootId })
      .where('id', '=', databaseId)
      .execute();
    const config = normalizeDatabaseViewState({
      sorts: [{ propertyId: propertyIds[0], direction: 'asc' }],
      groupBy: propertyIds[1],
      calculations: { [propertyIds[0]]: 'sum' },
      visibleColumns: { [propertyIds[2]]: false },
    });
    await views.insertView({
      databaseId,
      workspaceId,
      name: 'Version 2',
      type: 'table',
      config: config as any,
    });
    await views.insertView({
      databaseId,
      workspaceId,
      name: 'Legacy',
      type: 'table',
      config: {
        sortState: { propertyId: propertyIds[0], direction: 'asc' },
      } as any,
    });
    const exporter = new ExportService(
      {
        getPageAndDescendants: async () =>
          db.selectFrom('pages').selectAll().execute(),
      } as any,
      db as any,
      {} as any,
      {
        getAppUrl: () => 'http://127.0.0.1',
        getStorageDriver: () => 'local',
      } as any,
      {} as any,
      {} as any,
      {
        assertCanReadPage: async () => {},
        getEffectiveAccessForPages: async (pages) =>
          new Map(
            pages.map((page) => [
              page.id,
              {
                capabilities: {
                  canRead: page.id === rootId || readable.has(page.id),
                },
              },
            ]),
          ),
        getSidebarAccessSnapshot: async () => ({
          readablePageIds: new Set([rootId, ...readable]),
        }),
      } as any,
      {} as any,
    );
    jest.spyOn(exporter as any, 'zipPages').mockResolvedValue(undefined);
    const exported = await exporter.exportDatabaseArchive(databaseId, actor);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      exported.fileStream.on('data', (chunk) =>
        chunks.push(Buffer.from(chunk)),
      );
      exported.fileStream.on('end', resolve);
      exported.fileStream.on('error', reject);
    });
    const zip = await JSZip.loadAsync(Buffer.concat(chunks));
    const data = JSON.parse(
      await zip.file('docmost-data.json').async('string'),
    );
    expect(data.databaseRows).toHaveLength(900);
    expect(data.databaseCells.every((cell) => readable.has(cell.pageId))).toBe(
      true,
    );
    const pageMap = new Map<string, string>(
      data.pages.map((page) => [page.id, randomUUID()]),
    );
    const propertyMap = new Map<string, string>(
      data.databaseProperties.map((property) => [property.id, randomUUID()]),
    );
    const importedId = randomUUID();
    await db
      .insertInto('pages')
      .values(
        data.pages.map((page) => ({
          id: pageMap.get(page.id),
          title: page.title,
          slugId: pageMap.get(page.id),
          workspaceId,
          spaceId,
        })),
      )
      .execute();
    const importer = new DocmostArchiveImportService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await db.transaction().execute(async (trx) =>
      (importer as any).insertDatabases({
        data,
        fileTask: { workspaceId, spaceId, creatorId: actorId },
        pageIdMap: pageMap,
        slugIdMap: pageMap,
        databaseIdMap: new Map([[databaseId, importedId]]),
        propertyIdMap: propertyMap,
        attachmentIdMap: new Map(),
        userIdMap: new Map([
          [actorId, actorId],
          [assignedId, assignedId],
        ]),
        report: { skipped: { pageReferences: 0, userReferences: 0 } },
        trx,
      }),
    );
    const importedViews = await views.findByDatabaseId(importedId);
    const importedConfig: any = importedViews.find(
      (view) => view.name === 'Version 2',
    ).config;
    expect(importedConfig.groupBy).toBe(propertyMap.get(propertyIds[1]));
    expect(importedConfig.sorts[0].propertyId).toBe(
      propertyMap.get(propertyIds[0]),
    );
    expect(
      (importedViews.find((view) => view.name === 'Legacy').config as any)
        .sortState.propertyId,
    ).toBe(propertyMap.get(propertyIds[0]));
    const importedCells = await db
      .selectFrom('databaseCells')
      .selectAll()
      .where('databaseId', '=', importedId)
      .execute();
    const importedByKey = new Map(
      importedCells.map((cell) => [
        `${cell.pageId}:${cell.propertyId}`,
        cell.value,
      ]),
    );
    expect(importedCells).toHaveLength(data.databaseCells.length);
    for (const original of data.databaseCells)
      expect(
        importedByKey.get(
          `${pageMap.get(original.pageId)}:${propertyMap.get(original.propertyId)}`,
        ),
      ).toEqual(original.value);
  }, 60_000);
});
