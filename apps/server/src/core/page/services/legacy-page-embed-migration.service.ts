import { ConflictException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { v7 as uuid7, validate as isUuid } from 'uuid';
import { sql } from 'kysely';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { strictJsonToNode } from '../../../collaboration/collaboration.util';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { MAX_PAGE_TREE_DEPTH } from '../../../common/config/page-tree.constants';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageEmbedService } from '../transclusion/page-embed.service';
import { materializePageContent } from '../transclusion/utils/page-embed-materialize.util';
import { rewriteAttachmentsForUnsync } from '../transclusion/utils/transclusion-unsync.util';
import { PageHistoryRecorderService } from './page-history-recorder.service';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';

type LegacyAttachmentCopyPlan = {
  source: Page;
  copies: Array<{ oldAttachmentId: string; newAttachmentId: string }>;
};

type LegacyMigrationIssue = {
  referenceNodeId: string;
  sourcePageId: string | null;
  errorCode: string;
};

@Injectable()
export class LegacyPageEmbedMigrationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    private readonly content: PageTemplateContentService,
    private readonly operations: PageTemplateOperationService,
  ) {}

  async findLegacyPageEmbedCandidates(): Promise<
    Array<{ referencePageId: string }>
  > {
    const result = await sql<{ referencePageId: string }>`
      select distinct reference_page_id as "referencePageId"
      from page_transclusion_references
      where reference_kind = 'page'
      union
      select id as "referencePageId"
      from pages
      where deleted_at is null
        and content::text like '%"type": "pageEmbed"%'
    `.execute(this.db);
    return result.rows;
  }

  async recordLegacyMigrationFailure(
    pageId: string,
    error: unknown,
  ): Promise<void> {
    const page = await this.pageRepo.findById(pageId);
    if (!page) return;
    await this.db
      .insertInto('pageTemplateLegacyMigrationErrors')
      .values({
        workspaceId: page.workspaceId,
        consumerPageId: page.id,
        sourcePageId: null,
        referenceNodeId: `migration:${page.id}`,
        errorCode: this.operations.errorCode(error),
      })
      .onConflict((conflict) =>
        conflict.columns(['consumerPageId', 'referenceNodeId']).doUpdateSet({
          errorCode: this.operations.errorCode(error),
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  async migrateLegacyPageEmbedsForPage(pageId: string): Promise<boolean> {
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt) {
      await this.deleteLegacyPageReferences(pageId);
      return false;
    }
    const actor = await this.findLegacyMigrationActor(page);
    if (!actor) {
      throw this.conflict(
        'page_embed_migration_actor_unavailable',
        'No workspace user is available for the migration',
      );
    }
    const current = await this.content
      .getLiveContent(page.id, actor)
      .catch(() => page.content);
    if (!this.containsNodeType(current, 'pageEmbed')) {
      await this.deleteLegacyPageReferences(page.id);
      return false;
    }

    const baseContentHash = hashProseMirrorJson(current as any);
    const operation = await this.operations.beginOperation(
      'legacy_embed_migration',
      `legacy-page-embeds:${page.id}:${baseContentHash}`,
      actor,
      { pageId: page.id, baseContentHash },
      { consumerPageId: page.id, baseContentHash },
    );
    if (operation.status === 'completed') {
      await this.deleteLegacyPageReferences(page.id);
      return false;
    }

    const resolved = await this.resolveLegacyPageEmbeds(
      current,
      page,
      actor,
      new Set([page.id]),
      [],
    );
    strictJsonToNode(resolved.content as any);
    const mappings = resolved.attachmentPlans.flatMap((plan) => plan.copies);
    await this.operations.stageAttachmentMapping(
      operation.id,
      operation.leaseToken,
      mappings,
    );

    const copiedPaths: string[] = [];
    const insertedAttachmentIds: string[] = [];
    try {
      for (const plan of resolved.attachmentPlans) {
        const rows = await this.content.copyAttachments(
          plan.copies,
          plan.source,
          page.id,
          page.spaceId,
          actor,
          copiedPaths,
          false,
        );
        for (const row of rows) {
          await this.attachmentRepo.insertAttachment(row);
          insertedAttachmentIds.push(row.id);
        }
      }
      await this.operations.assertOperationLease(
        operation.id,
        operation.leaseToken,
      );
      const result = await this.content.applyMutation(
        page.id,
        current,
        resolved.content,
        baseContentHash,
        operation.id,
        operation.leaseToken,
        actor,
        -1,
      );
      await this.operations.completeOperation(
        operation.id,
        {
          afterContentHash: result.afterHash,
          attachmentMapping: mappings as any,
        },
        operation.leaseToken,
      );
      await this.recordLegacyMigrationIssues(page, resolved.issues);
      await this.pageHistoryRecorder.enqueuePageEvent({
        pageId: page.id,
        changeType: 'page.template.legacy-embeds-materialized',
        changeData: {
          migratedEmbedCount: resolved.migratedEmbedCount,
          unavailableEmbedCount: resolved.issues.length,
        },
        actorId: actor.id,
      });
      return true;
    } catch (error) {
      if (
        await this.operations.ownsOperationLease(
          operation.id,
          operation.leaseToken,
        )
      ) {
        await this.operations.failOperation(
          operation.id,
          this.operations.errorCode(error),
          operation.leaseToken,
        );
        await Promise.allSettled(
          insertedAttachmentIds.map((id) =>
            this.attachmentRepo.deleteAttachmentById(id),
          ),
        );
        await Promise.allSettled(
          copiedPaths.map((path) => this.storageService.delete(path)),
        );
      }
      throw error;
    }
  }

  private async resolveLegacyPageEmbeds(
    input: unknown,
    target: Page,
    actor: User,
    ancestors: Set<string>,
    path: number[],
  ): Promise<{
    content: unknown;
    attachmentPlans: LegacyAttachmentCopyPlan[];
    issues: LegacyMigrationIssue[];
    migratedEmbedCount: number;
  }> {
    const maxDepth = this.pageEmbedService.getMaxDepth();
    const attachmentPlans: LegacyAttachmentCopyPlan[] = [];
    const issues: LegacyMigrationIssue[] = [];
    let migratedEmbedCount = 0;

    const visitNodes = async (nodes: any[], parentPath: number[]) => {
      const output: any[] = [];
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const nodePath = [...parentPath, index];
        if (node?.type !== 'pageEmbed') {
          const next = structuredClone(node);
          if (Array.isArray(next?.content)) {
            next.content = await visitNodes(next.content, nodePath);
          }
          output.push(next);
          continue;
        }

        migratedEmbedCount += 1;
        const rawSourcePageId = node.attrs?.sourcePageId;
        const sourcePageId =
          typeof rawSourcePageId === 'string' && isUuid(rawSourcePageId)
            ? rawSourcePageId
            : null;
        const referenceNodeId =
          typeof node.attrs?.id === 'string' && node.attrs.id.length > 0
            ? node.attrs.id
            : `legacy:${nodePath.join('.')}`;
        const depthExceeded = ancestors.size > maxDepth;
        const source =
          sourcePageId && !depthExceeded
            ? await this.pageRepo.findById(sourcePageId, {
                includeContent: true,
              })
            : null;
        const unavailableCode = !sourcePageId
          ? 'page_embed_invalid_source_page_id'
          : depthExceeded
            ? 'page_embed_depth_exceeded'
            : !source || source.deletedAt
              ? 'page_embed_source_unavailable'
              : source.workspaceId !== target.workspaceId ||
                  source.spaceId !== target.spaceId
                ? 'page_embed_source_scope_mismatch'
                : ancestors.has(source.id)
                  ? 'page_embed_cycle'
                  : null;
        if (unavailableCode) {
          issues.push({
            referenceNodeId,
            sourcePageId,
            errorCode: unavailableCode,
          });
          output.push(this.legacyUnavailableCallout());
          continue;
        }

        const sourceAccess = await this.pageAccessService
          .getEffectiveAccess(source!, actor)
          .catch(() => null);
        if (!sourceAccess?.capabilities.canRead) {
          issues.push({
            referenceNodeId,
            sourcePageId,
            errorCode: 'page_embed_source_no_access',
          });
          output.push(this.legacyUnavailableCallout());
          continue;
        }

        const audienceCompatible = await this.canMaterializeLegacySource(
          target,
          source!,
        );
        if (!audienceCompatible) {
          issues.push({
            referenceNodeId,
            sourcePageId,
            errorCode: 'page_embed_source_audience_mismatch',
          });
          output.push(this.legacyUnavailableCallout());
          continue;
        }

        const sourceContent = await this.content
          .getLiveContent(source!.id, actor)
          .catch(() => source!.content);
        const materialized = materializePageContent(sourceContent, {
          sourcePageId: source!.id,
          targetPageId: target.id,
        });
        const rewritten = rewriteAttachmentsForUnsync(materialized, () =>
          uuid7(),
        );
        if (rewritten.copies.length > 0) {
          attachmentPlans.push({ source: source!, copies: rewritten.copies });
        }
        const nested = await this.resolveLegacyPageEmbeds(
          rewritten.content,
          target,
          actor,
          new Set([...ancestors, source!.id]),
          nodePath,
        );
        attachmentPlans.push(...nested.attachmentPlans);
        issues.push(...nested.issues);
        migratedEmbedCount += nested.migratedEmbedCount;
        const nestedDocument = nested.content as any;
        output.push(
          ...(Array.isArray(nestedDocument?.content)
            ? nestedDocument.content
            : [this.legacyUnavailableCallout()]),
        );
      }
      return output;
    };

    const document =
      input && typeof input === 'object'
        ? structuredClone(input as any)
        : { type: 'doc', content: [] };
    document.type = 'doc';
    document.content = await visitNodes(
      Array.isArray(document.content) ? document.content : [],
      path,
    );
    if (document.content.length === 0)
      document.content = [{ type: 'paragraph' }];
    return { content: document, attachmentPlans, issues, migratedEmbedCount };
  }

  private async canMaterializeLegacySource(
    target: Page,
    source: Page,
  ): Promise<boolean> {
    const publicAccess = await sql<{ isShared: boolean }>`
      with recursive page_ancestors as (
        select id, parent_page_id, workspace_id, space_id, 0 as level
        from pages
        where id = ${target.id}::uuid
          and deleted_at is null
        union all
        select p.id, p.parent_page_id, p.workspace_id, p.space_id, a.level + 1
        from pages p
        inner join page_ancestors a on a.parent_page_id = p.id
        where p.deleted_at is null
          and a.level < ${MAX_PAGE_TREE_DEPTH}
      )
      select exists (
        select 1
        from page_ancestors a
        inner join shares s on s.page_id = a.id
        where s.workspace_id = ${target.workspaceId}::uuid
          and s.space_id = ${target.spaceId}::uuid
          and a.workspace_id = s.workspace_id
          and a.space_id = s.space_id
          and (a.level = 0 or s.include_sub_pages = true)
      ) as "isShared"
    `.execute(this.db);
    if (publicAccess.rows[0]?.isShared) return false;

    const users = await this.db
      .selectFrom('users')
      .select('id')
      .where('workspaceId', '=', target.workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .execute();
    const candidateIds = users.map((candidate) => candidate.id);
    const [targetReaders, sourceReaders] = await Promise.all([
      this.pageAccessService.filterUsersWithPageReadAccess(
        target.id,
        candidateIds,
      ),
      this.pageAccessService.filterUsersWithPageReadAccess(
        source.id,
        candidateIds,
      ),
    ]);
    const sourceReaderIds = new Set(sourceReaders);
    return targetReaders.every((readerId) => sourceReaderIds.has(readerId));
  }

  private legacyUnavailableCallout() {
    return {
      type: 'callout',
      attrs: { type: 'info', icon: null },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Embedded page content was unavailable during migration.',
            },
          ],
        },
      ],
    };
  }

  async findLegacyMigrationActor(page: Page): Promise<User | null> {
    const creator = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', page.creatorId)
      .where('workspaceId', '=', page.workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();
    if (creator) return creator;
    return (
      (await this.db
        .selectFrom('users')
        .selectAll()
        .where('workspaceId', '=', page.workspaceId)
        .where('deletedAt', 'is', null)
        .where('deactivatedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .executeTakeFirst()) ?? null
    );
  }

  private async recordLegacyMigrationIssues(
    page: Page,
    issues: LegacyMigrationIssue[],
  ): Promise<void> {
    if (issues.length === 0) return;
    await this.db
      .insertInto('pageTemplateLegacyMigrationErrors')
      .values(
        issues.map((issue) => ({
          workspaceId: page.workspaceId,
          consumerPageId: page.id,
          sourcePageId: issue.sourcePageId,
          referenceNodeId: issue.referenceNodeId,
          errorCode: issue.errorCode,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['consumerPageId', 'referenceNodeId']).doUpdateSet({
          sourcePageId: sql`excluded.source_page_id`,
          errorCode: sql`excluded.error_code`,
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  private async deleteLegacyPageReferences(pageId: string): Promise<void> {
    await this.db
      .deleteFrom('pageTransclusionReferences')
      .where('referencePageId', '=', pageId)
      .where('referenceKind', '=', 'page')
      .execute();
  }

  private containsNodeType(input: unknown, type: string): boolean {
    if (!input || typeof input !== 'object') return false;
    const node = input as any;
    if (node.type === type) return true;
    return Array.isArray(node.content)
      ? node.content.some((child: unknown) =>
          this.containsNodeType(child, type),
        )
      : false;
  }
  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
