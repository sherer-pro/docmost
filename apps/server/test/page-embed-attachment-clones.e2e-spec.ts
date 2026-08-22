import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  compensateIncompletePageEmbedAttachmentClone,
  pageEmbedAttachmentCloneId,
  preparePageEmbedAttachmentClones,
  type PageEmbedAttachmentCloneStorage,
} from '../src/cli/page-embed-attachment-clones';
import { createCliDatabase, loadCliEnv } from '../src/cli/cli.util';
import { LocalDriver } from '../src/integrations/storage/drivers/local.driver';

loadCliEnv();

const describeWithPostgres = process.env.DATABASE_URL
  ? describe
  : describe.skip;
const WORKSPACE_ID = '31000000-0000-4000-8000-000000000001';
const SPACE_ID = '31000000-0000-4000-8000-000000000002';
const SOURCE_PAGE_ID = '31000000-0000-4000-8000-000000000003';
const CONSUMER_PAGE_ID = '31000000-0000-4000-8000-000000000004';
const CREATOR_ID = '31000000-0000-4000-8000-000000000005';
const IMAGE_ID = '31000000-0000-4000-8000-000000000006';
const FILE_ID = '31000000-0000-4000-8000-000000000007';

interface Fixture {
  db: Kysely<any>;
  close: () => Promise<void>;
  schema: string;
  storageRoot: string;
  driver: LocalDriver;
}

async function createFixture(): Promise<Fixture> {
  const schema = `page_embed_clone_${randomUUID().replaceAll('-', '')}`;
  const storageRoot = await mkdtemp(join(tmpdir(), 'docmost-page-embed-'));
  const { db, close } = createCliDatabase();
  await sql`create schema ${sql.id(schema)}`.execute(db);
  return {
    db,
    close,
    schema,
    storageRoot,
    driver: new LocalDriver({ storagePath: storageRoot }),
  };
}

async function setupSchema(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    create table pages (
      id uuid primary key,
      workspace_id uuid not null,
      space_id uuid not null,
      deleted_at timestamptz
    );
    create table attachments (
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
    )
  `,
    )
    .execute(db);
  await sql`
    insert into pages (id, workspace_id, space_id) values
      (${SOURCE_PAGE_ID}::uuid, ${WORKSPACE_ID}::uuid, ${SPACE_ID}::uuid),
      (${CONSUMER_PAGE_ID}::uuid, ${WORKSPACE_ID}::uuid, ${SPACE_ID}::uuid)
  `.execute(db);
}

async function seedAttachment(
  db: Kysely<any>,
  driver: LocalDriver,
  id: string,
  fileName: string,
  mimeType: string,
  content: string,
): Promise<string> {
  const fileExt = fileName.slice(fileName.lastIndexOf('.'));
  const filePath = `${WORKSPACE_ID}/files/${id}/${fileName}`;
  await driver.upload(filePath, Buffer.from(content));
  await sql`
    insert into attachments (
      id, file_name, file_path, file_size, file_ext, mime_type, type,
      creator_id, page_id, space_id, workspace_id,
      content_index_status, content_index_version
    ) values (
      ${id}::uuid, ${fileName}, ${filePath}, ${Buffer.byteLength(content)},
      ${fileExt}, ${mimeType}, 'file', ${CREATOR_ID}::uuid,
      ${SOURCE_PAGE_ID}::uuid, ${SPACE_ID}::uuid, ${WORKSPACE_ID}::uuid,
      'ready', 1
    )
  `.execute(db);
  return filePath;
}

function request(sourceAttachmentId: string) {
  return {
    consumerPageId: CONSUMER_PAGE_ID,
    sourcePageId: SOURCE_PAGE_ID,
    sourceAttachmentId,
  };
}

async function inSchema<T>(
  fixture: Fixture,
  callback: (db: Kysely<any>) => Promise<T>,
): Promise<T> {
  return fixture.db.connection().execute(async (connection) => {
    await sql`set search_path to ${sql.id(fixture.schema)}`.execute(connection);
    return callback(connection);
  });
}

async function disposeFixture(fixture: Fixture): Promise<void> {
  await sql`drop schema if exists ${sql.id(fixture.schema)} cascade`.execute(
    fixture.db,
  );
  await fixture.close();
  await rm(fixture.storageRoot, { recursive: true, force: true });
}

describeWithPostgres('pageEmbed attachment clone durability', () => {
  it('copies real source-owned image/file objects exactly once across reruns', async () => {
    const fixture = await createFixture();
    try {
      await inSchema(fixture, async (db) => {
        await setupSchema(db);
        await seedAttachment(
          db,
          fixture.driver,
          IMAGE_ID,
          'source.png',
          'image/png',
          'image-bytes',
        );
        await seedAttachment(
          db,
          fixture.driver,
          FILE_ID,
          'source.pdf',
          'application/pdf',
          'file-bytes',
        );
        const copy = jest.fn(fixture.driver.copy.bind(fixture.driver));
        const storage: PageEmbedAttachmentCloneStorage = {
          copy,
          delete: fixture.driver.delete.bind(fixture.driver),
          exists: fixture.driver.exists.bind(fixture.driver),
        };

        const first = await preparePageEmbedAttachmentClones(
          db,
          storage,
          [request(IMAGE_ID), request(FILE_ID), request(IMAGE_ID)],
          {
            batchSize: 1,
            maintenanceFence: 'api-collab-workers-stopped',
          },
        );
        const second = await preparePageEmbedAttachmentClones(
          db,
          storage,
          [request(IMAGE_ID), request(FILE_ID)],
          { maintenanceFence: 'api-collab-workers-stopped' },
        );

        expect(first).toEqual({
          requested: 2,
          completed: 2,
          reused: 0,
          recoveredCopies: 0,
        });
        expect(second).toEqual({
          requested: 2,
          completed: 2,
          reused: 2,
          recoveredCopies: 0,
        });
        expect(copy).toHaveBeenCalledTimes(2);

        for (const [sourceId, fileName, bytes] of [
          [IMAGE_ID, 'source.png', 'image-bytes'],
          [FILE_ID, 'source.pdf', 'file-bytes'],
        ]) {
          const cloneId = pageEmbedAttachmentCloneId(
            CONSUMER_PAGE_ID,
            sourceId,
          );
          const target = `${WORKSPACE_ID}/files/${cloneId}/${fileName}`;
          expect((await fixture.driver.read(target)).toString()).toBe(bytes);
          const row = await sql<{
            pageId: string;
            filePath: string;
            status: string;
          }>`
            select
              attachment.page_id::text as "pageId",
              attachment.file_path as "filePath",
              ledger.status
            from attachments as attachment
            join page_embed_attachment_clone_ledger as ledger
              on ledger.clone_attachment_id = attachment.id
            where attachment.id = ${cloneId}::uuid
          `.execute(db);
          expect(row.rows[0]).toEqual({
            pageId: CONSUMER_PAGE_ID,
            filePath: target,
            status: 'completed',
          });
        }
      });
    } finally {
      await disposeFixture(fixture);
    }
  }, 60_000);

  it('converges after a crash following storage copy without recopying', async () => {
    const fixture = await createFixture();
    try {
      await inSchema(fixture, async (db) => {
        await setupSchema(db);
        await seedAttachment(
          db,
          fixture.driver,
          IMAGE_ID,
          'recover.png',
          'image/png',
          'recoverable-bytes',
        );
        const failedCopy = jest.fn(async (source: string, target: string) => {
          await fixture.driver.copy(source, target);
          throw new Error('simulated process failure');
        });
        await expect(
          preparePageEmbedAttachmentClones(
            db,
            {
              copy: failedCopy,
              delete: fixture.driver.delete.bind(fixture.driver),
              exists: fixture.driver.exists.bind(fixture.driver),
            },
            [request(IMAGE_ID)],
            { maintenanceFence: 'api-collab-workers-stopped' },
          ),
        ).rejects.toThrow('storage_copy_failed');

        const resumedCopy = jest.fn(fixture.driver.copy.bind(fixture.driver));
        const resumed = await preparePageEmbedAttachmentClones(
          db,
          {
            copy: resumedCopy,
            delete: fixture.driver.delete.bind(fixture.driver),
            exists: fixture.driver.exists.bind(fixture.driver),
          },
          [request(IMAGE_ID)],
          { maintenanceFence: 'api-collab-workers-stopped' },
        );
        expect(failedCopy).toHaveBeenCalledTimes(1);
        expect(resumedCopy).not.toHaveBeenCalled();
        expect(resumed).toMatchObject({
          completed: 1,
          recoveredCopies: 1,
        });
      });
    } finally {
      await disposeFixture(fixture);
    }
  }, 60_000);

  it('compensates a tracked partial copy and can retry from a clean state', async () => {
    const fixture = await createFixture();
    try {
      await inSchema(fixture, async (db) => {
        await setupSchema(db);
        await seedAttachment(
          db,
          fixture.driver,
          FILE_ID,
          'retry.pdf',
          'application/pdf',
          'retry-bytes',
        );
        await expect(
          preparePageEmbedAttachmentClones(
            db,
            {
              copy: async (source, target) => {
                await fixture.driver.copy(source, target);
                throw new Error('simulated process failure');
              },
              delete: fixture.driver.delete.bind(fixture.driver),
              exists: fixture.driver.exists.bind(fixture.driver),
            },
            [request(FILE_ID)],
            { maintenanceFence: 'api-collab-workers-stopped' },
          ),
        ).rejects.toThrow('storage_copy_failed');

        const cloneId = pageEmbedAttachmentCloneId(CONSUMER_PAGE_ID, FILE_ID);
        expect(
          await compensateIncompletePageEmbedAttachmentClone(
            db,
            fixture.driver,
            cloneId,
            { maintenanceFence: 'api-collab-workers-stopped' },
          ),
        ).toBe(true);
        const target = `${WORKSPACE_ID}/files/${cloneId}/retry.pdf`;
        expect(await fixture.driver.exists(target)).toBe(false);

        const retried = await preparePageEmbedAttachmentClones(
          db,
          fixture.driver,
          [request(FILE_ID)],
          { maintenanceFence: 'api-collab-workers-stopped' },
        );
        expect(retried.completed).toBe(1);
        expect((await fixture.driver.read(target)).toString()).toBe(
          'retry-bytes',
        );
      });
    } finally {
      await disposeFixture(fixture);
    }
  }, 60_000);
});
