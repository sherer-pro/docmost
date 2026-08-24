import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Client } from 'typesense';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import type { SearchParams } from 'typesense/lib/Typesense/Types';
import type { SearchResponse } from 'typesense/lib/Typesense/Documents';
import { sql } from 'kysely';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { DatabaseSearchProjectionService } from '../database/services/database-search-projection.service';

export const TYPESENSE_PAGE_ALIAS = 'docmost_pages';
export const TYPESENSE_ATTACHMENT_ALIAS = 'docmost_attachments';
export const TYPESENSE_DICTIONARY_ALIAS = 'docmost_dictionary_terms';
export const TYPESENSE_PAGE_COLLECTION = 'docmost_pages_v3';
export const TYPESENSE_ATTACHMENT_COLLECTION = 'docmost_attachments_v2';
export const TYPESENSE_DICTIONARY_COLLECTION = 'docmost_dictionary_terms_v1';
const TYPESENSE_GENERATION_RETENTION_MS = 24 * 60 * 60_000;
const TYPESENSE_LEGACY_PAGE_COLLECTION = 'docmost_pages_v2';

export interface TypesensePageDocument {
  id: string;
  workspaceId: string;
  spaceId: string;
  creatorId: string;
  title: string;
  content: string;
  databaseContent: string;
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

export interface TypesenseDictionaryDocument {
  id: string;
  workspaceId: string;
  spaceId: string;
  term: string;
  forms: string[];
  definitionText: string;
  updatedAt: number;
}

export const TYPESENSE_DB_BATCH_SIZE = 100;
export const TYPESENSE_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
const TYPESENSE_RECONCILIATION_INTERVAL_MS = 15 * 60_000;
const TYPESENSE_SCHEDULER_RETRY_MS = 60_000;

export function partitionTypesenseDocuments<T extends object>(
  documents: T[],
): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let batchBytes = 0;

  for (const document of documents) {
    const documentBytes =
      Buffer.byteLength(JSON.stringify(document), 'utf8') + 1;
    if (
      batch.length > 0 &&
      (batch.length >= TYPESENSE_DB_BATCH_SIZE ||
        batchBytes + documentBytes > TYPESENSE_IMPORT_MAX_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(document);
    batchBytes += documentBytes;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

export type TypesenseRebuildEntity = 'pages' | 'attachments' | 'dictionary';

export interface TypesenseRebuildOptions {
  workspaceId?: string;
  entities?: TypesenseRebuildEntity[];
}

@Injectable()
export class TypesenseIndexService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TypesenseIndexService.name);
  private readonly client: Client | null;
  private readonly httpAgent: HttpAgent | null;
  private readonly httpsAgent: HttpsAgent | null;
  private collectionsReady: Promise<void> | null = null;
  private collectionsCreated = false;
  private schedulerTimer?: NodeJS.Timeout;
  private schedulerPromise?: Promise<void>;
  private destroyed = false;

  constructor(
    private readonly environmentService: EnvironmentService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.SEARCH_QUEUE)
    private readonly searchQueue: Queue,
    @Optional()
    private readonly databaseSearchProjection?: DatabaseSearchProjectionService,
  ) {
    if (this.isEnabled()) {
      this.httpAgent = new HttpAgent({ keepAlive: true });
      this.httpsAgent = new HttpsAgent({ keepAlive: true });
      this.client = new Client({
        nodes: [{ url: this.environmentService.getTypesenseUrl() }],
        apiKey: this.environmentService.getTypesenseApiKey(),
        connectionTimeoutSeconds: 10,
        numRetries: 2,
        retryIntervalSeconds: 1,
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
      });
    } else {
      this.httpAgent = null;
      this.httpsAgent = null;
      this.client = null;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    await this.registerReconciliationSafely();
    this.schedulerTimer = setInterval(() => {
      void this.registerReconciliationSafely();
    }, TYPESENSE_SCHEDULER_RETRY_MS);
    this.schedulerTimer.unref?.();

    try {
      await this.ensureCollections();

      // A full rebuild is only needed the first time a collection appears.
      // Afterwards lifecycle jobs keep the index current, so restarting the
      // server must not reindex every page and attachment again.
      if (this.collectionsCreated || (await this.aliasesNeedSwitch())) {
        await this.enqueueRebuild('typesense-core-backfill-bootstrap');
      }
    } catch {
      this.logger.error({ event: 'typesense_initialization_failed' });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
    }
    await this.schedulerPromise;
    this.httpAgent?.destroy();
    this.httpsAgent?.destroy();
  }

  private async registerReconciliationSafely(): Promise<void> {
    if (this.destroyed || this.schedulerPromise) {
      return;
    }

    const registration = this.searchQueue
      .add(
        QueueJob.TYPESENSE_FLUSH,
        {},
        {
          jobId: 'typesense-full-reconciliation',
          repeat: { every: TYPESENSE_RECONCILIATION_INTERVAL_MS },
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 10,
        },
      )
      .then(() => undefined)
      .catch(() => {
        this.logger.warn({ event: 'typesense_reconciliation_schedule_failed' });
      });
    this.schedulerPromise = registration;
    try {
      await registration;
    } finally {
      if (this.schedulerPromise === registration) {
        this.schedulerPromise = undefined;
      }
    }
  }

  async enqueueRebuild(jobId?: string): Promise<void> {
    await this.searchQueue.add(
      QueueJob.TYPESENSE_FLUSH,
      {},
      {
        ...(jobId ? { jobId } : {}),
        delay: 15_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 20_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  isEnabled(): boolean {
    return this.environmentService.getSearchDriver() === 'typesense';
  }

  async searchPages(
    params: SearchParams<TypesensePageDocument>,
  ): Promise<SearchResponse<TypesensePageDocument>> {
    await this.ensureCollections();
    return this.getClient()
      .collections<TypesensePageDocument>(TYPESENSE_PAGE_ALIAS)
      .documents()
      .search(params, {});
  }

  async searchAttachments(
    params: SearchParams<TypesenseAttachmentDocument>,
  ): Promise<SearchResponse<TypesenseAttachmentDocument>> {
    await this.ensureCollections();
    return this.getClient()
      .collections<TypesenseAttachmentDocument>(TYPESENSE_ATTACHMENT_ALIAS)
      .documents()
      .search(params, {});
  }

  async searchDictionary(
    params: SearchParams<TypesenseDictionaryDocument>,
  ): Promise<SearchResponse<TypesenseDictionaryDocument>> {
    await this.ensureCollections();
    return this.getClient()
      .collections<TypesenseDictionaryDocument>(TYPESENSE_DICTIONARY_ALIAS)
      .documents()
      .search(params, {});
  }

  async rebuildAll(options: TypesenseRebuildOptions = {}): Promise<void> {
    const startedAt = Date.now();
    await this.ensureCollections();
    const entities = new Set<TypesenseRebuildEntity>(
      options.entities ?? ['pages', 'attachments', 'dictionary'],
    );
    if (entities.has('pages')) {
      await this.databaseSearchProjection?.refreshWorkspace(
        options.workspaceId,
      );
      await this.indexAllPages(options.workspaceId);
      await this.removeStalePages(options.workspaceId);
    }
    if (entities.has('attachments')) {
      await this.indexAllAttachments(options.workspaceId);
      await this.removeStaleAttachments(options.workspaceId);
    }
    if (entities.has('dictionary')) {
      await this.indexAllDictionary(options.workspaceId);
      await this.removeStaleDictionary(options.workspaceId);
    }
    if (!options.workspaceId) {
      await this.switchAliases(entities);
    }
    this.logger.log({
      event: 'typesense_reconciliation_completed',
      durationMs: Date.now() - startedAt,
      entityCount: entities.size,
      scoped: Boolean(options.workspaceId),
    });
  }

  async cleanupGeneration(collection: string, alias: string): Promise<void> {
    if (!collection || !alias || collection === alias) return;
    let current: { collection_name: string };
    try {
      current = await this.getClient().aliases(alias).retrieve();
    } catch (error) {
      if (this.httpStatus(error) === 404) return;
      throw error;
    }
    if (current.collection_name === collection) return;
    try {
      await this.getClient().collections(collection).delete();
      this.logger.log({
        event: 'typesense_generation_removed',
        alias,
        collection,
      });
    } catch (error) {
      if (this.httpStatus(error) !== 404) throw error;
    }
  }

  async reconcilePages(pageIds: string[]): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }
    await this.ensureCollections();

    const uniqueIds = [...new Set(pageIds)];
    for (
      let index = 0;
      index < uniqueIds.length;
      index += TYPESENSE_DB_BATCH_SIZE
    ) {
      await this.reconcilePageBatch(
        uniqueIds.slice(index, index + TYPESENSE_DB_BATCH_SIZE),
      );
    }
  }

  private async reconcilePageBatch(uniqueIds: string[]): Promise<void> {
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
        'pages.databaseSearchText',
        'pages.updatedAt',
      ])
      .where('pages.id', 'in', uniqueIds)
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();

    await this.upsertPages(rows.map((row) => this.toPageDocument(row)));

    const indexedIds = new Set(rows.map((row) => row.id));
    const inactiveIds = uniqueIds.filter((id) => !indexedIds.has(id));
    await this.deleteDocumentsByIds(TYPESENSE_PAGE_COLLECTION, inactiveIds);
    await this.deleteDocumentsByFieldIds(
      TYPESENSE_ATTACHMENT_COLLECTION,
      'pageId',
      inactiveIds,
    );

    await this.indexAttachmentsForPageIds([...indexedIds]);
  }

  async indexAttachments(attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) {
      return;
    }
    await this.ensureCollections();

    const uniqueIds = [...new Set(attachmentIds)];
    for (
      let index = 0;
      index < uniqueIds.length;
      index += TYPESENSE_DB_BATCH_SIZE
    ) {
      await this.indexAttachmentBatch(
        uniqueIds.slice(index, index + TYPESENSE_DB_BATCH_SIZE),
      );
    }
  }

  private async indexAttachmentBatch(uniqueIds: string[]): Promise<void> {
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
      .where('pages.templateKind', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();

    await this.upsertAttachments(
      rows.map((row) => this.toAttachmentDocument(row)),
    );

    const indexedIds = new Set(rows.map((row) => row.id));
    await this.deleteDocumentsByIds(
      TYPESENSE_ATTACHMENT_COLLECTION,
      uniqueIds.filter((id) => !indexedIds.has(id)),
    );
  }

  async reconcileDictionaryTerms(termIds: string[]): Promise<void> {
    if (termIds.length === 0) return;
    await this.ensureCollections();
    const uniqueIds = [...new Set(termIds)];
    for (
      let index = 0;
      index < uniqueIds.length;
      index += TYPESENSE_DB_BATCH_SIZE
    ) {
      await this.reconcileDictionaryTermBatch(
        uniqueIds.slice(index, index + TYPESENSE_DB_BATCH_SIZE),
      );
    }
  }

  private async reconcileDictionaryTermBatch(
    uniqueIds: string[],
  ): Promise<void> {
    const terms = await this.db
      .selectFrom('dictionaryTerms')
      .innerJoin('spaces', 'spaces.id', 'dictionaryTerms.spaceId')
      .select([
        'dictionaryTerms.id',
        'dictionaryTerms.workspaceId',
        'dictionaryTerms.spaceId',
        'dictionaryTerms.term',
        'dictionaryTerms.definitionMarkdown',
        'dictionaryTerms.updatedAt',
      ])
      .where('dictionaryTerms.id', 'in', uniqueIds)
      .where('dictionaryTerms.deletedAt', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .where(
        sql<boolean>`COALESCE((spaces.settings -> 'dictionary' ->> 'enabled')::boolean, false)`,
        '=',
        true,
      )
      .execute();
    const aliases =
      terms.length > 0
        ? await this.db
            .selectFrom('dictionaryTermAliases')
            .select(['termId', 'alias'])
            .where(
              'termId',
              'in',
              terms.map((term) => term.id),
            )
            .where('isPrimary', '=', false)
            .orderBy('alias', 'asc')
            .execute()
        : [];
    const formsByTerm = new Map<string, string[]>();
    for (const alias of aliases) {
      const forms = formsByTerm.get(alias.termId) ?? [];
      forms.push(alias.alias);
      formsByTerm.set(alias.termId, forms);
    }
    await this.upsertDictionary(
      terms.map((term) => this.toDictionaryDocument(term, formsByTerm)),
    );
    const indexedIds = new Set(terms.map((term) => term.id));
    await this.deleteDocumentsByIds(
      TYPESENSE_DICTIONARY_COLLECTION,
      uniqueIds.filter((id) => !indexedIds.has(id)),
    );
  }

  async reconcileDictionarySpace(spaceId: string): Promise<void> {
    await this.ensureCollections();
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('archivedAt', 'is', null)
      .where('deletedAt', 'is', null)
      .where(
        sql<boolean>`COALESCE((settings -> 'dictionary' ->> 'enabled')::boolean, false)`,
        '=',
        true,
      )
      .executeTakeFirst();
    if (!space) {
      await this.deleteByFilter(
        TYPESENSE_DICTIONARY_COLLECTION,
        `spaceId:=${this.filterValue(spaceId)}`,
      );
      return;
    }

    let cursor: string | null = null;
    while (true) {
      let query = this.db
        .selectFrom('dictionaryTerms')
        .select('id')
        .where('spaceId', '=', spaceId)
        .where('deletedAt', 'is', null)
        .orderBy('id', 'asc')
        .limit(TYPESENSE_DB_BATCH_SIZE);
      if (cursor) query = query.where('id', '>', cursor);
      const terms = await query.execute();
      if (terms.length === 0) break;
      await this.reconcileDictionaryTerms(terms.map((term) => term.id));
      cursor = terms.at(-1).id;
    }
    await this.removeStaleDictionary(undefined, spaceId);
  }

  async removeSpace(spaceId: string): Promise<void> {
    await this.ensureCollections();
    const filter = `spaceId:=${this.filterValue(spaceId)}`;
    await Promise.all([
      this.deleteByFilter(TYPESENSE_PAGE_COLLECTION, filter),
      this.deleteByFilter(TYPESENSE_ATTACHMENT_COLLECTION, filter),
      this.deleteByFilter(TYPESENSE_DICTIONARY_COLLECTION, filter),
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
        .where('templateKind', 'is', null)
        .orderBy('id', 'asc')
        .limit(TYPESENSE_DB_BATCH_SIZE);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const pages = await query.execute();
      if (pages.length === 0) {
        break;
      }
      await this.reconcilePages(pages.map((page) => page.id));
      cursor = pages.at(-1).id;
    }
    await this.reconcileDictionarySpace(spaceId);
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    await this.ensureCollections();
    const filter = `workspaceId:=${this.filterValue(workspaceId)}`;
    await Promise.all([
      this.deleteByFilter(TYPESENSE_PAGE_COLLECTION, filter),
      this.deleteByFilter(TYPESENSE_ATTACHMENT_COLLECTION, filter),
      this.deleteByFilter(TYPESENSE_DICTIONARY_COLLECTION, filter),
    ]);
  }

  private async indexAllPages(workspaceId?: string): Promise<void> {
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
          'pages.databaseSearchText',
          'pages.updatedAt',
        ])
        .where('pages.deletedAt', 'is', null)
        .where('pages.templateKind', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .$if(Boolean(workspaceId), (qb) =>
          qb.where('pages.workspaceId', '=', workspaceId!),
        )
        .orderBy('pages.id', 'asc')
        .limit(TYPESENSE_DB_BATCH_SIZE);

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

  private async indexAllAttachments(workspaceId?: string): Promise<void> {
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
        .where('pages.templateKind', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .$if(Boolean(workspaceId), (qb) =>
          qb.where('attachments.workspaceId', '=', workspaceId!),
        )
        .orderBy('attachments.id', 'asc')
        .limit(TYPESENSE_DB_BATCH_SIZE);

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

  private async indexAllDictionary(workspaceId?: string): Promise<void> {
    let cursor: string | null = null;
    while (true) {
      let query = this.db
        .selectFrom('dictionaryTerms')
        .innerJoin('spaces', 'spaces.id', 'dictionaryTerms.spaceId')
        .select('dictionaryTerms.id')
        .where('dictionaryTerms.deletedAt', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .where(
          sql<boolean>`COALESCE((spaces.settings -> 'dictionary' ->> 'enabled')::boolean, false)`,
          '=',
          true,
        )
        .$if(Boolean(workspaceId), (qb) =>
          qb.where('dictionaryTerms.workspaceId', '=', workspaceId!),
        )
        .orderBy('dictionaryTerms.id', 'asc')
        .limit(TYPESENSE_DB_BATCH_SIZE);
      if (cursor) query = query.where('dictionaryTerms.id', '>', cursor);
      const terms = await query.execute();
      if (terms.length === 0) return;
      await this.reconcileDictionaryTerms(terms.map((term) => term.id));
      cursor = terms.at(-1).id;
    }
  }

  private async indexAttachmentsForPageIds(pageIds: string[]): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    for (
      let pageIndex = 0;
      pageIndex < pageIds.length;
      pageIndex += TYPESENSE_DB_BATCH_SIZE
    ) {
      const pageBatch = pageIds.slice(
        pageIndex,
        pageIndex + TYPESENSE_DB_BATCH_SIZE,
      );
      let cursor: string | undefined;
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
          .where('attachments.pageId', 'in', pageBatch)
          .where('attachments.deletedAt', 'is', null)
          .where('pages.deletedAt', 'is', null)
          .where('pages.templateKind', 'is', null)
          .where('spaces.archivedAt', 'is', null)
          .where('spaces.deletedAt', 'is', null)
          .orderBy('attachments.id', 'asc')
          .limit(TYPESENSE_DB_BATCH_SIZE);
        if (cursor) {
          query = query.where('attachments.id', '>', cursor);
        }
        const rows = await query.execute();
        if (rows.length === 0) break;
        await this.upsertAttachments(
          rows.map((row) => this.toAttachmentDocument(row)),
        );
        cursor = rows.at(-1)!.id;
        if (rows.length < TYPESENSE_DB_BATCH_SIZE) break;
      }
    }
  }

  private async aliasesNeedSwitch(): Promise<boolean> {
    const expected = [
      [TYPESENSE_PAGE_ALIAS, TYPESENSE_PAGE_COLLECTION],
      [TYPESENSE_ATTACHMENT_ALIAS, TYPESENSE_ATTACHMENT_COLLECTION],
      [TYPESENSE_DICTIONARY_ALIAS, TYPESENSE_DICTIONARY_COLLECTION],
    ] as const;
    for (const [alias, collection] of expected) {
      try {
        const current = await this.getClient().aliases(alias).retrieve();
        if (current.collection_name !== collection) return true;
      } catch (error) {
        if (this.httpStatus(error) === 404) return true;
        throw error;
      }
    }
    return false;
  }

  private async switchAliases(
    entities: Set<TypesenseRebuildEntity>,
  ): Promise<void> {
    const mappings: Array<[TypesenseRebuildEntity, string, string]> = [
      ['pages', TYPESENSE_PAGE_ALIAS, TYPESENSE_PAGE_COLLECTION],
      [
        'attachments',
        TYPESENSE_ATTACHMENT_ALIAS,
        TYPESENSE_ATTACHMENT_COLLECTION,
      ],
      [
        'dictionary',
        TYPESENSE_DICTIONARY_ALIAS,
        TYPESENSE_DICTIONARY_COLLECTION,
      ],
    ];
    for (const [entity, alias, collection] of mappings) {
      if (!entities.has(entity)) continue;
      const metadata = await this.getClient()
        .collections(collection)
        .retrieve();
      await this.validateGeneration(entity, collection, metadata.num_documents);
      let previous: string | undefined;
      try {
        previous = (await this.getClient().aliases(alias).retrieve())
          .collection_name;
      } catch (error) {
        if (this.httpStatus(error) !== 404) throw error;
      }
      if (!previous && entity === 'pages') {
        try {
          await this.getClient()
            .collections(TYPESENSE_LEGACY_PAGE_COLLECTION)
            .retrieve();
          previous = TYPESENSE_LEGACY_PAGE_COLLECTION;
        } catch (error) {
          if (this.httpStatus(error) !== 404) throw error;
        }
      }
      await this.getClient().aliases().upsert(alias, {
        collection_name: collection,
      });
      this.logger.log({
        event: 'typesense_alias_switched',
        alias,
        collection,
        documentCount: metadata.num_documents,
      });
      if (previous && previous !== collection) {
        await this.searchQueue.add(
          QueueJob.TYPESENSE_CLEANUP_GENERATION,
          { alias, collection: previous },
          {
            jobId: `typesense-cleanup-${alias}-${previous}`,
            delay: TYPESENSE_GENERATION_RETENTION_MS,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: true,
            removeOnFail: 20,
          },
        );
      }
    }
  }

  private async validateGeneration(
    entity: TypesenseRebuildEntity,
    collection: string,
    documentCount: number,
  ): Promise<void> {
    let countQuery;
    let sampleQuery;
    if (entity === 'pages') {
      countQuery = this.db
        .selectFrom('pages')
        .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('pages.deletedAt', 'is', null)
        .where('pages.templateKind', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null);
      sampleQuery = this.db
        .selectFrom('pages')
        .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
        .select('pages.id')
        .where('pages.deletedAt', 'is', null)
        .where('pages.templateKind', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .orderBy('pages.id', 'asc');
    } else if (entity === 'attachments') {
      countQuery = this.db
        .selectFrom('attachments')
        .innerJoin('pages', 'pages.id', 'attachments.pageId')
        .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('attachments.deletedAt', 'is', null)
        .where('pages.deletedAt', 'is', null)
        .where('pages.templateKind', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null);
      sampleQuery = this.db
        .selectFrom('attachments')
        .innerJoin('pages', 'pages.id', 'attachments.pageId')
        .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
        .select('attachments.id')
        .where('attachments.deletedAt', 'is', null)
        .where('pages.deletedAt', 'is', null)
        .where('pages.templateKind', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .orderBy('attachments.id', 'asc');
    } else {
      const enabled = sql<boolean>`COALESCE((spaces.settings -> 'dictionary' ->> 'enabled')::boolean, false)`;
      countQuery = this.db
        .selectFrom('dictionaryTerms')
        .innerJoin('spaces', 'spaces.id', 'dictionaryTerms.spaceId')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('dictionaryTerms.deletedAt', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .where(enabled, '=', true);
      sampleQuery = this.db
        .selectFrom('dictionaryTerms')
        .innerJoin('spaces', 'spaces.id', 'dictionaryTerms.spaceId')
        .select('dictionaryTerms.id')
        .where('dictionaryTerms.deletedAt', 'is', null)
        .where('spaces.archivedAt', 'is', null)
        .where('spaces.deletedAt', 'is', null)
        .where(enabled, '=', true)
        .orderBy('dictionaryTerms.id', 'asc');
    }
    const [countRow, sample] = await Promise.all([
      countQuery.executeTakeFirstOrThrow(),
      sampleQuery.limit(3).execute(),
    ]);
    const expected = Number(countRow.count);
    if (expected !== documentCount) {
      this.logger.error({
        event: 'typesense_generation_count_mismatch',
        entity,
        expected,
        actual: documentCount,
      });
      throw new Error(`Typesense ${entity} generation count mismatch`);
    }
    for (const row of sample) {
      await this.getClient()
        .collections(collection)
        .documents(row.id)
        .retrieve();
    }
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
        { name: 'databaseContent', type: 'string', locale },
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
    await this.ensureCollection({
      name: TYPESENSE_DICTIONARY_COLLECTION,
      fields: [
        { name: 'id', type: 'string' },
        { name: 'workspaceId', type: 'string', facet: true },
        { name: 'spaceId', type: 'string', facet: true },
        { name: 'term', type: 'string', locale },
        { name: 'forms', type: 'string[]', locale },
        { name: 'definitionText', type: 'string', locale },
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
      this.collectionsCreated = true;
    } catch (error) {
      if (this.httpStatus(error) !== 409) {
        throw error;
      }
    }
  }

  private async upsertPages(documents: TypesensePageDocument[]): Promise<void> {
    await this.upsertDocuments(TYPESENSE_PAGE_COLLECTION, documents);
  }

  private async upsertAttachments(
    documents: TypesenseAttachmentDocument[],
  ): Promise<void> {
    await this.upsertDocuments(TYPESENSE_ATTACHMENT_COLLECTION, documents);
  }

  private async upsertDictionary(
    documents: TypesenseDictionaryDocument[],
  ): Promise<void> {
    await this.upsertDocuments(TYPESENSE_DICTIONARY_COLLECTION, documents);
  }

  private async upsertDocuments<T extends object>(
    collection: string,
    documents: T[],
  ): Promise<void> {
    for (const batch of partitionTypesenseDocuments(documents)) {
      await this.getClient()
        .collections<T>(collection)
        .documents()
        .import(batch, { action: 'upsert', throwOnFail: true });
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

  private async removeStalePages(workspaceId?: string): Promise<void> {
    await this.forEachExportedIdBatch(
      TYPESENSE_PAGE_COLLECTION,
      async (ids) => {
        const rows = await this.db
          .selectFrom('pages')
          .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
          .select('pages.id')
          .where('pages.id', 'in', ids)
          .where('pages.deletedAt', 'is', null)
          .where('pages.templateKind', 'is', null)
          .where('spaces.archivedAt', 'is', null)
          .where('spaces.deletedAt', 'is', null)
          .execute();
        const activeIds = new Set(rows.map((row) => row.id));
        await this.deleteDocumentsByIds(
          TYPESENSE_PAGE_COLLECTION,
          ids.filter((id) => !activeIds.has(id)),
        );
      },
      workspaceId,
    );
  }

  private async removeStaleAttachments(workspaceId?: string): Promise<void> {
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
          .where('pages.templateKind', 'is', null)
          .where('spaces.archivedAt', 'is', null)
          .where('spaces.deletedAt', 'is', null)
          .execute();
        const activeIds = new Set(rows.map((row) => row.id));
        await this.deleteDocumentsByIds(
          TYPESENSE_ATTACHMENT_COLLECTION,
          ids.filter((id) => !activeIds.has(id)),
        );
      },
      workspaceId,
    );
  }

  private async removeStaleDictionary(
    workspaceId?: string,
    spaceId?: string,
  ): Promise<void> {
    await this.forEachExportedIdBatch(
      TYPESENSE_DICTIONARY_COLLECTION,
      async (ids) => {
        const rows = await this.db
          .selectFrom('dictionaryTerms')
          .innerJoin('spaces', 'spaces.id', 'dictionaryTerms.spaceId')
          .select('dictionaryTerms.id')
          .where('dictionaryTerms.id', 'in', ids)
          .where('dictionaryTerms.deletedAt', 'is', null)
          .where('spaces.archivedAt', 'is', null)
          .where('spaces.deletedAt', 'is', null)
          .where(
            sql<boolean>`COALESCE((spaces.settings -> 'dictionary' ->> 'enabled')::boolean, false)`,
            '=',
            true,
          )
          .execute();
        const activeIds = new Set(rows.map((row) => row.id));
        await this.deleteDocumentsByIds(
          TYPESENSE_DICTIONARY_COLLECTION,
          ids.filter((id) => !activeIds.has(id)),
        );
      },
      workspaceId,
      spaceId,
    );
  }

  private async forEachExportedIdBatch(
    collection: string,
    callback: (ids: string[]) => Promise<void>,
    workspaceId?: string,
    spaceId?: string,
  ): Promise<void> {
    const filters = [
      workspaceId ? `workspaceId:=${this.filterValue(workspaceId)}` : undefined,
      spaceId ? `spaceId:=${this.filterValue(spaceId)}` : undefined,
    ].filter(Boolean) as string[];
    const stream = await this.getClient()
      .collections(collection)
      .documents()
      .exportStream({
        include_fields: 'id',
        ...(filters.length > 0 ? { filter_by: filters.join(' && ') } : {}),
      });
    let remainder = '';
    let ids: string[] = [];

    const consumeLine = async (line: string) => {
      if (!line.trim()) return;
      const document = JSON.parse(line) as { id?: unknown };
      if (typeof document.id !== 'string') return;
      ids.push(document.id);
      if (ids.length >= TYPESENSE_DB_BATCH_SIZE) {
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
    await this.deleteDocumentsByFieldIds(collection, 'id', documentIds);
  }

  private async deleteDocumentsByFieldIds(
    collection: string,
    field: 'id' | 'pageId',
    documentIds: string[],
  ): Promise<void> {
    for (
      let index = 0;
      index < documentIds.length;
      index += TYPESENSE_DB_BATCH_SIZE
    ) {
      const ids = documentIds
        .slice(index, index + TYPESENSE_DB_BATCH_SIZE)
        .map((id) => this.filterValue(id))
        .join(',');
      await this.deleteByFilter(collection, `${field}:=[${ids}]`);
    }
  }

  private toPageDocument(row: {
    id: string;
    workspaceId: string;
    spaceId: string;
    creatorId: string | null;
    title: string | null;
    textContent: string | null;
    databaseSearchText: string;
    updatedAt: Date;
  }): TypesensePageDocument {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      creatorId: row.creatorId ?? '',
      title: row.title ?? '',
      content: row.textContent ?? '',
      databaseContent: row.databaseSearchText ?? '',
      updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
    };
  }

  private toDictionaryDocument(
    row: {
      id: string;
      workspaceId: string;
      spaceId: string;
      term: string;
      definitionMarkdown: string;
      updatedAt: Date;
    },
    formsByTerm: Map<string, string[]>,
  ): TypesenseDictionaryDocument {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      term: row.term,
      forms: formsByTerm.get(row.id) ?? [],
      definitionText: this.stripMarkdown(row.definitionMarkdown),
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

  private stripMarkdown(value: string): string {
    return value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[>*_~|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
