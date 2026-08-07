import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { PageTransclusionReferencesRepo } from '@docmost/db/repos/page-transclusions/page-transclusion-references.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Page, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageTemplatePolicyService } from './page-template-policy.service';
import { PageEmbedLookup } from './transclusion.types';
import { collectPageEmbedsFromPmJson } from './utils/transclusion-prosemirror.util';
import {
  PAGE_EMBED_GRAPH_MAX_EDGES,
  PAGE_EMBED_GRAPH_MAX_NODES,
} from '../../../common/config/page-embed.constants';
import {
  getProsemirrorContent,
  removeMarkTypeFromDoc,
} from '../../../common/helpers/prosemirror/utils';
import { jsonToNode } from '../../../collaboration/collaboration.util';
import { PageEmbedGraphLockService } from './page-embed-graph-lock.service';
import type { PageEmbedGraphLease } from './page-embed-graph-lock.service';
import { sql } from 'kysely';

type PageEdge = { referencePageId: string; sourcePageId: string };

@Injectable()
export class PageEmbedService {
  private readonly logger = new Logger(PageEmbedService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly referencesRepo: PageTransclusionReferencesRepo,
    private readonly pageRepo: PageRepo,
    @Optional() private readonly pageAccessService: PageAccessService | null,
    private readonly policy: PageTemplatePolicyService,
    private readonly graphLock: PageEmbedGraphLockService,
  ) {}

  getMaxDepth(): number {
    return this.policy.getMaxPageEmbedDepth();
  }

  async syncPageReferences(
    referencePageId: string,
    workspaceId: string,
    pmJson: unknown,
    trx: KyselyTransaction,
    mutationId?: string,
    graphLease?: PageEmbedGraphLease,
  ): Promise<{ inserted: number; deleted: number }> {
    let desired: ReturnType<typeof collectPageEmbedsFromPmJson>;
    try {
      desired = collectPageEmbedsFromPmJson(pmJson);
    } catch (error) {
      throw new ConflictException({
        code: (error as Error).message,
        message: 'Invalid page embed structure',
      });
    }

    const existing = await this.referencesRepo.findPageByReferencePageId(
      referencePageId,
      trx,
    );
    const existingByNode = new Map(
      existing.map((row) => [row.referenceNodeId, row]),
    );
    const desiredByNode = new Map(
      desired.map((row) => [row.referenceNodeId, row]),
    );
    const changedOrAdded = desired.filter((row) => {
      const previous = existingByNode.get(row.referenceNodeId);
      return !previous || previous.sourcePageId !== row.sourcePageId;
    });
    const removedOrChanged = existing.filter((row) => {
      const next = row.referenceNodeId
        ? desiredByNode.get(row.referenceNodeId)
        : undefined;
      return !next || next.sourcePageId !== row.sourcePageId;
    });

    if (changedOrAdded.length > 0) {
      await this.assertManagedMutation(
        mutationId,
        referencePageId,
        changedOrAdded,
        trx,
      );
      if (!graphLease) {
        throw this.graphError(
          'page_embed_graph_lock_required',
          'Page embed graph mutations require a workspace lease',
        );
      }
      graphLease.assertOwned();
      if (mutationId) {
        await trx
          .updateTable('pageTemplateOperations')
          .set({ graphFencingToken: String(graphLease.fencingToken) })
          .where('id', '=', mutationId)
          .where('status', '=', 'pending')
          .execute();
      }
      await this.referencesRepo.lockWorkspaceGraph(workspaceId, trx);
      await this.assertFencingToken(workspaceId, graphLease.fencingToken, trx);
      await this.assertSourcesAvailable(
        changedOrAdded,
        workspaceId,
        referencePageId,
        trx,
      );
      await this.assertGraphValid(
        workspaceId,
        referencePageId,
        desired.map((row) => row.sourcePageId),
        trx,
      );
    }

    if (removedOrChanged.length > 0) {
      await this.referencesRepo.deletePageByReferenceAndNodeIds(
        referencePageId,
        removedOrChanged
          .map((row) => row.referenceNodeId)
          .filter((id): id is string => Boolean(id)),
        trx,
      );
    }
    if (changedOrAdded.length > 0) {
      await this.referencesRepo.insertPageMany(
        changedOrAdded.map((row) => ({
          workspaceId,
          referencePageId,
          sourcePageId: row.sourcePageId,
          referenceNodeId: row.referenceNodeId,
          referenceKind: 'page' as const,
          transclusionId: null,
        })),
        trx,
      );
      await graphLease!.assertOwnedAsync();
    }

    return {
      inserted: changedOrAdded.length,
      deleted: removedOrChanged.length,
    };
  }

  async acquireGraphLeaseForContent(
    workspaceId: string,
    content: unknown,
  ): Promise<PageEmbedGraphLease | undefined> {
    let references: ReturnType<typeof collectPageEmbedsFromPmJson>;
    try {
      references = collectPageEmbedsFromPmJson(content);
    } catch (error) {
      throw this.graphError(
        (error as Error).message,
        'Invalid page embed structure',
      );
    }
    return references.length > 0
      ? this.graphLock.acquire(workspaceId)
      : undefined;
  }

  async prepareBulkPageReferences(
    pages: Array<{
      id: string;
      workspaceId: string;
      spaceId: string;
      content: unknown;
    }>,
    actor: User,
    operationKind: 'snapshot' | 'duplication' | 'import',
  ): Promise<PageEmbedGraphLease | undefined> {
    const references = pages.flatMap((page) =>
      collectPageEmbedsFromPmJson(page.content).map((reference) => ({
        ...reference,
        consumerPageId: page.id,
        consumerSpaceId: page.spaceId,
        workspaceId: page.workspaceId,
      })),
    );
    if (references.length === 0) return undefined;
    if (
      pages.some(
        (page) =>
          page.workspaceId !== actor.workspaceId ||
          page.workspaceId !== pages[0]?.workspaceId,
      )
    ) {
      throw this.graphError(
        'page_embed_cross_workspace',
        `A ${operationKind} operation cannot create cross-workspace page embeds`,
      );
    }
    const internalPagesById = new Map(pages.map((page) => [page.id, page]));
    for (const spaceId of new Set(
      references.map((reference) => reference.consumerSpaceId),
    )) {
      await this.policy.assertAction(
        actor.workspaceId,
        spaceId,
        actor.id,
        'use_live_embed',
      );
    }
    const externalSourcesById = new Map<string, Page>();
    for (const reference of references) {
      const internalSource = internalPagesById.get(reference.sourcePageId);
      let sourceSpaceId = internalSource?.spaceId;
      if (!internalSource) {
        let source = externalSourcesById.get(reference.sourcePageId);
        if (!source) {
          source = await this.pageRepo.findById(reference.sourcePageId);
          if (
            !source ||
            source.deletedAt ||
            source.workspaceId !== actor.workspaceId
          ) {
            throw this.graphError(
              'page_embed_source_unavailable',
              'Page embed source is unavailable',
            );
          }
          await this.requirePageAccess().assertCanReadPage(source, actor);
          externalSourcesById.set(source.id, source);
        }
        sourceSpaceId = source.spaceId;
      }
      if (sourceSpaceId !== reference.consumerSpaceId) {
        throw this.graphError(
          'page_embed_cross_space',
          `A ${operationKind} operation cannot create cross-space page embeds`,
        );
      }
    }
    return this.graphLock.acquire(actor.workspaceId);
  }

  async insertPageReferencesForPages(
    pages: Array<{
      id: string;
      workspaceId: string;
      spaceId: string;
      content: unknown;
    }>,
    trx: KyselyTransaction,
    graphLease?: PageEmbedGraphLease,
  ): Promise<{ inserted: number }> {
    let inserted = 0;
    const pagesByWorkspace = new Map<string, typeof pages>();
    for (const page of pages) {
      const grouped = pagesByWorkspace.get(page.workspaceId) ?? [];
      grouped.push(page);
      pagesByWorkspace.set(page.workspaceId, grouped);
    }
    for (const [workspaceId, workspacePages] of pagesByWorkspace) {
      const hasEmbeds = workspacePages.some(
        (page) => collectPageEmbedsFromPmJson(page.content).length > 0,
      );
      if (!hasEmbeds) continue;
      if (!graphLease) {
        throw this.graphError(
          'page_embed_graph_lock_required',
          'Page embed graph mutations require a workspace lease',
        );
      }
      graphLease.assertOwned();
      await this.referencesRepo.lockWorkspaceGraph(workspaceId, trx);
      await this.assertFencingToken(workspaceId, graphLease.fencingToken, trx);
      for (const page of workspacePages) {
        const desired = collectPageEmbedsFromPmJson(page.content);
        if (desired.length === 0) continue;
        graphLease.assertOwned();
        await this.assertSourcesAvailable(desired, workspaceId, page.id, trx);
        await this.assertGraphValid(
          workspaceId,
          page.id,
          desired.map((row) => row.sourcePageId),
          trx,
        );
        await this.referencesRepo.insertPageMany(
          desired.map((row) => ({
            workspaceId,
            referencePageId: page.id,
            sourcePageId: row.sourcePageId,
            referenceNodeId: row.referenceNodeId,
            referenceKind: 'page' as const,
            transclusionId: null,
          })),
          trx,
        );
        inserted += desired.length;
      }
      await graphLease.assertOwnedAsync();
    }
    return { inserted };
  }

  async assertGraphValid(
    workspaceId: string,
    referencePageId: string,
    desiredSourcePageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    const current = await this.referencesRepo.findPageGraph(
      workspaceId,
      trx,
      PAGE_EMBED_GRAPH_MAX_EDGES + 1,
    );
    if (current.length > PAGE_EMBED_GRAPH_MAX_EDGES) {
      throw this.graphError(
        'page_embed_graph_limit_exceeded',
        'Page embed graph is too large',
      );
    }
    const edges: PageEdge[] = [
      ...current.filter((edge) => edge.referencePageId !== referencePageId),
      ...[...new Set(desiredSourcePageIds)].map((sourcePageId) => ({
        referencePageId,
        sourcePageId,
      })),
    ];
    if (edges.length > PAGE_EMBED_GRAPH_MAX_EDGES) {
      throw this.graphError(
        'page_embed_graph_limit_exceeded',
        'Page embed graph is too large',
      );
    }

    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (edge.referencePageId === edge.sourcePageId) {
        throw this.graphError(
          'page_embed_self_reference',
          'A page cannot embed itself',
        );
      }
      const sources = adjacency.get(edge.referencePageId) ?? new Set<string>();
      sources.add(edge.sourcePageId);
      adjacency.set(edge.referencePageId, sources);
    }
    const nodes = new Set<string>();
    for (const [consumer, sources] of adjacency) {
      nodes.add(consumer);
      for (const source of sources) nodes.add(source);
    }
    if (nodes.size > PAGE_EMBED_GRAPH_MAX_NODES) {
      throw this.graphError(
        'page_embed_graph_limit_exceeded',
        'Page embed graph is too large',
      );
    }

    const maxDepth = this.policy.getMaxPageEmbedDepth();
    const incoming = new Map(Array.from(nodes, (pageId) => [pageId, 0]));
    for (const sources of adjacency.values()) {
      for (const sourceId of sources) {
        incoming.set(sourceId, (incoming.get(sourceId) ?? 0) + 1);
      }
    }
    const queue = Array.from(nodes).filter(
      (pageId) => incoming.get(pageId) === 0,
    );
    const topologicalOrder: string[] = [];
    for (let index = 0; index < queue.length; index += 1) {
      const pageId = queue[index];
      topologicalOrder.push(pageId);
      for (const sourceId of adjacency.get(pageId) ?? []) {
        const nextIncoming = (incoming.get(sourceId) ?? 0) - 1;
        incoming.set(sourceId, nextIncoming);
        if (nextIncoming === 0) queue.push(sourceId);
      }
    }
    if (topologicalOrder.length !== nodes.size) {
      throw this.graphError('page_embed_cycle', 'Page embed cycle detected');
    }

    const depthByPage = new Map<string, number>();
    for (let index = topologicalOrder.length - 1; index >= 0; index -= 1) {
      const pageId = topologicalOrder[index];
      let depth = 0;
      for (const sourceId of adjacency.get(pageId) ?? []) {
        depth = Math.max(depth, 1 + (depthByPage.get(sourceId) ?? 0));
      }
      if (depth > maxDepth) {
        throw this.graphError(
          'page_embed_depth_exceeded',
          `Page embed depth exceeds ${maxDepth}`,
        );
      }
      depthByPage.set(pageId, depth);
    }
  }

  async lookup(
    sourcePageIds: string[],
    viewer: User,
    referencePageId?: string,
  ): Promise<{ items: PageEmbedLookup[] }> {
    const accessible = await this.filterReadablePageIds(sourcePageIds, viewer);
    let consumerSpaceId: string | undefined;
    if (referencePageId) {
      const consumer = await this.pageRepo.findById(referencePageId);
      if (
        !consumer ||
        consumer.deletedAt ||
        consumer.workspaceId !== viewer.workspaceId
      ) {
        return {
          items: sourcePageIds.map((sourcePageId) => ({
            kind: 'page',
            sourcePageId,
            status: 'no_access',
          })),
        };
      }
      const consumerAccess = await this.requirePageAccess().getEffectiveAccess(
        consumer,
        viewer,
      );
      if (!consumerAccess.capabilities.canRead) {
        return {
          items: sourcePageIds.map((sourcePageId) => ({
            kind: 'page',
            sourcePageId,
            status: 'no_access',
          })),
        };
      }
      const consumerPolicy = await this.policy.resolveForUser(
        viewer.workspaceId,
        consumer.spaceId,
        viewer.id,
      );
      if (
        !consumerPolicy.systemEnabled ||
        !consumerPolicy.workspaceEnabled ||
        !consumerPolicy.templatesEnabled ||
        !consumerPolicy.allowLiveEmbed ||
        !consumerPolicy.allowedActions.includes('use_live_embed')
      ) {
        return {
          items: sourcePageIds.map((sourcePageId) => ({
            kind: 'page',
            sourcePageId,
            status: 'disabled',
          })),
        };
      }
      consumerSpaceId = consumer.spaceId;
    }
    return this.lookupWithAccessSet(
      sourcePageIds,
      accessible,
      viewer.workspaceId,
      viewer,
      false,
      consumerSpaceId,
    );
  }

  async lookupWithAccessSet(
    sourcePageIds: string[],
    accessibleSet: Set<string>,
    workspaceId: string,
    viewer?: User,
    publicShare = false,
    consumerSpaceId?: string,
  ): Promise<{ items: PageEmbedLookup[] }> {
    const unique = [...new Set(sourcePageIds)];
    if (publicShare && consumerSpaceId) {
      const consumerPolicy = await this.policy.resolvePublic(
        workspaceId,
        consumerSpaceId,
      );
      if (
        !consumerPolicy.systemEnabled ||
        !consumerPolicy.workspaceEnabled ||
        !consumerPolicy.templatesEnabled ||
        !consumerPolicy.allowLiveEmbed ||
        !consumerPolicy.allowPublicLiveEmbed
      ) {
        return {
          items: sourcePageIds.map((sourcePageId) => ({
            kind: 'page',
            sourcePageId,
            status: 'disabled',
          })),
        };
      }
    }
    const pageById = new Map<string, Page>();
    await Promise.all(
      unique.map(async (pageId) => {
        if (!accessibleSet.has(pageId)) return;
        const page = await this.pageRepo.findById(pageId, {
          includeContent: true,
        });
        if (page && !page.deletedAt && page.workspaceId === workspaceId) {
          pageById.set(page.id, page);
        }
      }),
    );

    const items: PageEmbedLookup[] = [];
    for (const sourcePageId of sourcePageIds) {
      if (!accessibleSet.has(sourcePageId)) {
        items.push({ kind: 'page', sourcePageId, status: 'no_access' });
        continue;
      }
      const page = pageById.get(sourcePageId);
      if (!page) {
        items.push({ kind: 'page', sourcePageId, status: 'not_found' });
        continue;
      }
      if (consumerSpaceId && page.spaceId !== consumerSpaceId) {
        items.push({ kind: 'page', sourcePageId, status: 'disabled' });
        continue;
      }
      const sourcePolicy = publicShare
        ? await this.policy.resolvePublic(workspaceId, page.spaceId)
        : await this.policy.resolveForUser(
            workspaceId,
            page.spaceId,
            viewer!.id,
          );
      const enabled =
        sourcePolicy.systemEnabled &&
        sourcePolicy.workspaceEnabled &&
        sourcePolicy.templatesEnabled &&
        sourcePolicy.allowLiveEmbed &&
        (!publicShare
          ? sourcePolicy.allowedActions.includes('use_live_embed')
          : sourcePolicy.allowPublicLiveEmbed);
      if (!enabled) {
        items.push({ kind: 'page', sourcePageId, status: 'disabled' });
        continue;
      }
      try {
        const doc = jsonToNode(getProsemirrorContent(page.content));
        const content = removeMarkTypeFromDoc(doc, 'comment').toJSON();
        items.push({
          kind: 'page',
          sourcePageId,
          slugId: page.slugId,
          title: page.title ?? null,
          icon: page.icon ?? null,
          content,
          sourceUpdatedAt: page.updatedAt,
        });
      } catch (error) {
        this.logger.error(
          `Failed to materialize page embed ${sourcePageId}`,
          error as Error,
        );
        items.push({ kind: 'page', sourcePageId, status: 'not_found' });
      }
    }
    return { items };
  }

  async listUsages(sourcePageId: string, viewer: User) {
    const source = await this.pageRepo.findById(sourcePageId);
    if (!source || source.workspaceId !== viewer.workspaceId) {
      return { references: [], hiddenCount: 0, occurrenceCount: 0 };
    }
    await this.requirePageAccess().assertCanReadPage(source, viewer);
    const usages = await this.referencesRepo.findPageUsagesBySource(
      sourcePageId,
      viewer.workspaceId,
    );
    const byPage = new Map<string, number>();
    for (const usage of usages) {
      byPage.set(
        usage.referencePageId,
        (byPage.get(usage.referencePageId) ?? 0) + 1,
      );
    }
    const references: Array<{
      id: string;
      slugId: string;
      title: string | null;
      icon: string | null;
      spaceId: string;
      occurrenceCount: number;
    }> = [];
    let hiddenCount = 0;
    let totalOccurrenceCount = 0;
    for (const [pageId, pageOccurrenceCount] of byPage) {
      const page = await this.pageRepo.findById(pageId);
      if (!page) continue;
      if (page.spaceId !== source.spaceId) continue;
      totalOccurrenceCount += pageOccurrenceCount;
      if (page.deletedAt) {
        hiddenCount += pageOccurrenceCount;
        continue;
      }
      const access = await this.requirePageAccess().getEffectiveAccess(
        page,
        viewer,
      );
      if (!access.capabilities.canRead) {
        hiddenCount += pageOccurrenceCount;
        continue;
      }
      references.push({
        id: page.id,
        slugId: page.slugId,
        title: page.title ?? null,
        icon: page.icon ?? null,
        spaceId: page.spaceId,
        occurrenceCount: pageOccurrenceCount,
      });
    }
    return {
      references,
      hiddenCount,
      occurrenceCount: totalOccurrenceCount,
    };
  }

  async hasIncomingUsages(
    sourcePageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const usages = await this.referencesRepo.findPageUsagesBySource(
      sourcePageId,
      workspaceId,
      trx,
    );
    return usages.length > 0;
  }

  async hasOutgoingUsages(
    referencePageId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const usages = await this.referencesRepo.findPageByReferencePageId(
      referencePageId,
      trx,
    );
    return usages.length > 0;
  }

  private async assertManagedMutation(
    mutationId: string | undefined,
    referencePageId: string,
    additions: Array<{ referenceNodeId: string; sourcePageId: string }>,
    trx: KyselyTransaction,
  ): Promise<void> {
    if (!mutationId) {
      throw this.graphError(
        'page_embed_unmanaged_reference',
        'Page embeds must be inserted through the server action',
      );
    }
    const operation = await trx
      .selectFrom('pageTemplateOperations')
      .select([
        'id',
        'consumerPageId',
        'sourcePageId',
        'referenceNodeId',
        'status',
        'operationKind',
      ])
      .where('id', '=', mutationId)
      .forUpdate()
      .executeTakeFirst();
    const addition = additions[0];
    const isInsert =
      operation?.operationKind === 'embed_insert' &&
      additions.length === 1 &&
      operation.sourcePageId === addition?.sourcePageId &&
      operation.referenceNodeId === addition?.referenceNodeId;
    const isDetachMaterialization = operation?.operationKind === 'embed_detach';
    if (
      !operation ||
      operation.status !== 'pending' ||
      operation.consumerPageId !== referencePageId ||
      (!isInsert && !isDetachMaterialization)
    ) {
      throw this.graphError(
        'page_embed_unmanaged_reference',
        'Page embed mutation is not authorized',
      );
    }
  }

  private async assertSourcesAvailable(
    additions: Array<{ sourcePageId: string }>,
    workspaceId: string,
    referencePageId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    const consumer = await this.pageRepo.findById(referencePageId, { trx });
    if (
      !consumer ||
      consumer.deletedAt ||
      consumer.workspaceId !== workspaceId
    ) {
      throw this.graphError(
        'page_embed_consumer_unavailable',
        'Page embed consumer is unavailable',
      );
    }
    for (const sourcePageId of new Set(
      additions.map((addition) => addition.sourcePageId),
    )) {
      const page = await this.pageRepo.findById(sourcePageId, { trx });
      if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
        throw this.graphError(
          'page_embed_source_unavailable',
          'Page embed source is unavailable',
        );
      }
      if (page.spaceId !== consumer.spaceId) {
        throw this.graphError(
          'page_embed_cross_space',
          'A page cannot embed a page from another space',
        );
      }
    }
  }

  private async assertFencingToken(
    workspaceId: string,
    fencingToken: number,
    trx: KyselyTransaction,
  ): Promise<void> {
    const result = await sql<{ last_token: string }>`
      insert into page_embed_graph_fences (workspace_id, last_token)
      values (${workspaceId}::uuid, ${fencingToken})
      on conflict (workspace_id) do update
        set last_token = excluded.last_token, updated_at = now()
      where page_embed_graph_fences.last_token < excluded.last_token
      returning last_token
    `.execute(trx);
    if (result.rows.length === 0) {
      throw this.graphError(
        'page_embed_graph_lock_lost',
        'A newer page embed graph writer already committed',
      );
    }
  }

  private async filterReadablePageIds(
    pageIds: string[],
    viewer: User,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    for (const pageId of new Set(pageIds)) {
      const page = await this.pageRepo.findById(pageId);
      if (!page || page.deletedAt || page.workspaceId !== viewer.workspaceId) {
        continue;
      }
      const access = await this.requirePageAccess().getEffectiveAccess(
        page,
        viewer,
      );
      if (access.capabilities.canRead) result.add(page.id);
    }
    return result;
  }

  private graphError(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private requirePageAccess(): PageAccessService {
    if (!this.pageAccessService) {
      throw new ForbiddenException('Page access service is unavailable');
    }
    return this.pageAccessService;
  }
}
