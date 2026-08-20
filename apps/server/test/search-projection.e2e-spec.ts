import type postgresTypes from 'postgres';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { v7 as uuid7 } from 'uuid';
import { postgres } from '../src/database/postgres-client';
import type { DB } from '../src/database/types/db';
import type { KyselyDB } from '../src/database/types/kysely.types';
import { normalizePostgresUrl } from '../src/common/helpers';
import { UserRepo } from '../src/database/repos/user/user.repo';
import { SpaceMemberRepo } from '../src/database/repos/space/space-member.repo';
import { DatabaseSearchProjectionService } from '../src/core/database/services/database-search-projection.service';
import { DictionarySearchService } from '../src/core/dictionary/dictionary-search.service';

jest.setTimeout(30_000);

describe('search projections (e2e)', () => {
  const workspaceId = uuid7();
  const userId = uuid7();
  const referencedUserId = uuid7();
  const spaceId = uuid7();
  const pageId = uuid7();
  const databaseId = uuid7();
  const termId = uuid7();
  const definitionTermId = uuid7();
  const properties = {
    text: uuid7(),
    code: uuid7(),
    select: uuid7(),
    user: uuid7(),
    checkbox: uuid7(),
    pageReference: uuid7(),
    json: uuid7(),
    uuid: uuid7(),
  };
  let database: postgresTypes.Sql;
  let repositoryClient: postgresTypes.Sql;
  let kysely: KyselyDB;
  let projection: DatabaseSearchProjectionService;
  let dictionarySearch: DictionarySearchService;
  let canReadSpace = true;

  beforeAll(async () => {
    const databaseUrl = normalizePostgresUrl(process.env.DATABASE_URL!);
    database = postgres(databaseUrl, { max: 2 });
    repositoryClient = postgres(databaseUrl, { max: 2 });
    kysely = new Kysely<DB>({
      dialect: new PostgresJSDialect({ postgres: repositoryClient }),
      plugins: [new CamelCasePlugin()],
    });
    projection = new DatabaseSearchProjectionService(kysely);
    dictionarySearch = new DictionarySearchService(
      kysely,
      new UserRepo(kysely),
      new SpaceMemberRepo(kysely, {} as never, {} as never),
      {
        hasAnyReadablePageInSpace: jest.fn(async () => canReadSpace),
      } as never,
    );

    await kysely
      .insertInto('workspaces')
      .values({ id: workspaceId, name: 'Search projection E2E' })
      .execute();
    await kysely
      .insertInto('users')
      .values([
        {
          id: userId,
          name: 'Search Owner',
          email: `search-owner-${userId}@example.test`,
          role: 'owner',
          workspaceId,
        },
        {
          id: referencedUserId,
          name: 'Ada Search',
          email: `search-member-${referencedUserId}@example.test`,
          role: 'member',
          workspaceId,
        },
      ])
      .execute();
    await kysely
      .insertInto('spaces')
      .values({
        id: spaceId,
        name: 'Search Space',
        slug: `search-space-${spaceId}`,
        workspaceId,
        creatorId: userId,
        settings: { dictionary: { enabled: true } },
      } as never)
      .execute();
    await kysely
      .insertInto('spaceMembers')
      .values({ spaceId, userId, role: 'admin', addedById: userId })
      .execute();
    await kysely
      .insertInto('pages')
      .values({
        id: pageId,
        slugId: `search-row-${pageId}`,
        title: 'Database row',
        spaceId,
        workspaceId,
        creatorId: userId,
      })
      .execute();
    await kysely
      .insertInto('databases')
      .values({
        id: databaseId,
        name: 'Search Database',
        spaceId,
        workspaceId,
        creatorId: userId,
        lastUpdatedById: userId,
      })
      .execute();
    await kysely
      .insertInto('databaseRows')
      .values({
        databaseId,
        pageId,
        workspaceId,
        createdById: userId,
        updatedById: userId,
      })
      .execute();
    await kysely
      .insertInto('databaseProperties')
      .values([
        property(properties.text, 'Notes', 'multiline_text', 1),
        property(properties.code, 'Implementation', 'code', 2),
        property(properties.select, 'Stage', 'select', 3, {
          options: [{ value: 'blue', label: 'Blue Label' }],
        }),
        property(properties.user, 'Owner', 'user', 4),
        property(properties.checkbox, 'Approved', 'checkbox', 5),
        property(properties.pageReference, 'Reference', 'page_reference', 6),
        property(properties.json, 'Serialized', 'multiline_text', 7),
        property(properties.uuid, 'Opaque', 'code', 8),
      ] as never)
      .execute();
    await kysely
      .insertInto('databaseCells')
      .values([
        cell(properties.text, 'Résumé alpha roadmap'),
        cell(properties.code, 'const searchable = true;'),
        cell(properties.select, 'blue'),
        cell(properties.user, referencedUserId),
        cell(properties.checkbox, true),
        cell(properties.pageReference, pageId),
        cell(properties.json, { secret: 'serialized-json' }),
        cell(properties.uuid, uuid7()),
      ] as never)
      .execute();

    await kysely
      .insertInto('dictionaryTerms')
      .values([
        {
          id: termId,
          spaceId,
          workspaceId,
          creatorId: userId,
          term: 'Résumé',
          definitionMarkdown: 'A concise professional summary.',
        },
        {
          id: definitionTermId,
          spaceId,
          workspaceId,
          creatorId: userId,
          term: 'Governance',
          definitionMarkdown: 'Guidance for a resume workflow.',
        },
      ])
      .execute();
    await kysely
      .insertInto('dictionaryTermAliases')
      .values([
        alias(termId, 'Résumé', 'résumé', true),
        alias(termId, 'Résumés', 'résumés', false),
        alias(definitionTermId, 'Governance', 'governance', true),
      ])
      .execute();
  });

  afterAll(async () => {
    await kysely
      ?.deleteFrom('workspaces')
      .where('id', '=', workspaceId)
      .execute();
    await Promise.all([kysely?.destroy(), database?.end({ timeout: 5 })]);
  });

  it('indexes only safe database display values and updates its tsvector', async () => {
    const storedSelect = await kysely
      .selectFrom('databaseProperties')
      .select('settings')
      .where('id', '=', properties.select)
      .executeTakeFirstOrThrow();
    expect(storedSelect.settings).toEqual({
      options: [{ value: 'blue', label: 'Blue Label' }],
    });
    await projection.refreshRow(pageId, workspaceId);
    const page = await kysely
      .selectFrom('pages')
      .select(['databaseSearchText', 'databaseSearchTsv'])
      .where('id', '=', pageId)
      .executeTakeFirstOrThrow();

    expect(page.databaseSearchText).toContain('Résumé alpha roadmap');
    expect(page.databaseSearchText).toContain('const searchable = true;');
    expect(page.databaseSearchText).toContain('Blue Label');
    expect(page.databaseSearchText).toContain('Ada Search');
    expect(page.databaseSearchText).not.toContain('Notes');
    expect(page.databaseSearchText).not.toContain('serialized-json');
    expect(page.databaseSearchText).not.toContain(pageId);
    expect(page.databaseSearchTsv).toBeTruthy();

    const vectorMatch = await sql<{ matches: boolean }>`
      SELECT database_search_tsv @@ to_tsquery('english', 'alpha:*') AS matches
      FROM pages
      WHERE id = ${pageId}
    `.execute(kysely);
    expect(vectorMatch.rows[0].matches).toBe(true);

    const snippets = await projection.buildMatches(
      [pageId],
      workspaceId,
      'resume',
    );
    expect(snippets.get(pageId)?.[0]).toMatchObject({
      propertyId: properties.text,
      propertyName: 'Notes',
    });
  });

  it('rebuilds select labels and user display names from authoritative rows', async () => {
    await kysely
      .updateTable('databaseProperties')
      .set({
        settings: {
          options: [{ value: 'blue', label: 'Azure Label' }],
        },
      } as never)
      .where('id', '=', properties.select)
      .execute();
    await projection.refreshDatabase(databaseId, workspaceId);
    await kysely
      .updateTable('users')
      .set({ name: 'Grace Search' })
      .where('id', '=', referencedUserId)
      .execute();
    await projection.refreshRowsForUser(referencedUserId, workspaceId);

    const page = await kysely
      .selectFrom('pages')
      .select('databaseSearchText')
      .where('id', '=', pageId)
      .executeTakeFirstOrThrow();
    expect(page.databaseSearchText).toContain('Azure Label');
    expect(page.databaseSearchText).not.toContain('Blue Label');
    expect(page.databaseSearchText).toContain('Grace Search');
    expect(page.databaseSearchText).not.toContain('Ada Search');
  });

  it('uses the shared Dictionary ranking and enforces live scope state', async () => {
    const storedSpace = await kysely
      .selectFrom('spaces')
      .select('settings')
      .where('id', '=', spaceId)
      .executeTakeFirstOrThrow();
    expect(storedSpace.settings).toEqual({ dictionary: { enabled: true } });
    const options = { userId, workspaceId };
    const exact = await dictionarySearch.search(
      { query: 'resume', limit: 10 },
      options,
    );
    expect(exact.items[0]).toMatchObject({
      id: termId,
      matchedField: 'term',
      rank: 1000,
    });

    const form = await dictionarySearch.search(
      { query: 'resumes', limit: 10 },
      options,
    );
    expect(form.items[0]).toMatchObject({
      id: termId,
      matchedField: 'form',
      matchedForm: 'Résumés',
      rank: 900,
    });

    const definition = await dictionarySearch.search(
      { query: 'workflow', limit: 10 },
      options,
    );
    expect(definition.items[0]).toMatchObject({
      id: definitionTermId,
      matchedField: 'definition',
      rank: 100,
    });

    canReadSpace = false;
    await expect(
      dictionarySearch.search({ query: 'resume', limit: 10 }, options),
    ).resolves.toEqual({ items: [] });
    canReadSpace = true;

    await kysely
      .updateTable('spaces')
      .set({ settings: { dictionary: { enabled: false } } } as never)
      .where('id', '=', spaceId)
      .execute();
    await expect(
      dictionarySearch.search({ query: 'resume', limit: 10 }, options),
    ).resolves.toEqual({ items: [] });
    await kysely
      .updateTable('spaces')
      .set({ settings: { dictionary: { enabled: true } } } as never)
      .where('id', '=', spaceId)
      .execute();

    const candidateOnly = await dictionarySearch.search(
      { query: 'resume', limit: 10 },
      { ...options, candidateIds: [definitionTermId] },
    );
    expect(candidateOnly.items.map((item) => item.id)).toEqual([
      definitionTermId,
    ]);
  });

  function property(
    id: string,
    name: string,
    type: string,
    position: number,
    settings?: unknown,
  ) {
    return {
      id,
      databaseId,
      workspaceId,
      creatorId: userId,
      name,
      type,
      position,
      settings: settings ?? null,
    };
  }

  function cell(propertyId: string, value: unknown) {
    return {
      databaseId,
      pageId,
      propertyId,
      workspaceId,
      value:
        typeof value === 'string'
          ? sql`to_jsonb(${value}::text)`
          : typeof value === 'boolean'
            ? sql`to_jsonb(${value}::boolean)`
            : sql`${value}::jsonb`,
      createdById: userId,
      updatedById: userId,
    };
  }

  function alias(
    currentTermId: string,
    value: string,
    normalizedAlias: string,
    isPrimary: boolean,
  ) {
    return {
      termId: currentTermId,
      spaceId,
      workspaceId,
      alias: value,
      normalizedAlias,
      isPrimary,
    };
  }
});
