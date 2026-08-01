import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Client } from 'typesense';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import type { SearchParams } from 'typesense/lib/Typesense/Types';
import type { SearchResponse } from 'typesense/lib/Typesense/Documents';

const TYPESENSE_PAGE_COLLECTION = 'docmost_pages_v2';
const TYPESENSE_ATTACHMENT_COLLECTION = 'docmost_attachments_v2';

export interface TypesensePageDocument {
  id: string;
  workspaceId: string;
  spaceId: string;
  creatorId: string;
  title: string;
  content: string;
  updatedAt: number;
}

export interface TypesenseAttachmentDocument {
  id: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  fileName: string;
  content: string;
  updatedAt: number;
}

const INDEX_BATCH_SIZE = 500;

@Injectable()
export class TypesenseIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TypesenseIndexService.name);
  private readonly client: Client | null;
  private collectionsReady: Promise<void> | null = null;

  constructor(
    private readonly environmentService: EnvironmentService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.SEARCH_QUEUE)
    private readonly searchQueue: Queue,
  ) {
    this.client = this.isEnabled()
      ? new Client({
          nodes: [{ url: this.environmentService.getTypesenseUrl() }],
          apiKey: this.environmentService.getTypesenseApiKey(),
          connectionTimeoutSeconds: 10,
          numRetries: 2,
          retryIntervalSeconds: 1,
        })
      : null;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      await this.ensureCollections();
      await this.searchQueue.add(
        QueueJob.TYPESENSE_FLUSH,
        {},
        {
          jobId: 'typesense-core-backfill-v2',
          delay: 15_000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 20_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize Typesense: ${this.errorMessage(error)}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.environmentService.getSearchDriver() === 'typesense';
  }

  async searchPages(
    params: SearchParams<TypesensePageDocument>,
  ): Promise<SearchResponse<TypesensePageDocument>> {
    await this.ensureCollections();
    return this.getClient()
      .collections<TypesensePageDocument>(TYPESENSE_PAGE_COLLECTION)
      .documents()
      .search(params, {});
  }

  async searchAttachments(
    params: SearchParams<TypesenseAttachmentDocument>,
  ): Promise<SearchResponse<TypesenseAttachmentDocument>> {
    await this.ensureCollections();
    return this.getClient()
      .collections<TypesenseAttachmentDocument>(TYPESENSE_ATTACHMENT_COLLECTION)
      .documents()
      .search(params, {});
  }

  async rebuildAll(): Promise<void> {
    await this.ensureCollections();
    await this.indexAllPages();
    await this.indexAllAttachments();
    await this.removeStalePages();
    await this.removeStaleAttachments();
  }

  async reconcilePages(pageIds: string[]): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }
    await this.ensureCollections();

    const uniqueIds = [...new Set(pageIds)];
    const rows = await this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id',
        'pages.workspaceId',
        'pages.spaceId',
        'pages.creatorId',
        'pages.title',
        'pages.textContent',
        'pages.updatedAt',
      ])
      .where('pages.id', 'in', uniqueIds)
      .where('pages.deletedAt', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();

    await this.upsertPages(rows.map((row) => this.toPageDocument(row)));

    const indexedIds = new Set(rows.map((row) => row.id));
    const inactiveIds = uniqueIds.filter((id) => !indexedIds.has(id));
    await Promise.all(
      inactiveIds.flatMap((id) => [
        this.deleteDocument(TYPESENSE_PAGE_COLLECTION, id),
        this.deleteByFilter(
          TYPESENSE_ATTACHMENT_COLLECTION,
          `pageId:=${this.filterValue(id)}`,
        ),
      ]),
    );

    await this.indexAttachmentsForPageIds([...indexedIds]);
  }

  async indexAttachments(attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) {
      return;
    }
    await this.ensureCollections();

    const uniqueIds = [...new Set(attachmentIds)];
    const rows = await this.db
      .selectFrom('attachments')
      .innerJoin('pages', 'pages.id', 'attachments.pageId')
      .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
      .select([
        'attachments.id',
        'attachments.workspaceId',
        'attachments.spaceId',
        'attachments.pageId',
        'attachments.fileName',
        'attachments.textContent',
        'attachments.updatedAt',
      ])
      .where('attachments.id', 'in', uniqueIds)
      .where('attachments.deletedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();

    await this.upsertAttachments(
      rows.map((row) => this.toAttachmentDocument(row)),
    );

    const indexedIds = new Set(rows.map((row) => row.id));
    await Promise.all(
      uniqueIds
        .filter((id) => !indexedIds.has(id))
        .map((id) => this.deleteDocument(TYPESENSE_ATTACHMENT_COLLECTION, id)),
    );
  }

  async removeSpace(spaceId: string): Promise<void> {
    await this.ensureCollections();
    const filter = `spaceId:=${this.filterValue(spaceId)}`;
    await Promise.all([
      this.deleteByFilter(TYPESENSE_PAGE_COLLECTION, filter),
      this.deleteByFilter(TYPESENSE_ATTACHMENT_COLLECTION, filter),
    ]);
  }

  async reconcileSpace(spaceId: string): Promise<void> {
    await this.ensureCollections();
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('archivedAt', 'is', null)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!space) {
      await this.removeSpace(spaceId);
      return;
    }

    let cursor: string | null = null;
    while (true) {
      let query = this.db
        .selectFrom('pages')
        .select('id')
        .where('spaceId', '=', spaceId)
        .where('deletedAt', 'is', null)
        .orderBy('id', 'asc')
        .limit(INDEX_BATCH_SIZE);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const pages = await query.execute();
      if (pages.length === 0) {
        return;
      }
      await this.reconcilePages(pages.map((page) => page.id));
      cursor = pages.at(-1).id;
    }
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    await this.ensureCollections();
    const filter = `workspaceId:=${this.filterValue(workspaceId)}`;
    await Promise.all([
      this.deleteByFilter(TYPESENSE_PAGE_COLLECTION, filter),
      this.deleteByFilter(TYPESENSE_ATTACHMENT_COLLECTION, filter),
    ]);
  }

  private async indexAllPages(): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      let query = this.db
        .selectFrom('pages')
        .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
        .select([
          'pages.id',
          'pages.workspaceId',
          'pages.spaceId',
          'pages.creatorId',
          'pages.title',
          'pages.textContent',
          'pages.updatedAt',
        ])
        .where('pages.deletedAt', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .orderBy('pages.id', 'asc')
        .limit(INDEX_BATCH_SIZE);

      if (cursor) {
        query = query.where('pages.id', '>', cursor);
      }

      const rows = await query.execute();
      if (rows.length === 0) {
        return;
      }

      await this.upsertPages(rows.map((row) => this.toPageDocument(row)));
      cursor = rows.at(-1).id;
    }
  }

  private async indexAllAttachments(): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      let query = this.db
        .selectFrom('attachments')
        .innerJoin('pages', 'pages.id', 'attachments.pageId')
        .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
        .select([
          'attachments.id',
          'attachments.workspaceId',
          'attachments.spaceId',
          'attachments.pageId',
          'attachments.fileName',
          'attachments.textContent',
          'attachments.updatedAt',
        ])
        .where('attachments.deletedAt', 'is', null)
        .where('pages.deletedAt', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .orderBy('attachments.id', 'asc')
        .limit(INDEX_BATCH_SIZE);

      if (cursor) {
        query = query.where('attachments.id', '>', cursor);
      }

      const rows = await query.execute();
      if (rows.length === 0) {
        return;
      }

      await this.upsertAttachments(
        rows.map((row) => this.toAttachmentDocument(row)),
      );
      cursor = rows.at(-1).id;
    }
  }

  private async indexAttachmentsForPageIds(pageIds: string[]): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    const rows = await this.db
      .selectFrom('attachments')
      .innerJoin('pages', 'pages.id', 'attachments.pageId')
      .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
      .select([
        'attachments.id',
        'attachments.workspaceId',
        'attachments.spaceId',
        'attachments.pageId',
        'attachments.fileName',
        'attachments.textContent',
        'attachments.updatedAt',
      ])
      .where('attachments.pageId', 'in', pageIds)
      .where('attachments.deletedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();

    await this.upsertAttachments(
      rows.map((row) => this.toAttachmentDocument(row)),
    );
  }

  private async ensureCollections(): Promise<void> {
    if (!this.client) {
      throw new Error('Typesense search is not enabled');
    }

    if (!this.collectionsReady) {
      this.collectionsReady = this.createCollections().catch((error) => {
        this.collectionsReady = null;
        throw error;
      });
    }

    await this.collectionsReady;
  }

  private async createCollections(): Promise<void> {
    const locale = this.environmentService.getTypesenseLocale();
    await this.ensureCollection({
      name: TYPESENSE_PAGE_COLLECTION,
      fields: [
        { name: 'id', type: 'string' },
        { name: 'workspaceId', type: 'string', facet: true },
        { name: 'spaceId', type: 'string', facet: true },
        { name: 'creatorId', type: 'string', facet: true },
        { name: 'title', type: 'string', locale },
        { name: 'content', type: 'string', locale },
        { name: 'updatedAt', type: 'int64', sort: true },
      ],
      default_sorting_field: 'updatedAt',
    });
    await this.ensureCollection({
      name: TYPESENSE_ATTACHMENT_COLLECTION,
      fields: [
        { name: 'id', type: 'string' },
        { name: 'workspaceId', type: 'string', facet: true },
        { name: 'spaceId', type: 'string', facet: true },
        { name: 'pageId', type: 'string', facet: true },
        { name: 'fileName', type: 'string', locale },
        { name: 'content', type: 'string', locale },
        { name: 'updatedAt', type: 'int64', sort: true },
      ],
      default_sorting_field: 'updatedAt',
    });
  }

  private async ensureCollection(schema: Record<string, any>): Promise<void> {
    const client = this.getClient();
    try {
      await client.collections(schema.name).retrieve();
      return;
    } catch (error) {
      if (this.httpStatus(error) !== 404) {
        throw error;
      }
    }

    try {
      await client.collections().create(schema as any);
    } catch (error) {
      if (this.httpStatus(error) !== 409) {
        throw error;
      }
    }
  }

  private async upsertPages(documents: TypesensePageDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.getClient()
      .collections<TypesensePageDocument>(TYPESENSE_PAGE_COLLECTION)
      .documents()
      .import(documents, { action: 'upsert', throwOnFail: true });
  }

  private async upsertAttachments(
    documents: TypesenseAttachmentDocument[],
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.getClient()
      .collections<TypesenseAttachmentDocument>(TYPESENSE_ATTACHMENT_COLLECTION)
      .documents()
      .import(documents, { action: 'upsert', throwOnFail: true });
  }

  private async deleteDocument(
    collection: string,
    documentId: string,
  ): Promise<void> {
    try {
      await this.getClient()
        .collections(collection)
        .documents(documentId)
        .delete();
    } catch (error) {
      if (this.httpStatus(error) !== 404) {
        throw error;
      }
    }
  }

  private async deleteByFilter(
    collection: string,
    filterBy: string,
  ): Promise<void> {
    await this.getClient()
      .collections(collection)
      .documents()
      .delete({ filter_by: filterBy, ignore_not_found: true });
  }

  private async removeStalePages(): Promise<void> {
    await this.forEachExportedIdBatch(
      TYPESENSE_PAGE_COLLECTION,
      async (ids) => {
        const rows = await this.db
          .selectFrom('pages')
          .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
          .select('pages.id')
          .where('pages.id', 'in', ids)
          .where('pages.deletedAt', 'is', null)
          .where('spaces.archivedAt', 'is', null)
          .where('spaces.deletedAt', 'is', null)
          .execute();
        const activeIds = new Set(rows.map((row) => row.id));
        await this.deleteDocumentsByIds(
          TYPESENSE_PAGE_COLLECTION,
          ids.filter((id) => !activeIds.has(id)),
        );
      },
    );
  }

  private async removeStaleAttachments(): Promise<void> {
    await this.forEachExportedIdBatch(
      TYPESENSE_ATTACHMENT_COLLECTION,
      async (ids) => {
        const rows = await this.db
          .selectFrom('attachments')
          .innerJoin('pages', 'pages.id', 'attachments.pageId')
          .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
          .select('attachments.id')
          .where('attachments.id', 'in', ids)
          .where('attachments.deletedAt', 'is', null)
          .where('pages.deletedAt', 'is', null)
          .where('spaces.archivedAt', 'is', null)
          .where('spaces.deletedAt', 'is', null)
          .execute();
        const activeIds = new Set(rows.map((row) => row.id));
        await this.deleteDocumentsByIds(
          TYPESENSE_ATTACHMENT_COLLECTION,
          ids.filter((id) => !activeIds.has(id)),
        );
      },
    );
  }

  private async forEachExportedIdBatch(
    collection: string,
    callback: (ids: string[]) => Promise<void>,
  ): Promise<void> {
    const stream = await this.getClient()
      .collections(collection)
      .documents()
      .exportStream({ include_fields: 'id' });
    let remainder = '';
    let ids: string[] = [];

    const consumeLine = async (line: string) => {
      if (!line.trim()) return;
      const document = JSON.parse(line) as { id?: unknown };
      if (typeof document.id !== 'string') return;
      ids.push(document.id);
      if (ids.length >= INDEX_BATCH_SIZE) {
        const batch = ids;
        ids = [];
        await callback(batch);
      }
    };

    for await (const chunk of stream as unknown as AsyncIterable<
      Buffer | string
    >) {
      remainder += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      let newlineAt = remainder.indexOf('\n');
      while (newlineAt >= 0) {
        await consumeLine(remainder.slice(0, newlineAt));
        remainder = remainder.slice(newlineAt + 1);
        newlineAt = remainder.indexOf('\n');
      }
    }

    await consumeLine(remainder);
    if (ids.length > 0) {
      await callback(ids);
    }
  }

  private async deleteDocumentsByIds(
    collection: string,
    documentIds: string[],
  ): Promise<void> {
    const chunkSize = 100;
    for (let index = 0; index < documentIds.length; index += chunkSize) {
      const ids = documentIds
        .slice(index, index + chunkSize)
        .map((id) => this.filterValue(id))
        .join(',');
      await this.deleteByFilter(collection, `id:=[${ids}]`);
    }
  }

  private toPageDocument(row: {
    id: string;
    workspaceId: string;
    spaceId: string;
    creatorId: string | null;
    title: string | null;
    textContent: string | null;
    updatedAt: Date;
  }): TypesensePageDocument {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      creatorId: row.creatorId ?? '',
      title: row.title ?? '',
      content: row.textContent ?? '',
      updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
    };
  }

  private toAttachmentDocument(row: {
    id: string;
    workspaceId: string;
    spaceId: string;
    pageId: string;
    fileName: string;
    textContent: string | null;
    updatedAt: Date;
  }): TypesenseAttachmentDocument {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      pageId: row.pageId,
      fileName: row.fileName,
      content: row.textContent ?? '',
      updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
    };
  }

  private filterValue(value: string): string {
    return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
  }

  private getClient(): Client {
    if (!this.client) {
      throw new Error('Typesense search is not enabled');
    }
    return this.client;
  }

  private httpStatus(error: unknown): number | undefined {
    return (error as any)?.httpStatus;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
