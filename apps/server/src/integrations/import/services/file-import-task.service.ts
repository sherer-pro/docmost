import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as path from 'path';
import { jsonToText } from '../../../collaboration/collaboration.util';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  extractZip,
  FileImportSource,
  FileTaskStatus,
} from '../utils/file.utils';
import { StorageService } from '../../storage/storage.service';
import * as tmp from 'tmp-promise';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { ImportService } from './import.service';
import { promises as fs } from 'fs';
import { generateSlugId } from '../../../common/helpers';
import { v7 } from 'uuid';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { FileTask, InsertablePage } from '@docmost/db/types/entity.types';
import {
  markdownToHtml,
  stripGeneratedHeadingNumbersFromJson,
} from '@docmost/editor-ext/server';
import { getProsemirrorContent } from '../../../common/helpers/prosemirror/utils';
import { formatImportHtml } from '../utils/import-formatter';
import {
  buildAttachmentCandidates,
  collectMarkdownAndHtmlFiles,
  encodeFilePath,
  readDocmostMetadata,
  stripNotionID,
} from '../utils/import.utils';
import { executeTx } from '@docmost/db/utils';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { ImportAttachmentService } from './import-attachment.service';
import { PageService } from '../../../core/page/services/page.service';
import { ImportPageNode } from '../dto/file-task-dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { DocmostArchiveImportService } from './docmost-archive-import.service';
import type { ImportReport } from '@docmost/api-contract';
import type { ExportMetadata } from '../../../common/helpers/types/export-metadata.types';
import type { FileImportOutboxHandler } from '../../queue/outbox/queue-outbox.types';
import { sql } from 'kysely';

const IMPORT_LEASE_MS = 5 * 60 * 1000;
const IMPORT_LEASE_RENEW_MS = 30 * 1000;
const IMPORT_MAX_ATTEMPTS = 3;
const STALE_UPLOAD_MS = 15 * 60 * 1000;
const DOCMOST_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const DOCMOST_PREVIEW_EXPIRY_BATCH_SIZE = 25;

@Injectable()
export class FileImportTaskService implements FileImportOutboxHandler {
  private readonly logger = new Logger(FileImportTaskService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly importService: ImportService,
    private readonly pageService: PageService,
    private readonly backlinkRepo: BacklinkRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly importAttachmentService: ImportAttachmentService,
    private eventEmitter: EventEmitter2,
    private readonly docmostArchiveImportService: DocmostArchiveImportService,
  ) {}

  async processImportFromOutbox(fileTaskId: string): Promise<void> {
    const existing = await this.getFileTask(fileTaskId);
    if (!existing) {
      // A missing task also means its cascading artifact locator is gone. Do
      // not acknowledge the durable intent as cleanup-safe; retain the failed
      // outbox entry for operator recovery.
      throw new Error('file_import_task_missing');
    }
    if (existing.status === FileTaskStatus.Success) {
      await this.cleanupStoredImportArchive(existing.id, existing.filePath);
      return;
    }
    if (existing.status === FileTaskStatus.Failed) {
      await this.cleanupOrphanImportArtifacts(fileTaskId);
      return;
    }

    const leaseToken = v7();
    const claimed = await this.claimImportTask(fileTaskId, leaseToken);
    if (!claimed) throw new Error('file_import_claim_unavailable');
    const lease = this.startImportLeaseRenewal(fileTaskId, leaseToken);

    try {
      await this.processZIpImport(fileTaskId, leaseToken);
      await lease.stop();
      if (lease.isLost()) throw new Error('file_import_lease_lost');
      await this.cleanupStoredImportArchive(claimed.id, claimed.filePath);
    } catch (error) {
      await lease.stop();
      if (lease.isLost()) throw error;

      const current = await this.getFileTask(fileTaskId);
      if (current?.status === FileTaskStatus.Success) throw error;

      if (claimed.attemptCount >= IMPORT_MAX_ATTEMPTS) {
        const failed = await this.db
          .updateTable('fileTasks')
          .set({
            status: FileTaskStatus.Failed,
            errorMessage: 'file_task_processing_failed',
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where('id', '=', fileTaskId)
          .where('status', '=', FileTaskStatus.Processing)
          .where('leaseToken', '=', leaseToken)
          .executeTakeFirst();
        if (Number(failed.numUpdatedRows) !== 1) throw error;

        try {
          await this.cleanupOrphanImportArtifacts(fileTaskId);
        } catch {
          // Failed is persisted first. The periodic failed-artifact
          // reconciler owns any storage compensation that could not finish.
          this.logger.warn({ event: 'file_import_terminal_cleanup_deferred' });
        }
        return;
      }

      await this.db
        .updateTable('fileTasks')
        .set({
          status: FileTaskStatus.Pending,
          leaseToken: null,
          leaseExpiresAt: null,
          errorMessage: 'file_task_processing_retry',
          updatedAt: new Date(),
        })
        .where('id', '=', fileTaskId)
        .where('status', '=', FileTaskStatus.Processing)
        .where('leaseToken', '=', leaseToken)
        .execute();
      throw error;
    }
  }

  async processZIpImport(fileTaskId: string, leaseToken: string): Promise<void> {
    const fileTask = await this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('id', '=', fileTaskId)
      .executeTakeFirst();

    if (!fileTask) {
      this.logger.log(`Import file task with ID ${fileTaskId} not found`);
      return;
    }

    if (fileTask.status === FileTaskStatus.Failed) {
      return;
    }

    if (fileTask.status === FileTaskStatus.Success) {
      this.logger.log('Imported task already processed.');
      return;
    }

    const { path: tmpZipPath, cleanup: cleanupTmpFile } = await tmp.file({
      prefix: 'docmost-import',
      postfix: '.zip',
      discardDescriptor: true,
    });

    const { path: tmpExtractDir, cleanup: cleanupTmpDir } = await tmp.dir({
      prefix: 'docmost-extract-',
      unsafeCleanup: true,
    });

    try {
      const fileStream = await this.storageService.readStream(
        fileTask.filePath,
      );
      await pipeline(fileStream, createWriteStream(tmpZipPath));
      await extractZip(tmpZipPath, tmpExtractDir);
    } catch (err) {
      await cleanupTmpFile();
      await cleanupTmpDir();

      throw err;
    }

    try {
      let importReport: ImportReport | undefined;
      if (fileTask.source === FileImportSource.Docmost) {
        importReport = await this.docmostArchiveImportService.process({
          extractDir: tmpExtractDir,
          fileTask,
          leaseToken,
        });
      } else if (
        fileTask.source === FileImportSource.Generic ||
        fileTask.source === FileImportSource.Notion
      ) {
        importReport = await this.processGenericImport({
          extractDir: tmpExtractDir,
          fileTask,
          leaseToken,
        });
      } else {
        throw new BadRequestException('Unsupported import source');
      }
      try {
        await cleanupTmpFile();
        await cleanupTmpDir();
      } catch (err) {
        this.logger.error(
          `Failed to clean temporary import files. Task ID: ${fileTaskId}`,
          err,
        );
      }
    } catch (err) {
      await cleanupTmpFile();
      await cleanupTmpDir();

      throw err;
    }
  }

  async processGenericImport(opts: {
    extractDir: string;
    fileTask: FileTask;
    leaseToken?: string;
  }): Promise<ImportReport | undefined> {
    const { extractDir, fileTask, leaseToken } = opts;
    const allFiles = await collectMarkdownAndHtmlFiles(extractDir);
    const attachmentCandidates = await buildAttachmentCandidates(extractDir);
    const docmostMetadata = await readDocmostMetadata(extractDir);

    const pagesMap = new Map<string, ImportPageNode>();

    for (const absPath of allFiles) {
      const relPath = path
        .relative(extractDir, absPath)
        .split(path.sep)
        .join('/'); // normalize to forward-slashes
      const ext = path.extname(relPath).toLowerCase();

      const encodedPath = encodeFilePath(relPath);
      const pageMetadata = docmostMetadata?.pages[encodedPath];

      pagesMap.set(relPath, {
        id: v7(),
        slugId: generateSlugId(),
        name: stripNotionID(path.basename(relPath, ext)),
        content: '',
        parentPageId: null,
        fileExtension: ext,
        filePath: relPath,
        icon: pageMetadata?.icon ?? null,
      });
    }

    // Create placeholder pages for folders without corresponding files
    const foldersWithContent = new Set<string>();

    pagesMap.forEach((page) => {
      const segments = page.filePath.split('/');
      segments.pop(); // remove filename

      // Build up all folder paths and mark them as having content
      let currentPath = '';
      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        foldersWithContent.add(currentPath); // All ancestor folders have content
      }
    });

    // Determine if there's a single root container folder
    const rootLevelItems = new Set<string>();
    pagesMap.forEach((page) => {
      const firstSegment = page.filePath.split('/')[0];
      rootLevelItems.add(firstSegment);
    });

    // If all files are in a single root folder and no files at root level exist
    let skipRootFolder: string | null = null;
    if (rootLevelItems.size === 1) {
      const onlyRootItem = Array.from(rootLevelItems)[0];
      // Check if this is a folder (not a file at root)
      const hasRootFiles = Array.from(pagesMap.keys()).some(
        (filePath) => !filePath.includes('/'),
      );
      if (!hasRootFiles) {
        skipRootFolder = onlyRootItem;
      }
    }

    // For each folder with content, create a placeholder page if no corresponding .md or .html exists
    foldersWithContent.forEach((folderPath) => {
      if (
        skipRootFolder &&
        folderPath?.toLowerCase() === skipRootFolder?.toLowerCase()
      ) {
        return;
      }

      const mdPath = `${folderPath}.md`;
      const htmlPath = `${folderPath}.html`;

      if (!pagesMap.has(mdPath) && !pagesMap.has(htmlPath)) {
        const folderName = path.basename(folderPath);
        const encodedMdPath = encodeFilePath(mdPath);
        const placeholderMetadata = docmostMetadata?.pages[encodedMdPath];
        pagesMap.set(mdPath, {
          id: v7(),
          slugId: generateSlugId(),
          name: stripNotionID(folderName),
          content: '',
          parentPageId: null,
          fileExtension: '.md',
          filePath: mdPath,
          icon: placeholderMetadata?.icon ?? null,
        });
      }
    });

    const pageMappings = await this.ensureImportPageMappings(
      fileTask.id,
      Array.from(pagesMap.keys()),
    );
    pagesMap.forEach((page, filePath) => {
      const mapping = pageMappings.get(filePath);
      if (!mapping) throw new Error('file_import_page_mapping_missing');
      page.id = mapping.pageId;
      page.slugId = mapping.slugId;
    });

    // parent/child linking
    pagesMap.forEach((page, filePath) => {
      const segments = filePath.split('/');
      segments.pop();
      let parentPage = null;
      while (segments.length) {
        const tryMd = segments.join('/') + '.md';
        const tryHtml = segments.join('/') + '.html';
        if (pagesMap.has(tryMd)) {
          parentPage = pagesMap.get(tryMd)!;
          break;
        }
        if (pagesMap.has(tryHtml)) {
          parentPage = pagesMap.get(tryHtml)!;
          break;
        }
        segments.pop();
      }
      if (parentPage) page.parentPageId = parentPage.id;
    });

    // generate position keys
    const siblingsMap = new Map<string | null, ImportPageNode[]>();

    pagesMap.forEach((page) => {
      const group = siblingsMap.get(page.parentPageId) ?? [];
      group.push(page);
      siblingsMap.set(page.parentPageId, group);
    });

    const encodedPathsMap = new Map<string, string>();
    if (docmostMetadata) {
      pagesMap.forEach((_, filePath) => {
        encodedPathsMap.set(filePath, encodeFilePath(filePath));
      });
    }

    // Sort siblings by metadata position if available, otherwise alphabetically
    const sortSiblings = (siblings: ImportPageNode[]) => {
      if (docmostMetadata) {
        siblings.sort((a, b) => {
          const posA =
            docmostMetadata.pages[encodedPathsMap.get(a.filePath)]?.position;
          const posB =
            docmostMetadata.pages[encodedPathsMap.get(b.filePath)]?.position;
          if (posA && posB) {
            // Use direct comparison to match PostgreSQL collation 'C' (byte order)
            if (posA < posB) return -1;
            if (posA > posB) return 1;
            return 0;
          }
          return a.name.localeCompare(b.name);
        });
      } else {
        siblings.sort((a, b) => a.name.localeCompare(b.name));
      }
    };

    // get root pages
    const rootSibs = siblingsMap.get(null);

    if (rootSibs?.length) {
      sortSiblings(rootSibs);

      // get first position key from the server
      const nextPosition = await this.pageService.nextPagePosition(
        fileTask.spaceId,
      );

      let prevPos: string | null = null;
      rootSibs.forEach((page, idx) => {
        if (idx === 0) {
          page.position = nextPosition;
        } else {
          page.position = generateJitteredKeyBetween(prevPos, null);
        }
        prevPos = page.position;
      });
    }

    // non-root buckets (children & deeper levels)
    siblingsMap.forEach((sibs, parentId) => {
      if (parentId === null) return; // root already done

      sortSiblings(sibs);

      let prevPos: string | null = null;
      for (const page of sibs) {
        page.position = generateJitteredKeyBetween(prevPos, null);
        prevPos = page.position;
      }
    });

    // internal page links
    const filePathToPageMetaMap = new Map<
      string,
      { id: string; title: string; slugId: string }
    >();
    pagesMap.forEach((page) => {
      filePathToPageMetaMap.set(page.filePath, {
        id: page.id,
        title: page.name,
        slugId: page.slugId,
      });
    });

    // Group pages by level (topological sort for parent-child relationships)
    const pagesByLevel = new Map<number, Array<[string, ImportPageNode]>>();
    const pageLevel = new Map<string, number>();

    // Calculate levels using BFS
    const calculateLevels = () => {
      const queue: Array<{ filePath: string; level: number }> = [];

      // Start with root pages (no parent)
      for (const [filePath, page] of pagesMap.entries()) {
        if (!page.parentPageId) {
          queue.push({ filePath, level: 0 });
          pageLevel.set(filePath, 0);
        }
      }

      // BFS to assign levels
      while (queue.length > 0) {
        const { filePath, level } = queue.shift()!;
        const currentPage = pagesMap.get(filePath)!;

        // Find children of current page
        for (const [childFilePath, childPage] of pagesMap.entries()) {
          if (
            childPage.parentPageId === currentPage.id &&
            !pageLevel.has(childFilePath)
          ) {
            pageLevel.set(childFilePath, level + 1);
            queue.push({ filePath: childFilePath, level: level + 1 });
          }
        }
      }

      // Group pages by level
      for (const [filePath, page] of pagesMap.entries()) {
        const level = pageLevel.get(filePath) || 0;
        if (!pagesByLevel.has(level)) {
          pagesByLevel.set(level, []);
        }
        pagesByLevel.get(level)!.push([filePath, page]);
      }
    };

    calculateLevels();

    // Process pages level by level sequentially to respect foreign key constraints
    const allBacklinks: any[] = [];
    const validPageIds = new Set<string>();
    const ambiguousNumberingPages: string[] = [];
    let totalPagesProcessed = 0;

    // Sort levels to process in order
    const sortedLevels = Array.from(pagesByLevel.keys()).sort((a, b) => a - b);

    let importReport: ImportReport | undefined;
    try {
      await executeTx(this.db, async (trx) => {
        // Process pages level by level sequentially within the transaction
        for (const level of sortedLevels) {
          const levelPages = pagesByLevel.get(level)!;

          for (const [filePath, page] of levelPages) {
            const absPath = path.join(extractDir, filePath);
            let content = '';

            // Check if file exists (placeholder pages won't have physical files)
            try {
              await fs.access(absPath);
              content = await fs.readFile(absPath, 'utf-8');

              if (page.fileExtension.toLowerCase() === '.md') {
                content = await markdownToHtml(content);
              }
            } catch (err: any) {
              if (err?.code === 'ENOENT') {
                // Use empty content, title will be the folder name
                content = '';
              } else {
                throw err;
              }
            }

            const htmlContent =
              await this.importAttachmentService.processAttachments({
                html: content,
                pageRelativePath: page.filePath,
                extractDir,
                pageId: page.id,
                fileTask,
                attachmentCandidates,
                trx,
              });

            const { html, backlinks, pageIcon } = await formatImportHtml({
              html: htmlContent,
              currentFilePath: page.filePath,
              filePathToPageMetaMap: filePathToPageMetaMap,
              creatorId: fileTask.creatorId,
              sourcePageId: page.id,
              workspaceId: fileTask.workspaceId,
            });

            const pmState = getProsemirrorContent(
              await this.importService.processHTML(html),
            );

            const { title, prosemirrorJson: extractedJson } =
              this.importService.extractTitleAndRemoveHeading(pmState);
            const importMetadata =
              docmostMetadata?.pages[encodeFilePath(page.filePath)];
            const cleanupNumbering =
              Boolean(importMetadata?.headingNumbersMaterialized) ||
              Boolean(
                docmostMetadata &&
                  !(
                    docmostMetadata as ExportMetadata & {
                      schemaVersion?: number;
                    }
                  ).schemaVersion,
              );
            const cleanedHeadingResult = cleanupNumbering
              ? stripGeneratedHeadingNumbersFromJson(extractedJson, {
                  allowSingleHeading: Boolean(
                    importMetadata?.headingNumbersMaterialized,
                  ),
                })
              : { content: extractedJson, stripped: false };
            const prosemirrorJson = cleanedHeadingResult.content;
            if (
              cleanupNumbering &&
              !cleanedHeadingResult.stripped &&
              this.hasNumberedHeadingCandidate(extractedJson)
            ) {
              ambiguousNumberingPages.push(title || page.name);
            }

            const insertablePage: InsertablePage = {
              id: page.id,
              slugId: page.slugId,
              title: title || page.name,
              icon: page.icon || pageIcon || null,
              content: prosemirrorJson,
              textContent: jsonToText(prosemirrorJson),
              ydoc: await this.importService.createYdoc(prosemirrorJson),
              position: page.position!,
              spaceId: fileTask.spaceId,
              workspaceId: fileTask.workspaceId,
              creatorId: fileTask.creatorId,
              lastUpdatedById: fileTask.creatorId,
              parentPageId: page.parentPageId,
            };

            await trx.insertInto('pages').values(insertablePage).execute();

            // Track valid page IDs and collect backlinks
            validPageIds.add(insertablePage.id);
            allBacklinks.push(...backlinks);
            totalPagesProcessed++;

            // Log progress periodically
            if (totalPagesProcessed % 50 === 0) {
              this.logger.debug(`Processed ${totalPagesProcessed} pages...`);
            }
          }
        }

        const filteredBacklinks = allBacklinks.filter(
          ({ sourcePageId, targetPageId }) =>
            validPageIds.has(sourcePageId) && validPageIds.has(targetPageId),
        );

        // Insert backlinks in batches
        if (filteredBacklinks.length > 0) {
          const BACKLINK_BATCH_SIZE = 100;
          for (
            let i = 0;
            i < filteredBacklinks.length;
            i += BACKLINK_BATCH_SIZE
          ) {
            const backlinkChunk = filteredBacklinks.slice(
              i,
              Math.min(i + BACKLINK_BATCH_SIZE, filteredBacklinks.length),
            );
            await this.backlinkRepo.insertBacklink(backlinkChunk, trx);
          }
        }

        this.logger.log(
          `Successfully imported ${totalPagesProcessed} pages with ${filteredBacklinks.length} backlinks`,
        );

        if (docmostMetadata) {
          const warnings =
            ambiguousNumberingPages.length > 0
              ? [
                  `Heading numbering was left unchanged on ${ambiguousNumberingPages.length} page(s) because it could not be safely identified as Docmost-generated.`,
                ]
              : [];
          importReport = {
            created: {
              pages: totalPagesProcessed,
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
            warnings,
          };
        }

        await trx
          .updateTable('fileTaskImportPages')
          .set({ status: 'completed', updatedAt: new Date() })
          .where('fileTaskId', '=', fileTask.id)
          .execute();
        let finalize = trx
          .updateTable('fileTasks')
          .set({
            status: FileTaskStatus.Success,
            errorMessage: null,
            result: importReport
              ? ({
                  ...((fileTask.result as Record<string, unknown> | null) ?? {}),
                  report: importReport,
                } as any)
              : fileTask.result,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where('id', '=', fileTask.id)
          .where('status', '=', FileTaskStatus.Processing);
        if (leaseToken) finalize = finalize.where('leaseToken', '=', leaseToken);
        const finalized = await finalize.executeTakeFirst();
        if (Number(finalized.numUpdatedRows) !== 1) {
          throw new Error('file_import_lease_lost');
        }
      });
      if (validPageIds.size > 0) {
        this.eventEmitter.emit(EventName.PAGE_CREATED, {
          pageIds: Array.from(validPageIds),
          workspaceId: fileTask.workspaceId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to import files:', error);
      throw new Error(`File import failed: ${error?.['message']}`);
    }

    return importReport;
  }

  private hasNumberedHeadingCandidate(content: unknown): boolean {
    const getText = (node: any): string => {
      if (!node || typeof node !== 'object') return '';
      if (typeof node.text === 'string') return node.text;
      return Array.isArray(node.content)
        ? node.content.map(getText).join('')
        : '';
    };
    const visit = (node: any): boolean => {
      if (!node || typeof node !== 'object') return false;
      if (
        node.type === 'heading' &&
        Number(node.attrs?.level) >= 1 &&
        Number(node.attrs?.level) <= 3 &&
        /^\d+(?:\.\d+){0,2}\.?\s+/.test(getText(node))
      ) {
        return true;
      }
      return Array.isArray(node.content) && node.content.some(visit);
    };
    return visit(content);
  }

  private async ensureImportPageMappings(
    fileTaskId: string,
    sourcePaths: string[],
  ): Promise<Map<string, { pageId: string; slugId: string }>> {
    const uniquePaths = [...new Set(sourcePaths)].sort();
    if (uniquePaths.length > 0) {
      await this.db
        .insertInto('fileTaskImportPages')
        .values(
          uniquePaths.map((sourcePath) => ({
            fileTaskId,
            sourcePath,
            pageId: v7(),
            slugId: generateSlugId(),
            status: 'pending',
          })),
        )
        .onConflict((oc) =>
          oc.columns(['fileTaskId', 'sourcePath']).doNothing(),
        )
        .execute();
    }

    const rows = await this.db
      .selectFrom('fileTaskImportPages')
      .select(['sourcePath', 'pageId', 'slugId'])
      .where('fileTaskId', '=', fileTaskId)
      .execute();
    const mappings = new Map(
      rows.map((row) => [
        row.sourcePath,
        { pageId: row.pageId, slugId: row.slugId },
      ]),
    );
    if (uniquePaths.some((sourcePath) => !mappings.has(sourcePath))) {
      throw new Error('file_import_page_mapping_incomplete');
    }
    return mappings;
  }

  private async claimImportTask(fileTaskId: string, leaseToken: string) {
    return this.db
      .updateTable('fileTasks')
      .set({
        status: FileTaskStatus.Processing,
        attemptCount: sql`attempt_count + 1`,
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + IMPORT_LEASE_MS),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where('id', '=', fileTaskId)
      .where('type', '=', 'import')
      .where((eb) =>
        eb.or([
          eb('status', '=', FileTaskStatus.Pending),
          eb.and([
            eb('status', '=', FileTaskStatus.Processing),
            eb('leaseExpiresAt', '<=', new Date()),
          ]),
        ]),
      )
      .returningAll()
      .executeTakeFirst();
  }

  private startImportLeaseRenewal(
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
        renewal = (async () => {
          const renewed = await this.db
            .updateTable('fileTasks')
            .set({
              leaseExpiresAt: new Date(Date.now() + IMPORT_LEASE_MS),
              updatedAt: new Date(),
            })
            .where('id', '=', fileTaskId)
            .where('status', '=', FileTaskStatus.Processing)
            .where('leaseToken', '=', leaseToken)
            .where('leaseExpiresAt', '>', new Date())
            .executeTakeFirst();
          if (Number(renewed.numUpdatedRows) !== 1) {
            const terminal = await this.db
              .selectFrom('fileTasks')
              .select('status')
              .where('id', '=', fileTaskId)
              .executeTakeFirst();
            if (terminal?.status === FileTaskStatus.Success) {
              stopped = true;
              return;
            }
            lost = true;
            return;
          }
          schedule();
        })().catch(() => {
          lost = true;
        });
      }, IMPORT_LEASE_RENEW_MS);
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

  private async cleanupOrphanImportArtifacts(
    fileTaskId: string,
  ): Promise<void> {
    const artifacts = await this.db
      .selectFrom('fileTaskImportArtifacts')
      .select(['id', 'attachmentId', 'filePath'])
      .where('fileTaskId', '=', fileTaskId)
      .where('status', '!=', 'cleaned')
      .orderBy('id')
      .execute();

    for (const artifact of artifacts) {
      const attachment = artifact.attachmentId
        ? await this.db
            .selectFrom('attachments')
            .select('id')
            .where('id', '=', artifact.attachmentId)
            .executeTakeFirst()
        : undefined;
      if (attachment) continue;
      await this.storageService.delete(artifact.filePath);
      await this.db
        .updateTable('fileTaskImportArtifacts')
        .set({
          status: 'cleaned',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', artifact.id)
        .execute();
    }
  }

  private async cleanupStoredImportArchive(
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

  @Interval('file-import-upload-reconciler', 60 * 1000)
  async reconcileStaleUploads(): Promise<void> {
    const stale = await this.claimStaleUploads(
      new Date(Date.now() - STALE_UPLOAD_MS),
    );

    for (const task of stale) {
      try {
        await this.cleanupOrphanImportArtifacts(task.id);
      } catch {
        this.logger.warn({ event: 'file_import_upload_cleanup_failed' });
      }
    }
  }

  private async claimStaleUploads(cutoff: Date) {
    const result = await sql<{ id: string; filePath: string }>`
      with stale as (
        select id
        from file_tasks
        where type = 'import'
          and status = ${FileTaskStatus.Uploading}
          and (lease_expires_at is null or lease_expires_at <= now())
          and updated_at < ${cutoff}
        order by updated_at, id
        limit 25
        for update skip locked
      )
      update file_tasks as task
      set
        status = ${FileTaskStatus.Failed},
        error_message = 'file_task_upload_abandoned',
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
      from stale
      where task.id = stale.id
        and task.status = ${FileTaskStatus.Uploading}
      returning task.id, task.file_path as "filePath"
    `.execute(this.db);
    return result.rows;
  }

  @Interval('docmost-import-preview-expirer', 5 * 60 * 1000)
  async expireStaleDocmostPreviews(): Promise<void> {
    const expired = await this.claimStaleDocmostPreviews(
      new Date(Date.now() - DOCMOST_PREVIEW_TTL_MS),
    );

    for (const task of expired) {
      try {
        await this.cleanupOrphanImportArtifacts(task.id);
      } catch {
        // The task is already terminal. Its artifact locator remains visible
        // to reconcileFailedImportArtifacts for a later storage retry.
        this.logger.warn({ event: 'docmost_preview_expiry_cleanup_deferred' });
      }
    }
  }

  private async claimStaleDocmostPreviews(cutoff: Date) {
    const result = await sql<{ id: string; filePath: string }>`
      with stale as (
        select id
        from file_tasks
        where type = 'import'
          and source = ${FileImportSource.Docmost}
          and status = ${FileTaskStatus.Pending}
          and options is null
          and updated_at < ${cutoff}
        order by updated_at, id
        limit ${DOCMOST_PREVIEW_EXPIRY_BATCH_SIZE}
        for update skip locked
      )
      update file_tasks as task
      set
        status = ${FileTaskStatus.Failed},
        error_message = 'file_task_preview_expired',
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
      from stale
      where task.id = stale.id
        and task.type = 'import'
        and task.source = ${FileImportSource.Docmost}
        and task.status = ${FileTaskStatus.Pending}
        and task.options is null
        and task.updated_at < ${cutoff}
      returning task.id, task.file_path as "filePath"
    `.execute(this.db);
    return result.rows;
  }

  @Interval('file-import-artifact-reconciler', 5 * 60 * 1000)
  async reconcileFailedImportArtifacts(): Promise<void> {
    const tasks = await this.db
      .selectFrom('fileTaskImportArtifacts as artifact')
      .innerJoin('fileTasks as task', 'task.id', 'artifact.fileTaskId')
      .select('artifact.fileTaskId')
      .distinct()
      .where('task.status', '=', FileTaskStatus.Failed)
      .where((eb) =>
        eb.or([
          eb.and([
            eb('artifact.artifactType', '=', 'archive'),
            eb('artifact.status', '!=', 'cleaned'),
          ]),
          eb.and([
            eb('artifact.artifactType', '=', 'attachment'),
            eb('artifact.status', 'in', ['pending', 'uploaded']),
          ]),
        ]),
      )
      .orderBy('artifact.fileTaskId')
      .limit(25)
      .execute();

    for (const task of tasks) {
      try {
        await this.cleanupOrphanImportArtifacts(task.fileTaskId);
      } catch {
        this.logger.warn({ event: 'file_import_artifact_cleanup_failed' });
      }
    }
  }

  async getFileTask(fileTaskId: string) {
    return this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('id', '=', fileTaskId)
      .executeTakeFirst();
  }

  async updateTaskStatus(
    fileTaskId: string,
    status: FileTaskStatus,
    errorMessage?: string,
    report?: ImportReport,
  ) {
    const fileTask = report
      ? await this.db
          .selectFrom('fileTasks')
          .select('result')
          .where('id', '=', fileTaskId)
          .executeTakeFirst()
      : null;
    const previousResult =
      fileTask?.result &&
      typeof fileTask.result === 'object' &&
      !Array.isArray(fileTask.result)
        ? fileTask.result
        : {};
    await this.db
      .updateTable('fileTasks')
      .set({
        status: status,
        errorMessage,
        updatedAt: new Date(),
        ...(report ? { result: { ...previousResult, report } as any } : {}),
      })
      .where('id', '=', fileTaskId)
      .execute();
  }
}
