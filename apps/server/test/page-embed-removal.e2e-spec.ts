import { randomUUID } from 'node:crypto';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { Node } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { sql, type Kysely } from 'kysely';
import * as Y from 'yjs';
import {
  applyPageEmbedRemoval,
  planPageEmbedRemoval,
} from '../src/cli/page-embed-removal';
import { createCliDatabase, loadCliEnv } from '../src/cli/cli.util';
import { pageEmbedAttachmentCloneId } from '../src/cli/page-embed-attachment-clones';
import { up as removeLegacyPageEmbeds } from '../src/database/migrations/20260822T040000-remove-legacy-page-embeds';

loadCliEnv();

const describeWithPostgres = process.env.DATABASE_URL ? describe : describe.skip;
const WORKSPACE_ID = '20000000-0000-4000-8000-000000000001';
const SPACE_ID = '20000000-0000-4000-8000-000000000002';
const CONSUMER_ID = '20000000-0000-4000-8000-000000000003';
const SOURCE_ID = '20000000-0000-4000-8000-000000000004';
const SOURCE_TWO_ID = '20000000-0000-4000-8000-000000000008';
const SOURCE_THREE_ID = '20000000-0000-4000-8000-000000000009';
const CREATOR_ID = '20000000-0000-4000-8000-000000000010';
const IMAGE_ID = '20000000-0000-4000-8000-000000000011';
const FILE_ID = '20000000-0000-4000-8000-000000000012';

const LegacyPageEmbed = Node.create({
  name: 'pageEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      id: { default: null },
      sourcePageId: { default: null },
    };
  },
});

const FixtureImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      attachmentId: { default: null },
      src: { default: null },
    };
  },
});

const FixtureAttachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      attachmentId: { default: null },
      url: { default: null },
    };
  },
});

const legacyDocument = {
  type: 'doc',
  content: [
    {
      type: 'pageEmbed',
      attrs: { id: 'legacy-reference', sourcePageId: SOURCE_ID },
    },
    {
      type: 'pageEmbed',
      attrs: { id: 'legacy-reference-2', sourcePageId: SOURCE_TWO_ID },
    },
    {
      type: 'pageEmbed',
      attrs: { id: 'legacy-reference-3', sourcePageId: SOURCE_THREE_ID },
    },
  ],
};

const plainSourceDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'preserved source' }],
    },
  ],
};

const sourceDocument = {
  type: 'doc',
  content: [
    ...plainSourceDocument.content,
    {
      type: 'image',
      attrs: {
        attachmentId: IMAGE_ID,
        src: `/api/attachments/files/${IMAGE_ID}/source.png`,
      },
    },
    {
      type: 'attachment',
      attrs: {
        attachmentId: FILE_ID,
        url: `/api/files/${FILE_ID}/source.pdf`,
      },
    },
  ],
};

async function createFixtureTables(db: Kysely<any>): Promise<void> {
  const statements = [
    `create table pages (
      id uuid primary key,
      workspace_id uuid not null,
      space_id uuid not null,
      parent_page_id uuid,
      deleted_at timestamptz,
      content jsonb,
      ydoc bytea,
      text_content text,
      updated_at timestamptz not null default now()
    )`,
    `create table page_access_rules (id uuid primary key, page_id uuid not null)`,
    `create table shares (
      id uuid primary key,
      page_id uuid not null,
      include_sub_pages boolean,
      deleted_at timestamptz
    )`,
    `create table attachments (
      id uuid primary key,
      file_name varchar not null,
      file_path varchar not null,
      file_size bigint,
      file_ext varchar not null,
      mime_type varchar,
      type varchar,
      creator_id uuid not null,
      page_id uuid,
      space_id uuid,
      workspace_id uuid not null,
      text_content text,
      content_index_status varchar,
      content_index_error varchar,
      content_index_started_at timestamptz,
      content_indexed_at timestamptz,
      content_index_version integer,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create table page_history (
      id uuid primary key,
      content jsonb,
      change_data jsonb
    )`,
    `create table page_transclusions (id uuid primary key, content jsonb)`,
    `create table page_template_revisions (
      id uuid primary key,
      content jsonb,
      content_hash varchar
    )`,
    `create table page_template_operations (
      id uuid primary key,
      workspace_id uuid not null,
      consumer_page_id uuid,
      operation_kind varchar not null,
      status varchar not null,
      attachment_mapping jsonb,
      staged_content jsonb,
      graph_fencing_token bigint,
      reference_node_id varchar
    )`,
    `create table databases (id uuid primary key, description_content jsonb)`,
    `create table database_cells (id uuid primary key, value jsonb)`,
    `create table comments (id uuid primary key, content jsonb)`,
    `create table page_transclusion_references (
      id uuid primary key,
      workspace_id uuid not null,
      reference_page_id uuid not null,
      source_page_id uuid not null,
      transclusion_id varchar,
      reference_kind varchar not null,
      reference_node_id varchar
    )`,
  ];
  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

async function seedFixture(db: Kysely<any>): Promise<void> {
  const legacyYdoc = TiptapTransformer.toYdoc(
    structuredClone(legacyDocument),
    'default',
    [StarterKit, LegacyPageEmbed],
  );
  const ydoc = Buffer.from(Y.encodeStateAsUpdate(legacyYdoc));
  legacyYdoc.destroy();

  await sql`
    insert into pages (
      id, workspace_id, space_id, content, ydoc
    ) values (
      ${CONSUMER_ID}::uuid,
      ${WORKSPACE_ID}::uuid,
      ${SPACE_ID}::uuid,
      ${legacyDocument}::jsonb,
      ${ydoc}
    ), (
      ${SOURCE_ID}::uuid,
      ${WORKSPACE_ID}::uuid,
      ${SPACE_ID}::uuid,
      ${sourceDocument}::jsonb,
      null
    ), (
      ${SOURCE_TWO_ID}::uuid,
      ${WORKSPACE_ID}::uuid,
      ${SPACE_ID}::uuid,
      ${plainSourceDocument}::jsonb,
      null
    ), (
      ${SOURCE_THREE_ID}::uuid,
      ${WORKSPACE_ID}::uuid,
      ${SPACE_ID}::uuid,
      ${plainSourceDocument}::jsonb,
      null
    )
  `.execute(db);

  const plainDocument = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'plain pageEmbed text' }],
      },
    ],
  };
  const plainYdoc = TiptapTransformer.toYdoc(
    structuredClone(plainDocument),
    'default',
    [StarterKit],
  );
  const plainBuffer = Buffer.from(Y.encodeStateAsUpdate(plainYdoc));
  plainYdoc.destroy();
  for (let suffix = 5; suffix <= 7; suffix += 1) {
    const id = `20000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
    await sql`
      insert into pages (
        id, workspace_id, space_id, content, ydoc
      ) values (
        ${id}::uuid,
        ${WORKSPACE_ID}::uuid,
        ${SPACE_ID}::uuid,
        ${plainDocument}::jsonb,
        ${plainBuffer}
      )
    `.execute(db);
  }

  await sql`
    insert into attachments (
      id,
      file_name,
      file_path,
      file_size,
      file_ext,
      mime_type,
      type,
      creator_id,
      page_id,
      space_id,
      workspace_id,
      content_index_status,
      content_index_version
    ) values (
      ${IMAGE_ID}::uuid,
      'source.png',
      ${`${WORKSPACE_ID}/files/${IMAGE_ID}/source.png`},
      11,
      '.png',
      'image/png',
      'file',
      ${CREATOR_ID}::uuid,
      ${SOURCE_ID}::uuid,
      ${SPACE_ID}::uuid,
      ${WORKSPACE_ID}::uuid,
      'ready',
      1
    ), (
      ${FILE_ID}::uuid,
      'source.pdf',
      ${`${WORKSPACE_ID}/files/${FILE_ID}/source.pdf`},
      10,
      '.pdf',
      'application/pdf',
      'file',
      ${CREATOR_ID}::uuid,
      ${SOURCE_ID}::uuid,
      ${SPACE_ID}::uuid,
      ${WORKSPACE_ID}::uuid,
      'ready',
      1
    )
  `.execute(db);

  await sql`
    insert into page_history (id, content, change_data) values (
      '21000000-0000-4000-8000-000000000001'::uuid,
      ${legacyDocument}::jsonb,
      ${legacyDocument}::jsonb
    )
  `.execute(db);
  await sql`
    insert into page_transclusions (id, content) values (
      '21000000-0000-4000-8000-000000000002'::uuid,
      ${legacyDocument}::jsonb
    )
  `.execute(db);
  await sql`
    insert into page_template_revisions (id, content) values (
      '21000000-0000-4000-8000-000000000003'::uuid,
      ${legacyDocument}::jsonb
    )
  `.execute(db);
  await sql`
    insert into databases (id, description_content) values (
      '21000000-0000-4000-8000-000000000004'::uuid,
      ${legacyDocument}::jsonb
    )
  `.execute(db);
  await sql`
    insert into database_cells (id, value) values (
      '21000000-0000-4000-8000-000000000005'::uuid,
      ${legacyDocument}::jsonb
    )
  `.execute(db);
  await sql`
    insert into comments (id, content) values (
      '21000000-0000-4000-8000-000000000006'::uuid,
      ${legacyDocument}::jsonb
    )
  `.execute(db);
  await sql`
    insert into page_template_operations (
      id,
      workspace_id,
      consumer_page_id,
      operation_kind,
      status,
      staged_content
    ) values (
      '22000000-0000-4000-8000-000000000001'::uuid,
      ${WORKSPACE_ID}::uuid,
      ${CONSUMER_ID}::uuid,
      'template_sync',
      'completed',
      ${legacyDocument}::jsonb
    ), (
      '22000000-0000-4000-8000-000000000002'::uuid,
      ${WORKSPACE_ID}::uuid,
      ${CONSUMER_ID}::uuid,
      'embed_insert',
      'completed',
      null
    )
  `.execute(db);
  await sql`
    insert into page_transclusion_references (
      id,
      workspace_id,
      reference_page_id,
      source_page_id,
      transclusion_id,
      reference_kind,
      reference_node_id
    ) values (
      '23000000-0000-4000-8000-000000000001'::uuid,
      ${WORKSPACE_ID}::uuid,
      ${CONSUMER_ID}::uuid,
      ${SOURCE_ID}::uuid,
      null,
      'page',
      'legacy-reference'
    ), (
      '23000000-0000-4000-8000-000000000002'::uuid,
      ${WORKSPACE_ID}::uuid,
      ${CONSUMER_ID}::uuid,
      '23000000-0000-4000-8000-000000000099'::uuid,
      'orphan-block',
      'block',
      null
    ), (
      '23000000-0000-4000-8000-000000000003'::uuid,
      ${WORKSPACE_ID}::uuid,
      ${CONSUMER_ID}::uuid,
      ${SOURCE_ID}::uuid,
      'live-block',
      'block',
      null
    )
  `.execute(db);
}

describeWithPostgres('pageEmbed removal PostgreSQL contract', () => {
  it('plans every cleanup surface, converges explicitly, and passes real T040', async () => {
    const schema = `page_embed_t040_${randomUUID().replaceAll('-', '')}`;
    const { db, close } = createCliDatabase();
    try {
      await sql`create schema ${sql.id(schema)}`.execute(db);
      await db.connection().execute(async (connection) => {
        const rawConnection = connection.withoutPlugins();
        await sql`set search_path to ${sql.id(schema)}`.execute(rawConnection);
        await createFixtureTables(rawConnection);
        await seedFixture(rawConnection);

        const probe = await sql<{
          pageContent: unknown;
          pageContentType: string;
          pageJsonPath: boolean;
          historyJsonPath: boolean;
        }>`
          select
            (select content from pages where id = ${CONSUMER_ID}::uuid)
              as "pageContent",
            jsonb_typeof(
              (select content from pages where id = ${CONSUMER_ID}::uuid)
            ) as "pageContentType",
            jsonb_path_exists(
              (select content from pages where id = ${CONSUMER_ID}::uuid),
              '$.** ? (@.type == "pageEmbed")'::jsonpath
            ) as "pageJsonPath",
            jsonb_path_exists(
              (select content from page_history limit 1),
              '$.** ? (@.type == "pageEmbed")'::jsonpath
            ) as "historyJsonPath"
        `.execute(rawConnection);
        expect(Object.keys(probe.rows[0] ?? {})).toEqual([
          'pageContent',
          'pageContentType',
          'pageJsonPath',
          'historyJsonPath',
        ]);
        expect(probe.rows[0]?.pageContentType).toBe('object');
        expect(probe.rows[0]?.pageJsonPath).toBe(true);
        expect(probe.rows[0]?.historyJsonPath).toBe(true);

        const limited = await planPageEmbedRemoval(rawConnection, {
          batchSize: 2,
          contextPageLimit: 2,
        });
        expect(
          limited.surfaces.find(
            (surface) =>
              surface.surface === 'pages.materialization_context_limit',
          )?.status,
        ).toBe('hard_blocker');
        expect(
          limited.batching.maxMaterializationContextPages,
        ).toBeLessThanOrEqual(2);

        const before = await planPageEmbedRemoval(rawConnection, {
          batchSize: 2,
          contextPageLimit: 20,
        });
        const counts = new Map(
          before.surfaces.map((surface) => [surface.surface, surface.count]),
        );
        const expectedSurfaces = [
          'pages.content',
          'pages.ydoc',
          'page_history.content',
          'page_history.change_data',
          'page_transclusions.content',
          'page_template_revisions.content',
          'page_template_operations.staged_content',
          'databases.description_content',
          'database_cells.value',
          'comments.content',
          'page_transclusion_references',
          'orphan_block_transclusion_references',
        ] as const;
        expect(
          expectedSurfaces.filter((surface) => (counts.get(surface) ?? 0) < 1),
        ).toEqual([]);
        expect(before.hardBlockerCount).toBe(0);
        expect(before.pageEmbeds.unsafeAttachmentOwnership).toBe(0);
        expect(before.batching.semanticScanBatches).toBeGreaterThan(1);
        expect(before.batching.maxDecodedPageBatch).toBeLessThanOrEqual(2);
        expect(
          before.batching.maxMaterializationContextPages,
        ).toBeLessThanOrEqual(20);

        const sourceImagePath = `${WORKSPACE_ID}/files/${IMAGE_ID}/source.png`;
        const sourceFilePath = `${WORKSPACE_ID}/files/${FILE_ID}/source.pdf`;
        const objects = new Map<string, Buffer>([
          [sourceImagePath, Buffer.from('image-bytes')],
          [sourceFilePath, Buffer.from('file-bytes')],
        ]);
        const copy = jest.fn(async (source: string, target: string) => {
          const bytes = objects.get(source);
          if (!bytes) throw new Error('source missing');
          objects.set(target, Buffer.from(bytes));
        });
        const applied = await applyPageEmbedRemoval(rawConnection, {
          batchSize: 2,
          contextPageLimit: 20,
          attachmentStorage: {
            copy,
            delete: async (path) => {
              objects.delete(path);
            },
            exists: async (path) => objects.has(path),
          },
          createYdoc: (content) => {
            const document = TiptapTransformer.toYdoc(
              content,
              'default',
              [StarterKit, FixtureImage, FixtureAttachment],
            );
            const update = Buffer.from(Y.encodeStateAsUpdate(document));
            document.destroy();
            return update;
          },
          toText: (content) => {
            const text: string[] = [];
            const stack = [content];
            while (stack.length > 0) {
              const value = stack.pop();
              if (!value || typeof value !== 'object') continue;
              if (
                !Array.isArray(value) &&
                typeof (value as { text?: unknown }).text === 'string'
              ) {
                text.push((value as { text: string }).text);
              }
              stack.push(
                ...(Array.isArray(value) ? value : Object.values(value)),
              );
            }
            return text.reverse().join(' ');
          },
          policies: {
            pages: 'materialize-safe',
            unsafePages: 'neutralize',
            pageHistory: 'purge',
            pageTransclusions: 'neutralize',
            templateRevisions: 'neutralize',
            stagedOperations: 'neutralize',
            databases: 'neutralize',
            databaseCells: 'neutralize',
            comments: 'neutralize',
            references: 'delete-after-clean',
            orphanReferences: 'delete-after-clean',
          },
        });
        expect(
          applied.after.surfaces.reduce(
            (total, surface) => total + surface.count,
            0,
          ),
        ).toBe(0);
        expect(copy).toHaveBeenCalledTimes(2);
        const clonedImageId = pageEmbedAttachmentCloneId(
          CONSUMER_ID,
          IMAGE_ID,
        );
        const clonedFileId = pageEmbedAttachmentCloneId(
          CONSUMER_ID,
          FILE_ID,
        );
        const rewritten = await sql<{ content: unknown }>`
          select content from pages where id = ${CONSUMER_ID}::uuid
        `.execute(rawConnection);
        expect(JSON.stringify(rewritten.rows[0]?.content)).toContain(
          clonedImageId,
        );
        expect(JSON.stringify(rewritten.rows[0]?.content)).toContain(
          clonedFileId,
        );
        const completedClones = await sql<{ count: string }>`
          select count(*)::text as count
          from page_embed_attachment_clone_ledger
          where status = 'completed'
        `.execute(rawConnection);
        expect(Number(completedClones.rows[0]?.count)).toBe(2);

        await rawConnection.transaction().execute(removeLegacyPageEmbeds);
        const columns = await sql<{ columnName: string }>`
          select column_name as "columnName"
          from information_schema.columns
          where table_schema = ${schema}
            and table_name = 'page_transclusion_references'
        `.execute(rawConnection);
        expect(columns.rows.map((row) => row.columnName)).not.toContain(
          'reference_kind',
        );
        const ledger = await sql<{ present: boolean }>`
          select to_regclass(
            ${`${schema}.page_embed_removal_ledger`}
          ) is not null as present
        `.execute(rawConnection);
        expect(ledger.rows[0]?.present).toBe(false);
      });
    } finally {
      await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(db);
      await close();
    }
  }, 60_000);
});
