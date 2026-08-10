import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  Optional,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { v5 as uuid5 } from 'uuid';
import { KyselyTransaction } from '@docmost/db/types/kysely.types';
import { PageTransclusionsRepo } from '@docmost/db/repos/page-transclusions/page-transclusions.repo';
import { PageTransclusionReferencesRepo } from '@docmost/db/repos/page-transclusions/page-transclusion-references.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import {
  collectReferencesFromPmJson,
  collectTransclusionsFromPmJson,
} from './utils/transclusion-prosemirror.util';
import { rewriteAttachmentsForUnsync } from './utils/transclusion-unsync.util';
import { TransclusionLookup } from './transclusion.types';
import { Page, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';

type ReferencingPageInfo = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  spaceId: string;
  spaceSlug: string | null;
};

const UNSYNC_ATTACHMENT_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

@Injectable()
export class TransclusionService {
  private readonly logger = new Logger(TransclusionService.name);

  constructor(
    private readonly pageTransclusionsRepo: PageTransclusionsRepo,
    private readonly pageTransclusionReferencesRepo: PageTransclusionReferencesRepo,
    private readonly pageRepo: PageRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    @Optional() private readonly pageAccessService?: PageAccessService,
  ) {}

  async syncPageTransclusions(
    pageId: string,
    workspaceId: string,
    pmJson: unknown,
    trx?: KyselyTransaction,
  ): Promise<{ inserted: number; updated: number; deleted: number }> {
    const desired = collectTransclusionsFromPmJson(pmJson);
    const desiredById = new Map(desired.map((d) => [d.transclusionId, d]));

    const existing = await this.pageTransclusionsRepo.findByPageId(pageId, trx);
    const existingById = new Map(existing.map((e) => [e.transclusionId, e]));

    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    for (const d of desired) {
      const prev = existingById.get(d.transclusionId);
      if (!prev) {
        await this.pageTransclusionsRepo.insert(
          {
            workspaceId,
            pageId,
            transclusionId: d.transclusionId,
            content: d.content as any,
          },
          trx,
        );
        inserted += 1;
        continue;
      }

      const contentChanged = !isDeepStrictEqual(prev.content, d.content);
      if (contentChanged) {
        await this.pageTransclusionsRepo.update(
          pageId,
          d.transclusionId,
          { content: d.content as any },
          trx,
        );
        updated += 1;
      }
    }

    const removedIds = existing
      .filter((e) => !desiredById.has(e.transclusionId))
      .map((e) => e.transclusionId);
    if (removedIds.length > 0) {
      await this.pageTransclusionsRepo.deleteByPageAndTransclusionIds(
        pageId,
        removedIds,
        trx,
      );
      deleted = removedIds.length;
    }

    return { inserted, updated, deleted };
  }

  async syncPageReferences(
    referencePageId: string,
    workspaceId: string,
    pmJson: unknown,
    trx?: KyselyTransaction,
  ): Promise<{ inserted: number; deleted: number }> {
    const desired = collectReferencesFromPmJson(pmJson);
    const keyOf = (s: { sourcePageId: string; transclusionId: string }) =>
      `${s.sourcePageId}::${s.transclusionId}`;
    const desiredKeys = new Set(desired.map(keyOf));

    const existing =
      await this.pageTransclusionReferencesRepo.findByReferencePageId(
        referencePageId,
        trx,
      );
    const existingBlockReferences = existing.filter(
      (reference): reference is typeof reference & { transclusionId: string } =>
        typeof reference.transclusionId === 'string',
    );
    const existingKeys = new Set(existingBlockReferences.map(keyOf));

    const toInsert = desired
      .filter((d) => !existingKeys.has(keyOf(d)))
      .map((d) => ({
        workspaceId,
        referencePageId,
        sourcePageId: d.sourcePageId,
        transclusionId: d.transclusionId,
        referenceKind: 'block' as const,
        referenceNodeId: null,
      }));

    const toDelete = existingBlockReferences
      .filter((e) => !desiredKeys.has(keyOf(e)))
      .map((e) => ({
        sourcePageId: e.sourcePageId,
        transclusionId: e.transclusionId,
      }));

    if (toInsert.length > 0) {
      await this.pageTransclusionReferencesRepo.insertMany(toInsert, trx);
    }
    if (toDelete.length > 0) {
      await this.pageTransclusionReferencesRepo.deleteByReferenceAndKeys(
        referencePageId,
        toDelete,
        trx,
      );
    }

    return {
      inserted: toInsert.length,
      deleted: toDelete.length,
    };
  }

  /**
   * Extract transclusions from each page's PM JSON and bulk-insert into
   * `page_transclusions` in a single statement. Intended for brand-new pages
   * (e.g. duplication, import) where there is nothing to diff against.
   */
  async insertTransclusionsForPages(
    pages: Array<{ id: string; workspaceId: string; content: unknown }>,
    trx?: KyselyTransaction,
  ): Promise<{ inserted: number }> {
    const rows: Parameters<PageTransclusionsRepo['insertMany']>[0] = [];
    for (const page of pages) {
      const snapshots = collectTransclusionsFromPmJson(page.content);
      for (const s of snapshots) {
        rows.push({
          workspaceId: page.workspaceId,
          pageId: page.id,
          transclusionId: s.transclusionId,
          content: s.content as any,
        });
      }
    }
    if (rows.length === 0) return { inserted: 0 };
    await this.pageTransclusionsRepo.insertMany(rows, trx);
    return { inserted: rows.length };
  }

  /**
   * Walk each page's PM JSON for `transclusionReference` nodes and bulk-insert
   * one row per `(referencePage, source, target)`. For brand-new pages
   * (duplication, import) where there is nothing to diff against.
   */
  async insertReferencesForPages(
    pages: Array<{ id: string; workspaceId: string; content: unknown }>,
    trx?: KyselyTransaction,
  ): Promise<{ inserted: number }> {
    const rows: Array<{
      workspaceId: string;
      referencePageId: string;
      sourcePageId: string;
      transclusionId: string;
      referenceKind: 'block';
      referenceNodeId: null;
    }> = [];
    for (const page of pages) {
      const refs = collectReferencesFromPmJson(page.content);
      for (const r of refs) {
        rows.push({
          workspaceId: page.workspaceId,
          referencePageId: page.id,
          sourcePageId: r.sourcePageId,
          transclusionId: r.transclusionId,
          referenceKind: 'block',
          referenceNodeId: null,
        });
      }
    }
    if (rows.length === 0) return { inserted: 0 };
    await this.pageTransclusionReferencesRepo.insertMany(rows, trx);
    return { inserted: rows.length };
  }

  async lookup(
    references: Array<{ sourcePageId: string; transclusionId: string }>,
    viewer: User,
  ): Promise<{ items: TransclusionLookup[] }> {
    if (references.length === 0) return { items: [] };

    const candidatePageIds = Array.from(
      new Set(references.map((r) => r.sourcePageId)),
    );
    const accessibleSet = await this.filterReadablePageIds(
      candidatePageIds,
      viewer,
    );

    return this.lookupWithAccessSet(
      references,
      accessibleSet,
      viewer.workspaceId,
    );
  }

  /**
   * Resolve transclusion content for the given references using a caller-supplied
   * `accessibleSet` of source page ids. Source pages absent from the set return
   * `no_access`. Used by the share-scoped lookup path, where access is gated by
   * the share graph rather than the viewer's personal permissions.
   */
  async lookupWithAccessSet(
    references: Array<{ sourcePageId: string; transclusionId: string }>,
    accessibleSet: Set<string>,
    workspaceId: string,
  ): Promise<{ items: TransclusionLookup[] }> {
    if (references.length === 0) return { items: [] };

    const items: TransclusionLookup[] = new Array(references.length).fill(null);
    const pendingIdx = references.map((_, i) => i);

    const accessiblePending = pendingIdx.filter((i) =>
      accessibleSet.has(references[i].sourcePageId),
    );
    const rows = await this.pageTransclusionsRepo.findManyByPageAndTransclusion(
      accessiblePending.map((i) => ({
        pageId: references[i].sourcePageId,
        transclusionId: references[i].transclusionId,
      })),
      workspaceId,
    );
    const rowKey = (r: { pageId: string; transclusionId: string }) =>
      `${r.pageId}::${r.transclusionId}`;
    const rowMap = new Map(rows.map((r) => [rowKey(r), r]));

    const accessiblePageIds = Array.from(
      new Set(accessiblePending.map((i) => references[i].sourcePageId)),
    );
    const pages = (
      await Promise.all(
        accessiblePageIds.map((id) =>
          this.pageRepo.findById(id, { includeContent: false }),
        ),
      )
    ).filter(
      (page): page is Page =>
        Boolean(page) && !page.deletedAt && page.workspaceId === workspaceId,
    );
    const pageMeta = new Map<string, Date>();
    for (const p of pages) {
      pageMeta.set(p.id, p.updatedAt);
    }

    for (const i of pendingIdx) {
      const ref = references[i];
      if (!accessibleSet.has(ref.sourcePageId)) {
        items[i] = {
          sourcePageId: ref.sourcePageId,
          transclusionId: ref.transclusionId,
          status: 'no_access',
        };
        continue;
      }
      const updatedAt = pageMeta.get(ref.sourcePageId);
      if (!updatedAt) {
        items[i] = {
          sourcePageId: ref.sourcePageId,
          transclusionId: ref.transclusionId,
          status: 'not_found',
        };
        continue;
      }

      const row = rowMap.get(`${ref.sourcePageId}::${ref.transclusionId}`);
      if (!row) {
        items[i] = {
          sourcePageId: ref.sourcePageId,
          transclusionId: ref.transclusionId,
          status: 'not_found',
        };
        continue;
      }
      items[i] = {
        sourcePageId: ref.sourcePageId,
        transclusionId: ref.transclusionId,
        content: row.content,
        sourceUpdatedAt: updatedAt,
      };
    }

    return { items };
  }

  async listReferences(opts: {
    sourcePageId: string;
    transclusionId: string;
    viewer: User;
  }): Promise<{
    source: ReferencingPageInfo | null;
    references: ReferencingPageInfo[];
    hasReferences: boolean;
  }> {
    const { sourcePageId, transclusionId, viewer } = opts;
    const workspaceId = viewer.workspaceId;

    const [referencePageIds, hasReferences] = await Promise.all([
      this.pageTransclusionReferencesRepo.findReferencePageIdsByTransclusion(
        sourcePageId,
        transclusionId,
        workspaceId,
      ),
      this.pageTransclusionReferencesRepo.hasLiveReferences(
        sourcePageId,
        transclusionId,
        workspaceId,
      ),
    ]);

    const candidatePageIds = Array.from(
      new Set([sourcePageId, ...referencePageIds]),
    );
    const accessibleSet = await this.filterReadablePageIds(
      candidatePageIds,
      viewer,
    );

    const accessibleIds = candidatePageIds.filter((id) =>
      accessibleSet.has(id),
    );
    if (accessibleIds.length === 0) {
      return { source: null, references: [], hasReferences };
    }

    const rows = await Promise.all(
      accessibleIds.map((id) =>
        this.pageRepo.findById(id, { includeSpace: true }),
      ),
    );
    const byId = new Map<string, ReferencingPageInfo>();
    for (const p of rows) {
      if (!p || p.deletedAt || p.workspaceId !== workspaceId) continue;
      const space = (p as Page & { space?: { slug?: string } }).space;
      byId.set(p.id, {
        id: p.id,
        slugId: p.slugId,
        title: p.title ?? null,
        icon: p.icon ?? null,
        spaceId: p.spaceId,
        spaceSlug: space?.slug ?? null,
      });
    }

    const source = byId.get(sourcePageId) ?? null;
    const references = referencePageIds
      .map((id) => byId.get(id))
      .filter((p): p is ReferencingPageInfo => Boolean(p));

    return { source, references, hasReferences };
  }

  /**
   * Convert a `transclusionReference` into a self-contained copy on the
   * reference page: load source content, generate deterministic attachment ids,
   * copy storage files, insert new attachment rows, return rewritten content. The caller
   * (controller) returns the content blob to the client which then performs
   * `editor.commands.insertContentAt(range, content)` to replace the reference
   * node. Reference-graph cleanup is intentionally left to the next atomic Yjs
   * persistence pass; deleting it before the client saves can lose a still-live
   * edge when the page has another matching reference or the client disconnects.
   */
  async unsyncReference(
    referencePageId: string,
    sourcePageId: string,
    transclusionId: string,
    user: User,
  ): Promise<{ content: unknown }> {
    const referencePage = await this.pageRepo.findById(referencePageId);
    if (!referencePage || referencePage.deletedAt) {
      throw new NotFoundException('Reference page not found');
    }

    const sourcePage = await this.pageRepo.findById(sourcePageId);
    if (!sourcePage || sourcePage.deletedAt) {
      throw new NotFoundException('Source page not found');
    }

    if (
      referencePage.workspaceId !== user.workspaceId ||
      sourcePage.workspaceId !== user.workspaceId
    ) {
      throw new ForbiddenException();
    }

    const pageAccess = this.requirePageAccess();
    await pageAccess.assertCanWritePage(referencePage, user);
    await pageAccess.assertCanReadPage(sourcePage, user);

    const transclusion =
      await this.pageTransclusionsRepo.findByPageAndTransclusion(
        sourcePageId,
        transclusionId,
      );
    if (!transclusion) {
      throw new NotFoundException('Sync block not found');
    }

    const { content, copies } = rewriteAttachmentsForUnsync(
      transclusion.content,
      (oldAttachmentId) =>
        uuid5(
          `${referencePageId}:${sourcePageId}:${transclusionId}:${oldAttachmentId ?? ''}`,
          UNSYNC_ATTACHMENT_NAMESPACE,
        ),
    );

    if (copies.length > 0) {
      await this.materializeUnsyncedAttachments({
        copies,
        referencePage,
        sourcePageId,
        user,
      });
    }

    return { content };
  }

  private async materializeUnsyncedAttachments(opts: {
    copies: Array<{ oldAttachmentId: string; newAttachmentId: string }>;
    referencePage: Page;
    sourcePageId: string;
    user: User;
  }): Promise<void> {
    const { copies, referencePage, sourcePageId, user } = opts;
    const copiedPaths: string[] = [];

    try {
      await this.pageTransclusionReferencesRepo.withWorkspaceGraphLock(
        referencePage.workspaceId,
        async (trx) => {
          const attachmentIds = Array.from(
            new Set(
              copies.flatMap((copy) => [
                copy.oldAttachmentId,
                copy.newAttachmentId,
              ]),
            ),
          );
          const rows = await this.attachmentRepo.findByIds(attachmentIds, {
            trx,
          });
          const byId = new Map(rows.map((row) => [row.id, row]));

          for (const plan of copies) {
            const old = byId.get(plan.oldAttachmentId);
            const existing = byId.get(plan.newAttachmentId);

            if (
              existing &&
              (existing.pageId !== referencePage.id ||
                existing.workspaceId !== referencePage.workspaceId)
            ) {
              throw new ConflictException(
                'Synced block attachment target is unavailable',
              );
            }

            if (
              existing &&
              (await this.storageService.exists(existing.filePath))
            ) {
              continue;
            }

            if (!old || old.pageId !== sourcePageId) {
              throw new ConflictException(
                'Synced block attachment source is unavailable',
              );
            }

            const newFilePath = old.filePath
              .split(plan.oldAttachmentId)
              .join(plan.newAttachmentId);
            if (newFilePath === old.filePath) {
              throw new ConflictException(
                'Synced block attachment path cannot be materialized',
              );
            }
            if (existing && existing.filePath !== newFilePath) {
              throw new ConflictException(
                'Synced block attachment target is inconsistent',
              );
            }

            await this.storageService.copy(old.filePath, newFilePath);
            copiedPaths.push(newFilePath);

            if (!existing) {
              await this.attachmentRepo.insertAttachment(
                {
                  id: plan.newAttachmentId,
                  type: old.type,
                  filePath: newFilePath,
                  fileName: old.fileName,
                  fileSize: old.fileSize,
                  mimeType: old.mimeType,
                  fileExt: old.fileExt,
                  creatorId: user.id,
                  workspaceId: referencePage.workspaceId,
                  pageId: referencePage.id,
                  spaceId: referencePage.spaceId,
                  textContent: old.textContent,
                },
                trx,
              );
            }
          }
        },
      );
    } catch (error) {
      let cleanupFailedCount = 0;
      for (const filePath of copiedPaths.reverse()) {
        try {
          await this.storageService.delete(filePath);
        } catch {
          cleanupFailedCount += 1;
        }
      }

      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error({
        event: 'transclusion_unsync_attachment_materialization_failed',
        copiedCount: copiedPaths.length,
        cleanupFailedCount,
      });
      throw new InternalServerErrorException(
        'Could not materialize synced block attachments',
      );
    }
  }

  private async filterReadablePageIds(
    pageIds: string[],
    user: User,
  ): Promise<Set<string>> {
    const readablePageIds = new Set<string>();
    const uniquePageIds = [...new Set(pageIds.filter(Boolean))];

    const pages = (
      await Promise.all(
        uniquePageIds.map((pageId) => this.pageRepo.findById(pageId)),
      )
    ).filter(
      (page): page is Page =>
        Boolean(page) &&
        !page.deletedAt &&
        page.workspaceId === user.workspaceId,
    );
    const accessByPageId =
      await this.requirePageAccess().getEffectiveAccessForPages(pages, user);

    for (const page of pages) {
      if (accessByPageId.get(page.id)?.capabilities.canRead) {
        readablePageIds.add(page.id);
      }
    }

    return readablePageIds;
  }

  private requirePageAccess(): PageAccessService {
    if (!this.pageAccessService) {
      throw new ForbiddenException('Page access service is unavailable');
    }
    return this.pageAccessService;
  }
}
