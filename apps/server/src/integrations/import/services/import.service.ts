import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { MultipartFile } from '@fastify/multipart';
import { sanitize } from 'sanitize-filename-ts';
import * as path from 'path';
import {
  htmlToJson,
  jsonToText,
  strictJsonToNode,
  tiptapExtensions,
} from '../../../collaboration/collaboration.util';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  generateSlugId,
  sanitizeFileName,
  createByteCountingStream,
} from '../../../common/helpers';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';
import { markdownToHtml } from '@docmost/editor-ext/server';
import {
  createZipReadBudget,
  DEFAULT_EXTRACT_ZIP_LIMITS,
  FileImportSource,
  FileTaskStatus,
  FileTaskType,
  getFileTaskFolderPath,
  readZipEntryWithBudget,
  validateZipArchiveBuffer,
  ZipBudgetExceededError,
  type ZipReadBudget,
} from '../utils/file.utils';
import { v7 as uuid7 } from 'uuid';
import { StorageService } from '../../storage/storage.service';
import * as JSZip from 'jszip';
import { Readable } from 'node:stream';
import {
  type DocmostArchiveData,
  type DocmostArchiveManifest,
  type DocmostImportOptions,
  type ImportPreview,
} from '@docmost/api-contract';
import {
  containsPageEmbedNode,
  DOCMOST_ARCHIVE_ZIP_LIMITS,
  getDocmostArchiveSchemaError,
} from '../../docmost-archive.utils';
import { createHash } from 'node:crypto';
import { executeTx } from '@docmost/db/utils';
import { QueueOutboxService } from '../../queue/outbox/queue-outbox.service';

type ImportSettingsAvailability = ImportPreview['availableSettings'];
const FILE_UPLOAD_LEASE_MS = 2 * 60 * 1000;
const FILE_UPLOAD_LEASE_RENEW_MS = 30 * 1000;
const DOCMOST_ARCHIVE_MAX_ATTACHMENT_DESCRIPTORS =
  DOCMOST_ARCHIVE_ZIP_LIMITS.maxEntries;
const DOCMOST_ARCHIVE_MAX_LOGICAL_ATTACHMENT_BYTES =
  DOCMOST_ARCHIVE_ZIP_LIMITS.maxTotalUncompressedBytes;

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly pageRepo: PageRepo,
    private readonly storageService: StorageService,
    @InjectKysely() private readonly db: KyselyDB,
    @Optional() private readonly queueOutbox?: QueueOutboxService,
  ) {}

  async importPage(
    filePromise: Promise<MultipartFile>,
    userId: string,
    spaceId: string,
    workspaceId: string,
  ): Promise<void> {
    const file = await filePromise;
    const fileBuffer = await file.toBuffer();
    const fileExtension = path.extname(file.filename).toLowerCase();
    const fileName = sanitize(
      path.basename(file.filename, fileExtension).slice(0, 255),
    );
    const fileContent = fileBuffer.toString();

    let prosemirrorState = null;
    let createdPage = null;

    try {
      if (fileExtension.endsWith('.md')) {
        prosemirrorState = await this.processMarkdown(fileContent);
      } else if (fileExtension.endsWith('.html')) {
        prosemirrorState = await this.processHTML(fileContent);
      }
    } catch (err) {
      const message = 'Error processing file content';
      this.logger.error(message, err);
      throw new BadRequestException(message);
    }

    if (!prosemirrorState) {
      const message = 'Failed to create ProseMirror state';
      this.logger.error(message);
      throw new BadRequestException(message);
    }

    const { title, prosemirrorJson } =
      this.extractTitleAndRemoveHeading(prosemirrorState);

    const pageTitle = title || fileName;

    if (prosemirrorJson) {
      try {
        const pagePosition = await this.getNewPagePosition(spaceId);

        createdPage = await this.pageRepo.insertPage({
          slugId: generateSlugId(),
          title: pageTitle,
          content: prosemirrorJson,
          textContent: jsonToText(prosemirrorJson),
          ydoc: await this.createYdoc(prosemirrorJson),
          position: pagePosition,
          spaceId: spaceId,
          creatorId: userId,
          workspaceId: workspaceId,
          lastUpdatedById: userId,
        });

        this.logger.debug(
          `Successfully imported "${title}${fileExtension}. ID: ${createdPage.id} - SlugId: ${createdPage.slugId}"`,
        );
      } catch (err) {
        const message = 'Failed to create imported page';
        this.logger.error(message, err);
        throw new BadRequestException(message);
      }
    }

    return createdPage;
  }

  async processMarkdown(markdownInput: string): Promise<any> {
    try {
      const html = await markdownToHtml(markdownInput);
      return this.processHTML(html);
    } catch (err) {
      throw err;
    }
  }

  async processHTML(htmlInput: string): Promise<any> {
    try {
      return htmlToJson(htmlInput);
    } catch (err) {
      throw err;
    }
  }

  async createYdoc(prosemirrorJson: any): Promise<Buffer | null> {
    if (prosemirrorJson) {
      // this.logger.debug(`Converting prosemirror json state to ydoc`);

      const ydoc = TiptapTransformer.toYdoc(
        prosemirrorJson,
        'default',
        tiptapExtensions,
      );

      Y.encodeStateAsUpdate(ydoc);

      return Buffer.from(Y.encodeStateAsUpdate(ydoc));
    }
    return null;
  }

  extractTitleAndRemoveHeading(prosemirrorState: any) {
    let title: string | null = null;

    const content = prosemirrorState.content ?? [];

    if (
      content.length > 0 &&
      content[0].type === 'heading' &&
      content[0].attrs?.level === 1
    ) {
      title = content[0].content?.[0]?.text ?? null;
      content.shift();
    }

    // ensure at least one paragraph
    if (content.length === 0) {
      content.push({
        type: 'paragraph',
        content: [],
      });
    }

    return {
      title,
      prosemirrorJson: {
        ...prosemirrorState,
        content,
      },
    };
  }

  async getNewPagePosition(
    spaceId: string,
    parentPageId?: string,
  ): Promise<string> {
    let query = this.db
      .selectFrom('pages')
      .select(['id', 'position'])
      .where('spaceId', '=', spaceId)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .limit(1);

    if (parentPageId) {
      query = query.where('parentPageId', '=', parentPageId);
    } else {
      query = query.where('parentPageId', 'is', null);
    }

    const lastPage = await query.executeTakeFirst();

    if (lastPage) {
      return generateJitteredKeyBetween(lastPage.position, null);
    } else {
      return generateJitteredKeyBetween(null, null);
    }
  }

  async importZip(
    filePromise: Promise<MultipartFile>,
    source: string,
    userId: string,
    spaceId: string,
    workspaceId: string,
  ) {
    const file = await filePromise;
    const fileExtension = path.extname(file.filename).toLowerCase();
    const fileName = sanitizeFileName(
      path.basename(file.filename, fileExtension),
    );
    const fileNameWithExt = fileName + fileExtension;

    const fileTaskId = uuid7();
    const uploadLeaseToken = uuid7();
    const filePath = `${getFileTaskFolderPath(FileTaskType.Import, workspaceId)}/${fileTaskId}/${fileNameWithExt}`;

    if (!this.queueOutbox) {
      throw new Error('queue_outbox_unavailable');
    }

    let fileTask = await executeTx(this.db, async (trx) => {
      const uploading = await trx
        .insertInto('fileTasks')
        .values({
          id: fileTaskId,
          type: FileTaskType.Import,
          source: source,
          status: FileTaskStatus.Uploading,
          leaseToken: uploadLeaseToken,
          leaseExpiresAt: new Date(Date.now() + FILE_UPLOAD_LEASE_MS),
          fileName: fileNameWithExt,
          filePath: filePath,
          fileSize: null,
          fileExt: 'zip',
          creatorId: userId,
          spaceId: spaceId,
          workspaceId: workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('fileTaskImportArtifacts')
        .values({
          fileTaskId,
          artifactType: 'archive',
          attachmentId: null,
          pageId: null,
          sourcePath: fileNameWithExt,
          filePath,
          status: 'pending',
        })
        .execute();
      return uploading;
    });

    const { stream, getBytesRead } = createByteCountingStream(file.file);
    const uploadLease = this.startFileUploadLeaseRenewal(
      fileTaskId,
      uploadLeaseToken,
    );
    try {
      await this.storageService.upload(filePath, stream);
      await uploadLease.stop();
      if (uploadLease.isLost()) throw new Error('file_task_upload_lease_lost');
    } catch (error) {
      await uploadLease.stop();
      try {
        await this.failUploadingImportAndCompensate(
          fileTaskId,
          filePath,
          uploadLeaseToken,
        );
      } catch {
        // The durable task and archive locator remain available to a
        // reconciler even if either the state transition or cleanup fails.
      }
      throw error;
    }

    const fileSize = getBytesRead();
    fileTask = await executeTx(this.db, async (trx) => {
      const pending = await trx
        .updateTable('fileTasks')
        .set({
          status: FileTaskStatus.Pending,
          fileSize,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', fileTaskId)
        .where('status', '=', FileTaskStatus.Uploading)
        .where('leaseToken', '=', uploadLeaseToken)
        .returningAll()
        .executeTakeFirst();
      if (!pending) throw new Error('file_task_upload_state_changed');
      await trx
        .updateTable('fileTaskImportArtifacts')
        .set({ status: 'uploaded', updatedAt: new Date() })
        .where('fileTaskId', '=', fileTaskId)
        .where('artifactType', '=', 'archive')
        .execute();
      await this.queueOutbox!.enqueueFileImport(fileTaskId, trx);
      return pending;
    });
    this.queueOutbox.kick();

    return fileTask;
  }

  private startFileUploadLeaseRenewal(
    fileTaskId: string,
    leaseToken: string,
  ): { isLost: () => boolean; stop: () => Promise<void> } {
    let stopped = false;
    let lost = false;
    let timer: NodeJS.Timeout | undefined;
    let renewal = Promise.resolve();

    const schedule = () => {
      if (stopped || lost) return;
      timer = setTimeout(() => {
        renewal = this.db
          .updateTable('fileTasks')
          .set({
            leaseExpiresAt: new Date(Date.now() + FILE_UPLOAD_LEASE_MS),
            updatedAt: new Date(),
          })
          .where('id', '=', fileTaskId)
          .where('status', '=', FileTaskStatus.Uploading)
          .where('leaseToken', '=', leaseToken)
          .where('leaseExpiresAt', '>', new Date())
          .executeTakeFirst()
          .then((result) => {
            if (Number(result.numUpdatedRows) !== 1) {
              lost = true;
              return;
            }
            schedule();
          })
          .catch(() => {
            lost = true;
          });
      }, FILE_UPLOAD_LEASE_RENEW_MS);
      timer.unref();
    };

    schedule();
    return {
      isLost: () => lost,
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await renewal;
      },
    };
  }

  private async cleanupUploadedArchive(
    fileTaskId: string,
    filePath: string,
  ): Promise<void> {
    await this.storageService.delete(filePath);
    await this.db
      .updateTable('fileTaskImportArtifacts')
      .set({
        status: 'cleaned',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where('fileTaskId', '=', fileTaskId)
      .where('artifactType', '=', 'archive')
      .execute();
  }

  private async failUploadingImportAndCompensate(
    fileTaskId: string,
    filePath: string,
    uploadLeaseToken: string,
  ): Promise<void> {
    const failed = await this.db
      .updateTable('fileTasks')
      .set({
        status: FileTaskStatus.Failed,
        errorMessage: 'file_task_upload_failed',
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', fileTaskId)
      .where('status', '=', FileTaskStatus.Uploading)
      .where('leaseToken', '=', uploadLeaseToken)
      .executeTakeFirst();

    if (Number(failed.numUpdatedRows) !== 1) {
      const current = await this.db
        .selectFrom('fileTasks')
        .select('status')
        .where('id', '=', fileTaskId)
        .executeTakeFirst();
      if (current?.status !== FileTaskStatus.Failed) return;
    }

    // A stale-upload reconciler may have deleted the path and marked its
    // locator cleaned while the old storage request was still in flight. Mark
    // the locator compensatable again before deleting the possibly late object
    // so a failed delete remains visible to the periodic reconciler.
    await this.db
      .updateTable('fileTaskImportArtifacts')
      .set({
        status: 'uploaded',
        completedAt: null,
        updatedAt: new Date(),
      })
      .where('fileTaskId', '=', fileTaskId)
      .where('artifactType', '=', 'archive')
      .execute();
    await this.cleanupUploadedArchive(fileTaskId, filePath);
  }

  async previewDocmostZip(
    filePromise: Promise<MultipartFile>,
    userId: string,
    spaceId: string,
    workspaceId: string,
    settingPermissions: ImportSettingsAvailability,
  ): Promise<ImportPreview> {
    const file = await filePromise;
    const fileBuffer = await file.toBuffer();
    const preview = await this.inspectDocmostArchive(fileBuffer);
    const sourceSettings = preview.availableSettings;
    preview.availableSettings = {
      documentFields:
        sourceSettings.documentFields && settingPermissions.documentFields,
      dictionary: sourceSettings.dictionary && settingPermissions.dictionary,
      headingNumbering:
        sourceSettings.headingNumbering && settingPermissions.headingNumbering,
      tags: sourceSettings.tags && settingPermissions.tags,
    };
    if (
      (sourceSettings.documentFields && !settingPermissions.documentFields) ||
      (sourceSettings.headingNumbering &&
        !settingPermissions.headingNumbering) ||
      (sourceSettings.tags && !settingPermissions.tags)
    ) {
      preview.warnings.push(
        'Portable space settings are unavailable because you cannot manage the target space settings. Content can still be imported.',
      );
    }
    if (sourceSettings.dictionary && !settingPermissions.dictionary) {
      preview.warnings.push(
        'Dictionary terms are unavailable because only workspace administrators can import them. Content can still be imported.',
      );
    }
    const fileExtension = path.extname(file.filename).toLowerCase();
    const fileName = sanitizeFileName(
      path.basename(file.filename, fileExtension),
    );
    const fileNameWithExt = `${fileName}${fileExtension}`;
    const fileTaskId = uuid7();
    const uploadLeaseToken = uuid7();
    const filePath = `${getFileTaskFolderPath(
      FileTaskType.Import,
      workspaceId,
    )}/${fileTaskId}/${fileNameWithExt}`;
    const savedPreview = { ...preview, fileTaskId };

    await executeTx(this.db, async (trx) => {
      await trx
        .insertInto('fileTasks')
        .values({
          id: fileTaskId,
          type: FileTaskType.Import,
          source: FileImportSource.Docmost,
          status: FileTaskStatus.Uploading,
          leaseToken: uploadLeaseToken,
          leaseExpiresAt: new Date(Date.now() + FILE_UPLOAD_LEASE_MS),
          fileName: fileNameWithExt,
          filePath,
          fileSize: null,
          fileExt: 'zip',
          creatorId: userId,
          spaceId,
          workspaceId,
          result: { preview: savedPreview } as any,
        })
        .execute();
      await trx
        .insertInto('fileTaskImportArtifacts')
        .values({
          fileTaskId,
          artifactType: 'archive',
          attachmentId: null,
          pageId: null,
          sourcePath: fileNameWithExt,
          filePath,
          status: 'pending',
        })
        .execute();
    });

    const uploadLease = this.startFileUploadLeaseRenewal(
      fileTaskId,
      uploadLeaseToken,
    );
    try {
      await this.storageService.upload(filePath, Readable.from(fileBuffer));
      await uploadLease.stop();
      if (uploadLease.isLost()) throw new Error('file_task_upload_lease_lost');

      const pending = await executeTx(this.db, async (trx) => {
        const updated = await trx
          .updateTable('fileTasks')
          .set({
            status: FileTaskStatus.Pending,
            fileSize: fileBuffer.byteLength,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where('id', '=', fileTaskId)
          .where('status', '=', FileTaskStatus.Uploading)
          .where('leaseToken', '=', uploadLeaseToken)
          .executeTakeFirst();
        if (Number(updated.numUpdatedRows) !== 1) {
          throw new Error('file_task_upload_state_changed');
        }
        await trx
          .updateTable('fileTaskImportArtifacts')
          .set({ status: 'uploaded', updatedAt: new Date() })
          .where('fileTaskId', '=', fileTaskId)
          .where('artifactType', '=', 'archive')
          .execute();
        return updated;
      });
      if (!pending) throw new Error('file_task_upload_state_changed');
    } catch (error) {
      await uploadLease.stop();
      try {
        await this.failUploadingImportAndCompensate(
          fileTaskId,
          filePath,
          uploadLeaseToken,
        );
      } catch {
        // The failed/uploading task keeps the archive locator for recovery.
      }
      throw error;
    }

    return savedPreview;
  }

  async getPendingDocmostImportSpaceId(
    fileTaskId: string,
    userId: string,
    workspaceId: string,
  ): Promise<string> {
    const fileTask = await this.getPendingDocmostImportTask(
      fileTaskId,
      userId,
      workspaceId,
    );
    if (!fileTask.spaceId) {
      throw new BadRequestException('Docmost import task has no target space');
    }
    return fileTask.spaceId;
  }

  async confirmDocmostImport(
    fileTaskId: string,
    options: DocmostImportOptions,
    userId: string,
    workspaceId: string,
  ) {
    await this.getPendingDocmostImportTask(fileTaskId, userId, workspaceId);
    if (!this.queueOutbox) {
      throw new Error('queue_outbox_unavailable');
    }

    const updated = await executeTx(this.db, async (trx) => {
      const pending = await trx
        .updateTable('fileTasks')
        .set({
          status: FileTaskStatus.Pending,
          options: options as any,
          updatedAt: new Date(),
        })
        .where('id', '=', fileTaskId)
        .where('status', '=', FileTaskStatus.Pending)
        .where('options', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!pending) {
        throw new BadRequestException('Import task state changed');
      }
      await this.queueOutbox!.enqueueFileImport(fileTaskId, trx);
      return pending;
    });
    this.queueOutbox.kick();
    return updated;
  }

  private async getPendingDocmostImportTask(
    fileTaskId: string,
    userId: string,
    workspaceId: string,
  ) {
    const fileTask = await this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('id', '=', fileTaskId)
      .executeTakeFirst();
    if (!fileTask || fileTask.source !== FileImportSource.Docmost) {
      throw new NotFoundException('Docmost import task not found');
    }
    if (fileTask.creatorId !== userId || fileTask.workspaceId !== workspaceId) {
      throw new ForbiddenException();
    }
    if (fileTask.status !== FileTaskStatus.Pending) {
      throw new BadRequestException('Import task is not awaiting confirmation');
    }
    const result =
      fileTask.result &&
      typeof fileTask.result === 'object' &&
      !Array.isArray(fileTask.result)
        ? (fileTask.result as Record<string, unknown>)
        : null;
    const preview =
      result?.preview &&
      typeof result.preview === 'object' &&
      !Array.isArray(result.preview)
        ? (result.preview as Record<string, unknown>)
        : null;
    this.assertSupportedDocmostArchiveSchema(preview?.schemaVersion);
    return fileTask;
  }

  async cancelDocmostImport(
    fileTaskId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const cancelled = await this.db
      .updateTable('fileTasks')
      .set({
        status: FileTaskStatus.Failed,
        errorMessage: 'file_task_cancelled',
        updatedAt: new Date(),
      })
      .where('id', '=', fileTaskId)
      .where('source', '=', FileImportSource.Docmost)
      .where('creatorId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('status', '=', FileTaskStatus.Pending)
      .where('options', 'is', null)
      .returning(['id', 'filePath'])
      .executeTakeFirst();
    if (!cancelled) {
      const existing = await this.db
        .selectFrom('fileTasks')
        .select(['source', 'creatorId', 'workspaceId'])
        .where('id', '=', fileTaskId)
        .executeTakeFirst();
      if (!existing || existing.source !== FileImportSource.Docmost) {
        throw new NotFoundException('Docmost import task not found');
      }
      if (
        existing.creatorId !== userId ||
        existing.workspaceId !== workspaceId
      ) {
        throw new ForbiddenException();
      }
      throw new BadRequestException(
        'Only an unconfirmed pending import can be cancelled',
      );
    }

    try {
      await this.cleanupUploadedArchive(cancelled.id, cancelled.filePath);
    } catch {
      // Failed is terminal and the durable artifact locator remains for the
      // failed-import reconciler to retry cleanup.
      this.logger.warn({ event: 'docmost_import_cancel_cleanup_deferred' });
    }
  }

  /**
   * Decompresses one archive entry under a shared byte budget and maps a budget
   * violation onto a client error instead of letting it surface as a 500.
   */
  private async readArchiveEntry(
    entry: JSZip.JSZipObject,
    budget: ZipReadBudget,
  ): Promise<Buffer> {
    try {
      return await readZipEntryWithBudget(entry, budget);
    } catch (error) {
      if (error instanceof ZipBudgetExceededError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async inspectDocmostArchive(
    fileBuffer: Buffer,
  ): Promise<Omit<ImportPreview, 'fileTaskId'>> {
    try {
      await validateZipArchiveBuffer(fileBuffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Invalid or corrupted ZIP archive',
      );
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(fileBuffer, {
        checkCRC32: true,
        createFolders: false,
      });
    } catch {
      throw new BadRequestException('Invalid or corrupted ZIP archive');
    }

    // Every entry read below is metered against this budget. The declared sizes
    // checked further down are only an early rejection hint, because they are
    // written by whoever produced the archive.
    const readBudget = createZipReadBudget();
    const entries = Object.values(zip.files);
    const entriesByNormalizedPath = new Map<string, JSZip.JSZipObject>();
    if (entries.length > DEFAULT_EXTRACT_ZIP_LIMITS.maxEntries) {
      throw new BadRequestException(
        `ZIP entry count exceeds ${DEFAULT_EXTRACT_ZIP_LIMITS.maxEntries}`,
      );
    }
    let totalUncompressedBytes = 0;
    for (const entry of entries) {
      const originalName =
        typeof (entry as any).unsafeOriginalName === 'string'
          ? (entry as any).unsafeOriginalName
          : entry.name;
      const normalized = path.posix.normalize(originalName);
      if (
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        path.posix.isAbsolute(normalized)
      ) {
        throw new BadRequestException('Unsafe ZIP entry path');
      }
      if (!entry.dir) entriesByNormalizedPath.set(normalized, entry);
      if (
        normalized.split('/').filter(Boolean).length >
        DEFAULT_EXTRACT_ZIP_LIMITS.maxPathDepth
      ) {
        throw new BadRequestException('ZIP entry path is too deep');
      }
      // Advisory only: this value is attacker-controlled. Real enforcement
      // happens in `readArchiveEntry` while the entry is decompressed.
      const uncompressedBytes = Number(
        (entry as any)?._data?.uncompressedSize ?? 0,
      );
      if (
        uncompressedBytes > DEFAULT_EXTRACT_ZIP_LIMITS.maxEntryUncompressedBytes
      ) {
        throw new BadRequestException(
          `ZIP entry exceeds the uncompressed size limit: ${entry.name}`,
        );
      }
      totalUncompressedBytes += uncompressedBytes;
      if (
        totalUncompressedBytes >
        DEFAULT_EXTRACT_ZIP_LIMITS.maxTotalUncompressedBytes
      ) {
        throw new BadRequestException(
          'ZIP total uncompressed size exceeds the limit',
        );
      }
    }

    const metadataFile = zip.file('docmost-metadata.json');
    if (!metadataFile) {
      throw new BadRequestException('Docmost archive metadata is missing');
    }
    let manifest: DocmostArchiveManifest;
    try {
      manifest = JSON.parse(
        (await this.readArchiveEntry(metadataFile, readBudget)).toString(
          'utf8',
        ),
      ) as DocmostArchiveManifest;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid Docmost archive metadata JSON');
    }
    if (manifest.source !== 'docmost' || !manifest.schemaVersion) {
      throw new BadRequestException('Not a Docmost archive');
    }
    if (
      manifest.dataFile !== 'docmost-data.json' ||
      !['space', 'page', 'database'].includes(manifest.scope)
    ) {
      throw new BadRequestException('Invalid Docmost archive metadata');
    }
    this.assertSupportedDocmostArchiveSchema(manifest.schemaVersion);
    if (containsPageEmbedNode(manifest)) {
      throw new BadRequestException(
        'Docmost archive schema 5 cannot contain pageEmbed nodes',
      );
    }

    const dataFile = zip.file(manifest.dataFile);
    if (!dataFile) {
      throw new BadRequestException('Docmost archive data is missing');
    }
    let data: DocmostArchiveData;
    try {
      data = JSON.parse(
        (await this.readArchiveEntry(dataFile, readBudget)).toString('utf8'),
      ) as DocmostArchiveData;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid Docmost archive data JSON');
    }
    if (
      data.schemaVersion !== manifest.schemaVersion ||
      data.scope !== manifest.scope ||
      !data.sourceSpace ||
      !Array.isArray(data.pages) ||
      !Array.isArray(data.attachments) ||
      !Array.isArray(data.users) ||
      !Array.isArray(data.transclusionSnapshots) ||
      !Array.isArray(data.databases) ||
      !Array.isArray(data.databaseProperties) ||
      !Array.isArray(data.databaseRows) ||
      !Array.isArray(data.databaseCells) ||
      !Array.isArray(data.databaseViews) ||
      !Array.isArray(data.labels) ||
      !Array.isArray(data.dictionary)
    ) {
      throw new BadRequestException('Invalid Docmost archive data');
    }
    if (containsPageEmbedNode(data)) {
      throw new BadRequestException(
        'Docmost archive schema 5 cannot contain pageEmbed nodes',
      );
    }
    if (data.attachments.length > DOCMOST_ARCHIVE_MAX_ATTACHMENT_DESCRIPTORS) {
      throw new BadRequestException(
        `Docmost archive attachment descriptor count exceeds ${DOCMOST_ARCHIVE_MAX_ATTACHMENT_DESCRIPTORS}`,
      );
    }
    this.assertDocmostArchiveReferences(data);

    for (const page of data.pages) {
      try {
        strictJsonToNode(page.content);
      } catch (error) {
        throw new BadRequestException(
          `Page "${page.title || page.id}" contains an unsupported editor node`,
        );
      }
    }
    for (const database of data.databases) {
      if (!database.descriptionContent) continue;
      try {
        strictJsonToNode(database.descriptionContent);
      } catch {
        throw new BadRequestException(
          `Database "${database.name || database.id}" contains an unsupported editor node`,
        );
      }
    }
    for (const snapshot of data.transclusionSnapshots ?? []) {
      try {
        strictJsonToNode(snapshot.content);
      } catch {
        throw new BadRequestException(
          'A synced block snapshot contains an unsupported editor node',
        );
      }
    }
    const verifiedAttachmentEntries = new Map<
      string,
      { size: number; sha256: string }
    >();
    let logicalAttachmentBytes = 0;
    for (const attachment of data.attachments ?? []) {
      if (
        typeof attachment.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(attachment.sha256)
      ) {
        throw new BadRequestException(
          `Archive attachment has an invalid checksum: ${attachment.fileName}`,
        );
      }
      const normalizedArchivePath = path.posix.normalize(
        attachment.archivePath,
      );
      let verified = verifiedAttachmentEntries.get(normalizedArchivePath);
      if (!verified) {
        const attachmentFile = entriesByNormalizedPath.get(
          normalizedArchivePath,
        );
        if (!attachmentFile) {
          throw new BadRequestException(
            `Archive attachment is missing: ${attachment.fileName}`,
          );
        }
        const attachmentBuffer = await this.readArchiveEntry(
          attachmentFile,
          readBudget,
        );
        verified = {
          size: attachmentBuffer.byteLength,
          sha256: createHash('sha256').update(attachmentBuffer).digest('hex'),
        };
        verifiedAttachmentEntries.set(normalizedArchivePath, verified);
      }
      logicalAttachmentBytes += verified.size;
      if (
        logicalAttachmentBytes > DOCMOST_ARCHIVE_MAX_LOGICAL_ATTACHMENT_BYTES
      ) {
        throw new BadRequestException(
          'Docmost archive logical attachment size exceeds the limit',
        );
      }
      const declaredSize = this.parseArchiveAttachmentSize(
        attachment.fileSize,
        attachment.fileName,
      );
      if (declaredSize !== null && verified.size !== declaredSize) {
        throw new BadRequestException(
          `Archive attachment size does not match metadata: ${attachment.fileName}`,
        );
      }
      if (verified.sha256 !== attachment.sha256) {
        throw new BadRequestException(
          `Archive attachment checksum does not match metadata: ${attachment.fileName}`,
        );
      }
    }

    const settings = data.sourceSpace?.settings ?? {};
    return {
      schemaVersion: manifest.schemaVersion,
      scope: manifest.scope,
      displayName: manifest.displayName,
      counts: {
        pages: data.pages.length,
        databases: data.databases?.length ?? 0,
        rows: data.databaseRows?.length ?? 0,
        attachments: data.attachments?.length ?? 0,
        dictionaryTerms: data.dictionary?.length ?? 0,
        labels: data.labels?.length ?? 0,
      },
      availableSettings: {
        documentFields: Boolean(settings.documentFields),
        dictionary:
          Boolean(settings.dictionary) || (data.dictionary?.length ?? 0) > 0,
        headingNumbering: Boolean(settings.headingNumbering),
        tags: Boolean(settings.tags),
      },
      warnings: [],
    };
  }

  private parseArchiveAttachmentSize(
    value: string | number | null | undefined,
    fileName: string,
  ): number | null {
    if (value === null || value === undefined) return null;
    if (
      (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) ||
      (typeof value !== 'string' && typeof value !== 'number')
    ) {
      throw new BadRequestException(
        `Archive attachment has invalid size metadata: ${fileName}`,
      );
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `Archive attachment has invalid size metadata: ${fileName}`,
      );
    }
    return parsed;
  }

  private assertSupportedDocmostArchiveSchema(schemaVersion: unknown): void {
    const error = getDocmostArchiveSchemaError(schemaVersion);
    if (error) throw new BadRequestException(error);
  }

  private assertDocmostArchiveReferences(data: DocmostArchiveData): void {
    const uniqueIds = (
      values: Array<{ id: string }>,
      label: string,
    ): Set<string> => {
      const ids = new Set<string>();
      for (const value of values) {
        if (typeof value.id !== 'string' || !value.id || ids.has(value.id)) {
          throw new BadRequestException(
            `Docmost archive contains an invalid or duplicate ${label} id`,
          );
        }
        ids.add(value.id);
      }
      return ids;
    };

    const pageIds = uniqueIds(data.pages, 'page');
    const slugIds = new Set<string>();
    for (const page of data.pages) {
      if (
        typeof page.slugId !== 'string' ||
        !page.slugId ||
        slugIds.has(page.slugId)
      ) {
        throw new BadRequestException(
          'Docmost archive contains an invalid or duplicate page slug id',
        );
      }
      slugIds.add(page.slugId);
    }
    const databaseIds = uniqueIds(data.databases, 'database');
    const propertyIds = uniqueIds(data.databaseProperties, 'database property');
    const attachmentIds = uniqueIds(data.attachments, 'attachment');

    for (const database of data.databases) {
      if (database.pageId && !pageIds.has(database.pageId)) {
        throw new BadRequestException(
          `Database "${database.name}" references a page outside the archive`,
        );
      }
    }
    for (const property of data.databaseProperties) {
      if (!databaseIds.has(property.databaseId)) {
        throw new BadRequestException(
          `Database property "${property.name}" references an unknown database`,
        );
      }
    }
    for (const row of data.databaseRows) {
      if (!databaseIds.has(row.databaseId) || !pageIds.has(row.pageId)) {
        throw new BadRequestException(
          'A database row references an unknown database or page',
        );
      }
    }
    for (const cell of data.databaseCells) {
      if (
        !databaseIds.has(cell.databaseId) ||
        !pageIds.has(cell.pageId) ||
        !propertyIds.has(cell.propertyId) ||
        (cell.attachmentId && !attachmentIds.has(cell.attachmentId))
      ) {
        throw new BadRequestException(
          'A database cell references an unknown database, page or property',
        );
      }
    }
    for (const label of data.labels) {
      if (label.pageIds.some((pageId) => !pageIds.has(pageId))) {
        throw new BadRequestException(
          `Label "${label.name}" references a page outside the archive`,
        );
      }
    }
    for (const view of data.databaseViews) {
      if (!databaseIds.has(view.databaseId)) {
        throw new BadRequestException(
          `Database view "${view.name}" references an unknown database`,
        );
      }
    }
  }
}
