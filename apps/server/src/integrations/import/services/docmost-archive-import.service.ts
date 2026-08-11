import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { FileTask } from '@docmost/db/types/entity.types';
import {
  DOCMOST_ARCHIVE_SCHEMA_VERSION,
  DOCMOST_ARCHIVE_LEGACY_SCHEMA_VERSION,
  DOCMOST_ARCHIVE_PAGE_EMBED_SCHEMA_VERSION,
  type DocmostArchiveData,
  type DocmostArchiveManifest,
  type DocmostImportOptions,
  type ImportReport,
} from '@docmost/api-contract';
import { promises as fs, createReadStream } from 'node:fs';
import * as path from 'node:path';
import { v7 as uuid7 } from 'uuid';
import { generateSlugId } from '../../../common/helpers';
import {
  getProsemirrorContent,
  getAttachmentIds,
  extractMentions,
  extractPageMentions,
} from '../../../common/helpers/prosemirror/utils';
import { jsonToText } from '../../../collaboration/collaboration.util';
import { ImportService } from './import.service';
import { PageService } from '../../../core/page/services/page.service';
import { StorageService } from '../../storage/storage.service';
import { getAttachmentFolderPath } from '../../../core/attachment/attachment.utils';
import { AttachmentType } from '../../../core/attachment/attachment.constants';
import { executeTx } from '@docmost/db/utils';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { TransclusionService } from '../../../core/page/transclusion/transclusion.service';
import { PageEmbedService } from '../../../core/page/transclusion/page-embed.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { sanitize } from 'sanitize-filename-ts';
import {
  extractReferenceId,
  remapDatabasePageReference,
  remapDatabaseViewConfig,
} from '../../../core/database/utils/database-copy.utils';
import { sql } from 'kysely';
import { QueueJob, QueueName } from '../../queue/constants';
import { CONTENT_INDEXABLE_EXTENSIONS } from '../../../core/attachment/attachment.constants';
import {
  collectPageEmbedsFromPmJson,
  collectReferencesFromPmJson,
} from '../../../core/page/transclusion/utils/transclusion-prosemirror.util';
import type { PageEmbedGraphLease } from '../../../core/page/transclusion/page-embed-graph-lock.service';
import { PageTemplatePolicyService } from '../../../core/page/transclusion/page-template-policy.service';
import { FileTaskStatus } from '../utils/file.utils';
import { normalizeLabelName } from '../../../core/label/utils';

interface StagedAttachment {
  sourceId: string;
  id: string;
  filePath: string;
  pageId: string;
  fileName: string;
  fileSize: string | number | null;
  fileExt: string;
  mimeType: string | null;
  type: string | null;
}

interface ArchiveSnapshotValue {
  content: unknown;
  attachmentIdMap: Map<string, string>;
}

const DOCMOST_ATTACHMENT_UPLOAD_ATTEMPTS = 3;
const DOCMOST_ATTACHMENT_RETRY_DELAY_MS = 2_000;

const transclusionSnapshotKey = (
  referencePageId: string | undefined,
  sourcePageId: string,
  transclusionId: string,
) => `${referencePageId ?? '*'}::${sourcePageId}::${transclusionId}`;

const pageEmbedSnapshotKey = (
  referencePageId: string,
  referenceNodeId: string,
  sourcePageId: string,
) => `${referencePageId}::${referenceNodeId}::${sourcePageId}`;

@Injectable()
export class DocmostArchiveImportService {
  private readonly logger = new Logger(DocmostArchiveImportService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly importService: ImportService,
    private readonly pageService: PageService,
    private readonly storageService: StorageService,
    private readonly backlinkRepo: BacklinkRepo,
    private readonly transclusionService: TransclusionService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE)
    private readonly attachmentQueue: Queue,
    @Optional()
    private readonly pageTemplatePolicy?: PageTemplatePolicyService,
  ) {}

  async process(opts: {
    extractDir: string;
    fileTask: FileTask;
  }): Promise<ImportReport> {
    const { extractDir, fileTask } = opts;
    if (!fileTask.spaceId || !fileTask.creatorId) {
      throw new BadRequestException(
        'Import task has no target space or creator',
      );
    }

    const manifest = JSON.parse(
      await fs.readFile(path.join(extractDir, 'docmost-metadata.json'), 'utf8'),
    ) as DocmostArchiveManifest;
    if (
      manifest.source !== 'docmost' ||
      ![
        DOCMOST_ARCHIVE_LEGACY_SCHEMA_VERSION,
        DOCMOST_ARCHIVE_PAGE_EMBED_SCHEMA_VERSION,
        DOCMOST_ARCHIVE_SCHEMA_VERSION,
      ].includes(manifest.schemaVersion as 2 | 3 | 4)
    ) {
      throw new BadRequestException('Unsupported Docmost archive');
    }
    const dataPath = this.resolveArchivePath(extractDir, manifest.dataFile);
    const data = JSON.parse(
      await fs.readFile(dataPath, 'utf8'),
    ) as DocmostArchiveData;
    if (
      data.schemaVersion !== manifest.schemaVersion ||
      data.scope !== manifest.scope
    ) {
      throw new BadRequestException(
        'Docmost archive data does not match manifest',
      );
    }

    const options = this.resolveOptions(fileTask.options);
    const report = this.createEmptyReport();
    const pageIdMap = new Map(data.pages.map((page) => [page.id, uuid7()]));
    const slugIdMap = new Map(
      data.pages.map((page) => [page.slugId, generateSlugId()]),
    );
    const databaseIdMap = new Map(
      (data.databases ?? []).map((database) => [database.id, uuid7()]),
    );
    const propertyIdMap = new Map(
      (data.databaseProperties ?? []).map((property) => [property.id, uuid7()]),
    );
    const attachmentIdMap = new Map(
      (data.attachments ?? [])
        .filter((attachment) =>
          Boolean(attachment.pageId && pageIdMap.has(attachment.pageId)),
        )
        .map((attachment) => [attachment.id, uuid7()]),
    );
    const userIdMap = await this.buildUserIdMap(data, fileTask.workspaceId);
    const snapshotAttachmentMapsByConsumer = new Map<
      string,
      Map<string, string>
    >();
    const consumerAttachmentMap = (referencePageId: string) => {
      const existing = snapshotAttachmentMapsByConsumer.get(referencePageId);
      if (existing) return existing;
      const created = new Map<string, string>();
      snapshotAttachmentMapsByConsumer.set(referencePageId, created);
      return created;
    };
    const transclusionSnapshots = new Map<string, ArchiveSnapshotValue>();
    for (const snapshot of data.transclusionSnapshots ?? []) {
      const mapping = snapshot.referencePageId
        ? consumerAttachmentMap(snapshot.referencePageId)
        : new Map<string, string>();
      transclusionSnapshots.set(
        transclusionSnapshotKey(
          snapshot.referencePageId,
          snapshot.sourcePageId,
          snapshot.transclusionId,
        ),
        { content: snapshot.content, attachmentIdMap: mapping },
      );
    }
    const pageEmbedSnapshots = new Map<string, ArchiveSnapshotValue>();
    for (const snapshot of 'pageEmbedSnapshots' in data
      ? data.pageEmbedSnapshots
      : []) {
      const mapping = consumerAttachmentMap(snapshot.referencePageId);
      pageEmbedSnapshots.set(
        pageEmbedSnapshotKey(
          snapshot.referencePageId,
          snapshot.referenceNodeId,
          snapshot.sourcePageId,
        ),
        { content: snapshot.content, attachmentIdMap: mapping },
      );
    }
    for (const page of data.pages) {
      const mapping = consumerAttachmentMap(page.id);
      for (const reference of collectReferencesFromPmJson(page.content)) {
        if (pageIdMap.has(reference.sourcePageId)) continue;
        const snapshot =
          transclusionSnapshots.get(
            transclusionSnapshotKey(
              page.id,
              reference.sourcePageId,
              reference.transclusionId,
            ),
          ) ??
          transclusionSnapshots.get(
            transclusionSnapshotKey(
              undefined,
              reference.sourcePageId,
              reference.transclusionId,
            ),
          );
        if (!snapshot) continue;
        snapshot.attachmentIdMap = mapping;
        for (const attachmentId of getAttachmentIds(snapshot.content)) {
          if (!mapping.has(attachmentId)) mapping.set(attachmentId, uuid7());
        }
      }
      for (const reference of collectPageEmbedsFromPmJson(page.content)) {
        if (pageIdMap.has(reference.sourcePageId)) continue;
        const snapshot = pageEmbedSnapshots.get(
          pageEmbedSnapshotKey(
            page.id,
            reference.referenceNodeId,
            reference.sourcePageId,
          ),
        );
        if (!snapshot) continue;
        snapshot.attachmentIdMap = mapping;
        for (const attachmentId of getAttachmentIds(snapshot.content)) {
          if (!mapping.has(attachmentId)) mapping.set(attachmentId, uuid7());
        }
      }
    }

    const actor = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', fileTask.creatorId)
      .where('workspaceId', '=', fileTask.workspaceId)
      .executeTakeFirstOrThrow();
    const effectivePolicy = await this.pageTemplatePolicy?.resolveForUser(
      fileTask.workspaceId,
      fileTask.spaceId,
      actor.id,
    );
    const allowPageEmbeds = false;
    if (!allowPageEmbeds) {
      const archivePageById = new Map(
        data.pages.map((page) => [page.id, page]),
      );
      const collectMaterializedAttachments = (
        consumerPageId: string,
        content: unknown,
        visitedPageIds: Set<string>,
      ) => {
        const mapping = consumerAttachmentMap(consumerPageId);
        for (const reference of collectPageEmbedsFromPmJson(content)) {
          const source = archivePageById.get(reference.sourcePageId);
          if (!source || visitedPageIds.has(source.id)) continue;
          for (const attachmentId of getAttachmentIds(source.content)) {
            if (!mapping.has(attachmentId)) {
              mapping.set(attachmentId, uuid7());
            }
          }
          const nextVisited = new Set(visitedPageIds);
          nextVisited.add(source.id);
          collectMaterializedAttachments(
            consumerPageId,
            source.content,
            nextVisited,
          );
        }
      };
      for (const page of data.pages) {
        collectMaterializedAttachments(
          page.id,
          page.content,
          new Set([page.id]),
        );
      }
    }

    const stagedAttachments = await this.stageAttachments({
      extractDir,
      fileTask,
      data,
      pageIdMap,
      attachmentIdMap,
      snapshotAttachmentMapsByConsumer,
    });

    const rootContainerId = data.scope === 'space' ? uuid7() : null;
    const createdPageIds: string[] = [];
    let graphLease: PageEmbedGraphLease | undefined;
    try {
      let nextRootPosition = await this.pageService.nextPagePosition(
        fileTask.spaceId,
      );
      const rootPosition = nextRootPosition;
      if (rootContainerId) {
        nextRootPosition = generateJitteredKeyBetween(nextRootPosition, null);
      }
      const rewrittenPages = await this.buildRewrittenPages({
        data,
        fileTask,
        pageIdMap,
        slugIdMap,
        databaseIdMap,
        attachmentIdMap,
        userIdMap,
        transclusionSnapshots,
        pageEmbedSnapshots,
        snapshotAttachmentMapsByConsumer,
        allowPageEmbeds,
        rootContainerId,
        nextRootPosition,
        report,
      });
      graphLease = await this.pageEmbedService.prepareBulkPageReferences(
        rewrittenPages.map((page) => ({
          id: page.id,
          workspaceId: page.workspaceId,
          spaceId: page.spaceId,
          content: page.content,
        })),
        actor,
        'import',
      );

      await executeTx(this.db, async (trx) => {
        if (rootContainerId) {
          const emptyContent = getProsemirrorContent(null);
          await trx
            .insertInto('pages')
            .values({
              id: rootContainerId,
              slugId: generateSlugId(),
              title: `${data.sourceSpace?.name || manifest.displayName} (imported)`,
              content: emptyContent as any,
              textContent: '',
              ydoc: await this.importService.createYdoc(emptyContent),
              position: rootPosition,
              parentPageId: null,
              spaceId: fileTask.spaceId!,
              workspaceId: fileTask.workspaceId,
              creatorId: fileTask.creatorId!,
              lastUpdatedById: fileTask.creatorId!,
              settings: {},
            })
            .execute();
          createdPageIds.push(rootContainerId);
        }
        await this.insertPagesTopologically(rewrittenPages, trx);
        createdPageIds.push(...rewrittenPages.map((page) => page.id));

        if (stagedAttachments.length > 0) {
          await trx
            .insertInto('attachments')
            .values(
              stagedAttachments.map((attachment) => ({
                id: attachment.id,
                filePath: attachment.filePath,
                fileName: attachment.fileName,
                fileSize: attachment.fileSize as any,
                fileExt: attachment.fileExt,
                mimeType: attachment.mimeType,
                type: attachment.type,
                creatorId: fileTask.creatorId!,
                pageId: attachment.pageId,
                spaceId: fileTask.spaceId!,
                workspaceId: fileTask.workspaceId,
                contentIndexStatus: CONTENT_INDEXABLE_EXTENSIONS.includes(
                  attachment.fileExt?.toLowerCase() as (typeof CONTENT_INDEXABLE_EXTENSIONS)[number],
                )
                  ? 'pending'
                  : null,
              })),
            )
            .execute();
        }

        await this.insertDatabases({
          data,
          fileTask,
          pageIdMap,
          slugIdMap,
          databaseIdMap,
          propertyIdMap,
          attachmentIdMap,
          userIdMap,
          report,
          trx,
        });
        await this.insertLabels({
          data,
          fileTask,
          pageIdMap,
          report,
          trx,
        });
        await this.applySettingsAndDictionary({
          data,
          fileTask,
          options,
          report,
          trx,
        });
        await this.insertDerivedPageState(rewrittenPages, trx, graphLease);

        report.created.pages = createdPageIds.length;
        report.created.databases = data.databases?.length ?? 0;
        report.created.rows = data.databaseRows?.length ?? 0;
        report.created.attachments = stagedAttachments.length;
        await this.markImportCommitted(trx, fileTask, report);
      });
    } catch (error) {
      await Promise.allSettled(
        stagedAttachments.map((attachment) =>
          this.storageService.delete(attachment.filePath),
        ),
      );
      throw error;
    } finally {
      if (graphLease) {
        try {
          await graphLease.release();
        } catch (error) {
          this.logger.error('Failed to release page embed graph lease', error);
        }
      }
    }

    await Promise.all(
      stagedAttachments
        .filter((attachment) =>
          CONTENT_INDEXABLE_EXTENSIONS.includes(
            attachment.fileExt?.toLowerCase() as (typeof CONTENT_INDEXABLE_EXTENSIONS)[number],
          ),
        )
        .map(async (attachment) => {
          try {
            await this.attachmentQueue.add(
              QueueJob.ATTACHMENT_INDEX_CONTENT,
              { attachmentId: attachment.id },
              {
                attempts: 3,
                backoff: { type: 'exponential', delay: 10_000 },
                removeOnComplete: true,
                removeOnFail: true,
              },
            );
          } catch (error) {
            this.logger.warn(
              `Failed to queue attachment content indexing for ${attachment.id}`,
              error,
            );
          }
        }),
    );

    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: createdPageIds,
      workspaceId: fileTask.workspaceId,
    });
    return report;
  }

  private resolveOptions(value: unknown): DocmostImportOptions {
    const source =
      value && typeof value === 'object'
        ? (value as Partial<DocmostImportOptions>)
        : {};
    return {
      applyDocumentFields: source.applyDocumentFields === true,
      applyDictionary: source.applyDictionary === true,
      applyHeadingNumbering: source.applyHeadingNumbering === true,
      cleanupLegacyHeadingNumbers: source.cleanupLegacyHeadingNumbers !== false,
    };
  }

  private createEmptyReport(): ImportReport {
    return {
      created: {
        pages: 0,
        databases: 0,
        rows: 0,
        attachments: 0,
        labels: 0,
        dictionaryTerms: 0,
      },
      updated: { dictionaryTerms: 0 },
      skipped: {
        dictionaryTerms: 0,
        userReferences: 0,
        pageReferences: 0,
      },
      warnings: [],
    };
  }

  private async buildUserIdMap(
    data: DocmostArchiveData,
    workspaceId: string,
  ): Promise<Map<string, string>> {
    const emails = (data.users ?? [])
      .map((user) => this.normalizeEmail(user.email))
      .filter(Boolean);
    if (emails.length === 0) return new Map();
    const targetUsers = await this.db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('workspaceId', '=', workspaceId)
      .where(sql<string>`lower(email)`, 'in', emails)
      .execute();
    const byEmail = new Map(
      targetUsers.map((user) => [this.normalizeEmail(user.email), user.id]),
    );
    return new Map(
      (data.users ?? [])
        .map((user) => [user.id, byEmail.get(this.normalizeEmail(user.email))])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
  }

  private async stageAttachments(params: {
    extractDir: string;
    fileTask: FileTask;
    data: DocmostArchiveData;
    pageIdMap: Map<string, string>;
    attachmentIdMap: Map<string, string>;
    snapshotAttachmentMapsByConsumer: Map<string, Map<string, string>>;
  }): Promise<StagedAttachment[]> {
    const staged: StagedAttachment[] = [];
    const attachmentById = new Map(
      (params.data.attachments ?? []).map((attachment) => [
        attachment.id,
        attachment,
      ]),
    );
    const stageAttachment = async (
      sourceId: string,
      id: string,
      pageId: string,
    ) => {
      const attachment = attachmentById.get(sourceId);
      if (!attachment) {
        throw new BadRequestException(
          `Archive attachment metadata is missing for ${sourceId}`,
        );
      }
      const sourcePath = this.resolveArchivePath(
        params.extractDir,
        attachment.archivePath,
      );
      await fs.access(sourcePath);
      const safeFileName =
        sanitize(attachment.fileName) || `${id}${attachment.fileExt || ''}`;
      const filePath = `${getAttachmentFolderPath(
        AttachmentType.File,
        params.fileTask.workspaceId,
      )}/${id}/${safeFileName}`;
      let lastError: unknown;
      for (
        let attempt = 1;
        attempt <= DOCMOST_ATTACHMENT_UPLOAD_ATTEMPTS;
        attempt += 1
      ) {
        try {
          await this.storageService.uploadStream(
            filePath,
            createReadStream(sourcePath),
            { recreateClient: true },
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < DOCMOST_ATTACHMENT_UPLOAD_ATTEMPTS) {
            this.logger.warn({
              event: 'docmost_archive_attachment_upload_retry',
              attachmentId: id,
              attempt,
            });
            await this.waitForAttachmentRetry();
          }
        }
      }
      if (lastError) {
        await this.storageService.delete(filePath).catch(() => undefined);
        throw lastError;
      }
      staged.push({
        sourceId,
        id,
        filePath,
        pageId,
        fileName: safeFileName,
        fileSize: attachment.fileSize,
        fileExt: attachment.fileExt,
        mimeType: attachment.mimeType,
        type: attachment.type,
      });
    };
    try {
      for (const attachment of params.data.attachments ?? []) {
        const id = params.attachmentIdMap.get(attachment.id);
        const pageId = attachment.pageId
          ? params.pageIdMap.get(attachment.pageId)
          : undefined;
        if (!id || !pageId) continue;
        await stageAttachment(attachment.id, id, pageId);
      }
      for (const [
        sourceConsumerPageId,
        mapping,
      ] of params.snapshotAttachmentMapsByConsumer) {
        const targetConsumerPageId = params.pageIdMap.get(sourceConsumerPageId);
        if (!targetConsumerPageId) continue;
        for (const [sourceId, id] of mapping) {
          await stageAttachment(sourceId, id, targetConsumerPageId);
        }
      }
      return staged;
    } catch (error) {
      await Promise.allSettled(
        staged.map((attachment) =>
          this.storageService.delete(attachment.filePath),
        ),
      );
      throw error;
    }
  }

  private waitForAttachmentRetry(): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(resolve, DOCMOST_ATTACHMENT_RETRY_DELAY_MS),
    );
  }

  private async markImportCommitted(
    trx: KyselyTransaction,
    fileTask: FileTask,
    report: ImportReport,
  ): Promise<void> {
    const previousResult =
      fileTask.result &&
      typeof fileTask.result === 'object' &&
      !Array.isArray(fileTask.result)
        ? fileTask.result
        : {};
    const result = await trx
      .updateTable('fileTasks')
      .set({
        status: FileTaskStatus.Success,
        errorMessage: null,
        result: { ...previousResult, report } as any,
        updatedAt: new Date(),
      })
      .where('id', '=', fileTask.id)
      .where('status', '=', FileTaskStatus.Processing)
      .executeTakeFirst();

    if (result.numUpdatedRows !== 1n) {
      throw new Error('Import task is no longer in processing state');
    }
  }

  private async buildRewrittenPages(params: {
    data: DocmostArchiveData;
    fileTask: FileTask;
    pageIdMap: Map<string, string>;
    slugIdMap: Map<string, string>;
    databaseIdMap: Map<string, string>;
    attachmentIdMap: Map<string, string>;
    userIdMap: Map<string, string>;
    transclusionSnapshots: Map<string, ArchiveSnapshotValue>;
    pageEmbedSnapshots: Map<string, ArchiveSnapshotValue>;
    snapshotAttachmentMapsByConsumer: Map<string, Map<string, string>>;
    allowPageEmbeds: boolean;
    rootContainerId: string | null;
    nextRootPosition: string;
    report: ImportReport;
  }) {
    const sourceIds = new Set(params.data.pages.map((page) => page.id));
    const archivePageContentById = new Map(
      params.data.pages.map((page) => [page.id, page.content]),
    );
    const databasePageIds = new Set([
      ...(params.data.databases ?? []).flatMap((database) =>
        database.pageId ? [database.pageId] : [],
      ),
      ...(params.data.databaseRows ?? []).map((row) => row.pageId),
    ]);
    let previousRootPosition: string | null = null;
    const result = [];

    for (const page of params.data.pages) {
      const isDatabasePage = databasePageIds.has(page.id);
      const isSourceRoot =
        !page.parentPageId || !sourceIds.has(page.parentPageId);
      let position = page.position;
      if (isSourceRoot && !params.rootContainerId) {
        position =
          previousRootPosition === null
            ? params.nextRootPosition
            : generateJitteredKeyBetween(previousRootPosition, null);
        previousRootPosition = position;
      }
      const content = this.rewritePmNode(
        structuredClone(getProsemirrorContent(page.content)),
        {
          pageIdMap: params.pageIdMap,
          slugIdMap: params.slugIdMap,
          databaseIdMap: params.databaseIdMap,
          attachmentIdMap: params.attachmentIdMap,
          externalSnapshotAttachmentIdMap:
            params.snapshotAttachmentMapsByConsumer.get(page.id),
          sourceArchivePageId: page.id,
          userIdMap: params.userIdMap,
          transclusionSnapshots: params.transclusionSnapshots,
          pageEmbedSnapshots: params.pageEmbedSnapshots,
          archivePageContentById,
          materializingPageIds: new Set(),
          allowPageEmbeds: params.allowPageEmbeds && !isDatabasePage,
          fallbackUserId: params.fileTask.creatorId!,
          report: params.report,
        },
      );
      const settings = this.rewritePageSettings(
        page.settings,
        params.userIdMap,
        params.report,
      );
      const templateKind = isDatabasePage
        ? null
        : page.templateKind === 'synced'
          ? 'synced'
          : page.templateKind === 'regular' || page.isTemplate
            ? 'regular'
            : null;
      result.push({
        id: params.pageIdMap.get(page.id)!,
        slugId: params.slugIdMap.get(page.slugId)!,
        title: page.title,
        icon: page.icon,
        content,
        textContent: jsonToText(content),
        ydoc: await this.importService.createYdoc(content),
        position:
          position ?? generateJitteredKeyBetween(previousRootPosition, null),
        parentPageId: templateKind
          ? null
          : isSourceRoot
            ? params.rootContainerId
            : params.pageIdMap.get(page.parentPageId!)!,
        settings,
        templateKind,
        spaceId: params.fileTask.spaceId!,
        workspaceId: params.fileTask.workspaceId,
        creatorId: params.fileTask.creatorId!,
        lastUpdatedById: params.fileTask.creatorId!,
      });
    }
    return result;
  }

  private async insertPagesTopologically(
    pages: Array<Record<string, any>>,
    trx: KyselyTransaction,
  ): Promise<void> {
    const pending = new Map(pages.map((page) => [page.id, page]));
    const inserted = new Set<string>();
    while (pending.size > 0) {
      const ready = Array.from(pending.values()).filter(
        (page) =>
          !page.parentPageId ||
          inserted.has(page.parentPageId) ||
          !pending.has(page.parentPageId),
      );
      if (ready.length === 0) {
        throw new BadRequestException(
          'Archive page hierarchy contains a cycle',
        );
      }
      await trx
        .insertInto('pages')
        .values(ready as any)
        .execute();
      for (const page of ready) {
        inserted.add(page.id);
        pending.delete(page.id);
      }
    }
  }

  private async insertDatabases(params: {
    data: DocmostArchiveData;
    fileTask: FileTask;
    pageIdMap: Map<string, string>;
    slugIdMap: Map<string, string>;
    databaseIdMap: Map<string, string>;
    propertyIdMap: Map<string, string>;
    attachmentIdMap: Map<string, string>;
    userIdMap: Map<string, string>;
    report: ImportReport;
    trx: KyselyTransaction;
  }): Promise<void> {
    const {
      data,
      fileTask,
      pageIdMap,
      slugIdMap,
      databaseIdMap,
      propertyIdMap,
      attachmentIdMap,
      userIdMap,
      report,
      trx,
    } = params;
    if ((data.databases?.length ?? 0) === 0) return;

    await trx
      .insertInto('databases')
      .values(
        data.databases.map((database) => ({
          id: databaseIdMap.get(database.id)!,
          pageId: database.pageId
            ? (pageIdMap.get(database.pageId) ?? null)
            : null,
          name: database.name,
          description: database.description,
          descriptionContent: this.rewritePmNode(
            structuredClone(database.descriptionContent),
            {
              pageIdMap,
              slugIdMap,
              databaseIdMap,
              attachmentIdMap,
              userIdMap,
              transclusionSnapshots: new Map(),
              pageEmbedSnapshots: new Map(),
              allowPageEmbeds: false,
              fallbackUserId: fileTask.creatorId!,
              report,
            },
          ) as any,
          icon: database.icon,
          spaceId: fileTask.spaceId!,
          workspaceId: fileTask.workspaceId,
          creatorId: fileTask.creatorId!,
          lastUpdatedById: fileTask.creatorId!,
        })),
      )
      .execute();
    if (data.databaseProperties.length > 0) {
      await trx
        .insertInto('databaseProperties')
        .values(
          data.databaseProperties.map((property) => ({
            id: propertyIdMap.get(property.id)!,
            databaseId: databaseIdMap.get(property.databaseId)!,
            name: property.name,
            type: property.type,
            position: property.position,
            settings: property.settings as any,
            workspaceId: fileTask.workspaceId,
            creatorId: fileTask.creatorId!,
          })),
        )
        .execute();
    }
    if (data.databaseRows.length > 0) {
      await trx
        .insertInto('databaseRows')
        .values(
          data.databaseRows.map((row) => ({
            id: uuid7(),
            databaseId: databaseIdMap.get(row.databaseId)!,
            pageId: pageIdMap.get(row.pageId)!,
            workspaceId: fileTask.workspaceId,
            createdById: fileTask.creatorId!,
            updatedById: fileTask.creatorId!,
            archivedAt: row.archived ? new Date() : null,
          })),
        )
        .execute();
    }

    const propertyTypeById = new Map(
      data.databaseProperties.map((property) => [property.id, property.type]),
    );
    if (data.databaseCells.length > 0) {
      await trx
        .insertInto('databaseCells')
        .values(
          data.databaseCells.map((cell) => {
            const type = propertyTypeById.get(cell.propertyId);
            let value = cell.value;
            if (type === 'page_reference') {
              value = remapDatabasePageReference(value, type, pageIdMap, null);
              if (value === null && cell.value !== null) {
                report.skipped.pageReferences += 1;
              }
            } else if (type === 'user') {
              value = this.remapDatabaseUserReference(value, userIdMap, report);
            }
            return {
              id: uuid7(),
              databaseId: databaseIdMap.get(cell.databaseId)!,
              pageId: pageIdMap.get(cell.pageId)!,
              propertyId: propertyIdMap.get(cell.propertyId)!,
              attachmentId: cell.attachmentId
                ? (attachmentIdMap.get(cell.attachmentId) ?? null)
                : null,
              value: value as any,
              workspaceId: fileTask.workspaceId,
              createdById: fileTask.creatorId!,
              updatedById: fileTask.creatorId!,
            };
          }),
        )
        .execute();
    }
    if (data.databaseViews.length > 0) {
      await trx
        .insertInto('databaseViews')
        .values(
          data.databaseViews.map((view) => ({
            id: uuid7(),
            databaseId: databaseIdMap.get(view.databaseId)!,
            name: view.name,
            type: view.type,
            config: remapDatabaseViewConfig(view.config, propertyIdMap) as any,
            workspaceId: fileTask.workspaceId,
            creatorId: fileTask.creatorId!,
          })),
        )
        .execute();
    }
  }

  private async insertLabels(params: {
    data: DocmostArchiveData;
    fileTask: FileTask;
    pageIdMap: Map<string, string>;
    report: ImportReport;
    trx: KyselyTransaction;
  }): Promise<void> {
    const { data, fileTask, pageIdMap, report, trx } = params;
    if ((data.labels?.length ?? 0) === 0) return;
    const existing = await trx
      .selectFrom('labels')
      .select(['id', 'name'])
      .where('spaceId', '=', fileTask.spaceId!)
      .where('type', '=', 'page')
      .execute();
    const byName = new Map(
      existing.map((label) => [this.normalizeName(label.name), label.id]),
    );
    const assignments: Array<{ id: string; pageId: string; labelId: string }> =
      [];

    for (const source of data.labels) {
      const normalized = normalizeLabelName(source.name);
      let labelId = byName.get(normalized);
      if (!labelId) {
        labelId = uuid7();
        await trx
          .insertInto('labels')
          .values({
            id: labelId,
            name: normalized,
            type: 'page',
            spaceId: fileTask.spaceId!,
            workspaceId: fileTask.workspaceId,
          })
          .execute();
        byName.set(normalized, labelId);
        report.created.labels += 1;
      }
      for (const sourcePageId of source.pageIds) {
        const pageId = pageIdMap.get(sourcePageId);
        if (pageId) assignments.push({ id: uuid7(), pageId, labelId });
      }
    }
    if (assignments.length > 0) {
      await trx
        .insertInto('pageLabels')
        .values(assignments)
        .onConflict((conflict) =>
          conflict.columns(['pageId', 'labelId']).doNothing(),
        )
        .execute();
    }
  }

  private async applySettingsAndDictionary(params: {
    data: DocmostArchiveData;
    fileTask: FileTask;
    options: DocmostImportOptions;
    report: ImportReport;
    trx: KyselyTransaction;
  }): Promise<void> {
    const { data, fileTask, options, report, trx } = params;
    const currentSpace = await trx
      .selectFrom('spaces')
      .select('settings')
      .where('id', '=', fileTask.spaceId!)
      .executeTakeFirstOrThrow();
    const current =
      currentSpace.settings &&
      typeof currentSpace.settings === 'object' &&
      !Array.isArray(currentSpace.settings)
        ? ({ ...currentSpace.settings } as Record<string, unknown>)
        : {};
    const portable = data.sourceSpace?.settings ?? {};
    if (options.applyDocumentFields && portable.documentFields) {
      current.documentFields = portable.documentFields;
    }
    if (options.applyHeadingNumbering && portable.headingNumbering) {
      current.headingNumbering = portable.headingNumbering;
    }
    if (options.applyDictionary && portable.dictionary) {
      current.dictionary = portable.dictionary;
    }
    await trx
      .updateTable('spaces')
      .set({ settings: current as any, updatedAt: new Date() })
      .where('id', '=', fileTask.spaceId!)
      .execute();

    if (!options.applyDictionary || (data.dictionary?.length ?? 0) === 0) {
      return;
    }
    const existingAliases = await trx
      .selectFrom('dictionaryTermAliases')
      .innerJoin(
        'dictionaryTerms',
        'dictionaryTerms.id',
        'dictionaryTermAliases.termId',
      )
      .selectAll('dictionaryTermAliases')
      .where('dictionaryTermAliases.spaceId', '=', fileTask.spaceId!)
      .where('dictionaryTerms.deletedAt', 'is', null)
      .execute();
    const aliasesByNormalized = new Map(
      existingAliases.map((alias) => [alias.normalizedAlias, alias]),
    );

    for (const source of data.dictionary) {
      const seenAliases = new Set<string>();
      const aliases = [source.term, ...(source.forms ?? [])]
        .map((alias, index) => ({
          alias: this.normalizeVisibleAlias(alias),
          normalizedAlias: this.normalizeName(alias),
          isPrimary: index === 0,
        }))
        .filter((alias) => {
          if (!alias.alias || seenAliases.has(alias.normalizedAlias)) {
            return false;
          }
          seenAliases.add(alias.normalizedAlias);
          return true;
        });
      const primary = aliases[0];
      if (!primary) continue;
      const existingPrimary = aliasesByNormalized.get(primary.normalizedAlias);
      const existingTermId = existingPrimary?.isPrimary
        ? existingPrimary.termId
        : null;
      const conflict = aliases.find((alias) => {
        const existing = aliasesByNormalized.get(alias.normalizedAlias);
        return existing && existing.termId !== existingTermId;
      });
      if (conflict) {
        report.skipped.dictionaryTerms += 1;
        report.warnings.push(
          `Dictionary term "${source.term}" was skipped because alias "${conflict.alias}" already belongs to another term.`,
        );
        continue;
      }

      const termId = existingTermId ?? uuid7();
      if (existingTermId) {
        await trx
          .updateTable('dictionaryTerms')
          .set({
            term: primary.alias,
            definitionMarkdown: source.definitionMarkdown.trim(),
            updatedAt: new Date(),
            deletedAt: null,
          })
          .where('id', '=', termId)
          .execute();
        await trx
          .deleteFrom('dictionaryTermAliases')
          .where('termId', '=', termId)
          .execute();
        for (const [normalizedAlias, alias] of aliasesByNormalized) {
          if (alias.termId === termId) {
            aliasesByNormalized.delete(normalizedAlias);
          }
        }
        report.updated.dictionaryTerms += 1;
      } else {
        await trx
          .insertInto('dictionaryTerms')
          .values({
            id: termId,
            term: primary.alias,
            definitionMarkdown: source.definitionMarkdown.trim(),
            creatorId: fileTask.creatorId!,
            spaceId: fileTask.spaceId!,
            workspaceId: fileTask.workspaceId,
          })
          .execute();
        report.created.dictionaryTerms += 1;
      }
      await trx
        .insertInto('dictionaryTermAliases')
        .values(
          aliases.map((alias) => ({
            id: uuid7(),
            termId,
            spaceId: fileTask.spaceId!,
            workspaceId: fileTask.workspaceId,
            alias: alias.alias,
            normalizedAlias: alias.normalizedAlias,
            isPrimary: alias.isPrimary,
          })),
        )
        .execute();
      for (const alias of aliases) {
        aliasesByNormalized.set(alias.normalizedAlias, {
          id: uuid7(),
          termId,
          spaceId: fileTask.spaceId!,
          workspaceId: fileTask.workspaceId,
          alias: alias.alias,
          normalizedAlias: alias.normalizedAlias,
          isPrimary: alias.isPrimary,
          createdAt: new Date(),
        });
      }
    }
  }

  private async insertDerivedPageState(
    pages: Array<Record<string, any>>,
    trx: KyselyTransaction,
    graphLease?: PageEmbedGraphLease,
  ): Promise<void> {
    const derivedPages = pages.map((page) => ({
      id: page.id,
      workspaceId: page.workspaceId,
      content: page.content,
    }));
    await this.transclusionService.insertTransclusionsForPages(
      derivedPages,
      trx,
    );
    await this.transclusionService.insertReferencesForPages(derivedPages, trx);
    await this.pageEmbedService.insertPageReferencesForPages(
      pages.map((page) => ({
        id: page.id,
        workspaceId: page.workspaceId,
        spaceId: page.spaceId,
        content: page.content,
      })),
      trx,
      graphLease,
    );

    const backlinks = [];
    const pageIds = new Set(pages.map((page) => page.id));
    for (const page of pages) {
      const mentions = extractPageMentions(extractMentions(page.content));
      for (const mention of mentions) {
        if (mention.entityId !== page.id && pageIds.has(mention.entityId)) {
          backlinks.push({
            sourcePageId: page.id,
            targetPageId: mention.entityId,
            workspaceId: page.workspaceId,
          });
        }
      }
    }
    if (backlinks.length > 0) {
      await this.backlinkRepo.insertBacklink(backlinks, trx);
    }
  }

  private rewritePageSettings(
    value: unknown,
    userIdMap: Map<string, string>,
    report: ImportReport,
  ): Record<string, unknown> {
    const settings =
      value && typeof value === 'object' && !Array.isArray(value)
        ? structuredClone(value as Record<string, unknown>)
        : {};
    if (typeof settings.assigneeId === 'string') {
      const mapped = userIdMap.get(settings.assigneeId);
      if (mapped) settings.assigneeId = mapped;
      else {
        delete settings.assigneeId;
        report.skipped.userReferences += 1;
      }
    }
    if (Array.isArray(settings.stakeholderIds)) {
      settings.stakeholderIds = settings.stakeholderIds
        .map((id) => (typeof id === 'string' ? userIdMap.get(id) : null))
        .filter(Boolean);
      const missing =
        (value as any)?.stakeholderIds?.length -
        (settings.stakeholderIds as unknown[]).length;
      if (missing > 0) report.skipped.userReferences += missing;
    }
    delete settings.headingNumbering;
    return settings;
  }

  private rewritePmNode(
    node: any,
    context: {
      pageIdMap: Map<string, string>;
      slugIdMap: Map<string, string>;
      databaseIdMap: Map<string, string>;
      attachmentIdMap: Map<string, string>;
      externalSnapshotAttachmentIdMap?: Map<string, string>;
      sourceArchivePageId?: string;
      userIdMap: Map<string, string>;
      transclusionSnapshots: Map<string, ArchiveSnapshotValue>;
      pageEmbedSnapshots: Map<string, ArchiveSnapshotValue>;
      archivePageContentById?: Map<string, unknown>;
      materializingPageIds?: Set<string>;
      allowPageEmbeds?: boolean;
      fallbackUserId: string;
      report: ImportReport;
    },
  ): any {
    if (!node || typeof node !== 'object') return node;
    const attrs = node.attrs ? { ...node.attrs } : undefined;

    if (node.type === 'mention' && attrs?.entityType === 'page') {
      const mapped = context.pageIdMap.get(attrs.entityId);
      if (mapped) {
        attrs.entityId = mapped;
        if (typeof attrs.slugId === 'string') {
          attrs.slugId = context.slugIdMap.get(attrs.slugId) ?? attrs.slugId;
        }
        if (typeof attrs.creatorId === 'string') {
          attrs.creatorId =
            context.userIdMap.get(attrs.creatorId) ?? context.fallbackUserId;
        }
        attrs.id = uuid7();
      }
    }
    if (node.type === 'mention' && attrs?.entityType === 'user') {
      const mapped = context.userIdMap.get(attrs.entityId);
      if (!mapped) {
        context.report.skipped.userReferences += 1;
        return { type: 'text', text: attrs.label || 'Unknown user' };
      }
      attrs.entityId = mapped;
      attrs.creatorId =
        context.userIdMap.get(attrs.creatorId) ?? context.fallbackUserId;
      attrs.id = uuid7();
    }
    if (node.type === 'transclusionReference' && attrs?.sourcePageId) {
      const mapped = context.pageIdMap.get(attrs.sourcePageId);
      if (!mapped) {
        const snapshot =
          context.transclusionSnapshots.get(
            transclusionSnapshotKey(
              context.sourceArchivePageId,
              attrs.sourcePageId,
              attrs.transclusionId,
            ),
          ) ??
          context.transclusionSnapshots.get(
            transclusionSnapshotKey(
              undefined,
              attrs.sourcePageId,
              attrs.transclusionId,
            ),
          );
        if (snapshot) {
          const snapshotDoc = getProsemirrorContent(snapshot.content);
          return (snapshotDoc.content ?? []).flatMap((child: unknown) => {
            const rewritten = this.rewritePmNode(child, {
              ...context,
              attachmentIdMap:
                context.externalSnapshotAttachmentIdMap ??
                snapshot.attachmentIdMap,
            });
            return Array.isArray(rewritten) ? rewritten : [rewritten];
          });
        }
        context.report.skipped.pageReferences += 1;
        context.report.warnings.push(
          'A synced block referenced a page outside the archive and was replaced with a placeholder.',
        );
        return {
          type: 'paragraph',
          content: [
            { type: 'text', text: '[Synced block unavailable after import]' },
          ],
        };
      }
      attrs.sourcePageId = mapped;
    }
    if (node.type === 'pageEmbed' && attrs?.sourcePageId) {
      const referenceNodeId = attrs.id;
      const sourcePageId = attrs.sourcePageId;
      const mapped = context.pageIdMap.get(sourcePageId);
      const snapshot =
        typeof context.sourceArchivePageId === 'string' &&
        typeof referenceNodeId === 'string'
          ? context.pageEmbedSnapshots.get(
              pageEmbedSnapshotKey(
                context.sourceArchivePageId,
                referenceNodeId,
                sourcePageId,
              ),
            )
          : undefined;
      if (context.allowPageEmbeds === false) {
        const fallbackContent =
          context.archivePageContentById?.get(sourcePageId) ??
          snapshot?.content;
        const materializing = context.materializingPageIds ?? new Set<string>();
        if (fallbackContent && !materializing.has(sourcePageId)) {
          materializing.add(sourcePageId);
          try {
            const snapshotDoc = getProsemirrorContent(fallbackContent);
            return (snapshotDoc.content ?? []).flatMap((child: unknown) => {
              const rewritten = this.rewritePmNode(child, {
                ...context,
                sourceArchivePageId: sourcePageId,
                attachmentIdMap:
                  context.externalSnapshotAttachmentIdMap ??
                  snapshot?.attachmentIdMap ??
                  context.attachmentIdMap,
                materializingPageIds: materializing,
              });
              return Array.isArray(rewritten) ? rewritten : [rewritten];
            });
          } finally {
            materializing.delete(sourcePageId);
          }
        }
        context.report.skipped.pageReferences += 1;
        context.report.warnings.push(
          'A page embed could not remain live and was replaced with a placeholder.',
        );
        return {
          type: 'paragraph',
          content: [
            { type: 'text', text: '[Embedded page unavailable after import]' },
          ],
        };
      }
      attrs.id = uuid7();
      if (mapped) {
        attrs.sourcePageId = mapped;
      } else {
        if (snapshot) {
          const snapshotDoc = getProsemirrorContent(snapshot.content);
          return (snapshotDoc.content ?? []).flatMap((child: unknown) => {
            const rewritten = this.rewritePmNode(child, {
              ...context,
              attachmentIdMap:
                context.externalSnapshotAttachmentIdMap ??
                snapshot.attachmentIdMap,
            });
            return Array.isArray(rewritten) ? rewritten : [rewritten];
          });
        }
        context.report.skipped.pageReferences += 1;
        context.report.warnings.push(
          'A page embed referenced a page outside the archive and was replaced with a placeholder.',
        );
        return {
          type: 'paragraph',
          content: [
            { type: 'text', text: '[Embedded page unavailable after import]' },
          ],
        };
      }
    }
    if (typeof attrs?.databaseId === 'string') {
      const mapped = context.databaseIdMap.get(attrs.databaseId);
      if (mapped) attrs.databaseId = mapped;
    }
    if (attrs?.attachmentId) {
      const mapped = context.attachmentIdMap.get(attrs.attachmentId);
      if (mapped) {
        const oldId = attrs.attachmentId;
        attrs.attachmentId = mapped;
        for (const key of ['src', 'url']) {
          if (typeof attrs[key] === 'string') {
            attrs[key] = attrs[key].split(oldId).join(mapped);
          }
        }
      }
    }

    const marks = Array.isArray(node.marks)
      ? node.marks.map((mark) => {
          if (mark.type !== 'link' || typeof mark.attrs?.href !== 'string') {
            return mark;
          }
          let href = mark.attrs.href;
          for (const [oldSlug, newSlug] of context.slugIdMap) {
            if (href.includes(oldSlug))
              href = href.split(oldSlug).join(newSlug);
          }
          return { ...mark, attrs: { ...mark.attrs, href } };
        })
      : node.marks;
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(marks ? { marks } : {}),
      ...(Array.isArray(node.content)
        ? {
            content: node.content.flatMap((child) => {
              const rewritten = this.rewritePmNode(child, context);
              return Array.isArray(rewritten) ? rewritten : [rewritten];
            }),
          }
        : {}),
    };
  }

  private remapDatabaseUserReference(
    value: unknown,
    userIdMap: Map<string, string>,
    report: ImportReport,
  ): unknown {
    const sourceId = extractReferenceId(value, ['id', 'userId']);
    if (!sourceId) return value === null ? null : value;
    const mapped = userIdMap.get(sourceId);
    if (!mapped) {
      report.skipped.userReferences += 1;
      return null;
    }
    if (typeof value === 'string') return mapped;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const source = value as Record<string, unknown>;
      if (typeof source.id === 'string') {
        const { name: _sourceName, ...withoutSourceName } = source;
        return { ...withoutSourceName, id: mapped };
      }
      if (typeof source.userId === 'string') {
        return { ...source, userId: mapped };
      }
      if ('value' in source) {
        return {
          ...source,
          value: this.remapDatabaseUserReference(
            source.value,
            userIdMap,
            report,
          ),
        };
      }
    }
    return mapped;
  }

  private resolveArchivePath(root: string, relativePath: string): string {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(root, relativePath);
    if (
      resolved !== resolvedRoot &&
      !resolved.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new BadRequestException('Unsafe path in Docmost archive');
    }
    return resolved;
  }

  private normalizeVisibleAlias(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  private normalizeEmail(value: string): string {
    return value.normalize('NFKC').trim().toLowerCase();
  }

  private normalizeName(value: string): string {
    return this.normalizeVisibleAlias(value).toLocaleLowerCase();
  }
}
