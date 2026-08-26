import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectKysely } from 'nestjs-kysely';
import { Kysely, sql } from 'kysely';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AiContextSource,
  AiSpaceContentPolicy,
  PAGE_CUSTOM_FIELD_STATUS,
} from '@docmost/api-contract';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { MAX_PAGE_TREE_DEPTH } from '../../common/config/page-tree.constants';
import { EventName } from '../../common/events/event.contants';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { SearchService } from '../search/search.service';
import { WsGateway } from '../../ws/ws.gateway';
import {
  AiContentPolicyCandidatesQueryDto,
  UpdateAiContentPolicyDto,
} from './dto/ai-content-policy.dto';

type Db = Kysely<any>;

export interface EffectivePolicy {
  revision: number;
  fingerprint: string;
  ragSearchDoneOnly: boolean;
  excludedPageIds: string[];
}

export interface RagSearchPolicy extends EffectivePolicy {
  ragSearchFingerprint: string;
  statusBlockedPageIds: string[];
}

@Injectable()
export class AiContentPolicyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly searchService: SearchService,
    private readonly ws: WsGateway,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async getEffectivePolicy(
    spaceId: string,
    workspaceId: string,
  ): Promise<EffectivePolicy> {
    return this.getEffectivePolicyWithDb(
      this.db as unknown as Db,
      spaceId,
      workspaceId,
    );
  }

  async getExcludedPageIds(
    spaceId: string,
    workspaceId: string,
  ): Promise<Set<string>> {
    return new Set(
      (await this.getEffectivePolicy(spaceId, workspaceId)).excludedPageIds,
    );
  }

  async getRagSearchPolicy(
    spaceId: string,
    workspaceId: string,
  ): Promise<RagSearchPolicy> {
    const db = this.db as unknown as Db;
    const policy = await this.getEffectivePolicyWithDb(
      db,
      spaceId,
      workspaceId,
    );
    const statusBlockedPageIds = policy.ragSearchDoneOnly
      ? (
          await db
            .selectFrom('pages')
            .select('id')
            .where('spaceId', '=', spaceId)
            .where('workspaceId', '=', workspaceId)
            .where('deletedAt', 'is', null)
            .where('templateKind', 'is', null)
            .where(
              sql<boolean>`coalesce(settings ->> 'status', '') <> ${sql.lit(PAGE_CUSTOM_FIELD_STATUS.DONE)}`,
            )
            .orderBy('id', 'asc')
            .execute()
        ).map((page) => page.id)
      : [];

    return {
      ...policy,
      ragSearchFingerprint: this.fingerprint({
        ragSearchDoneOnly: policy.ragSearchDoneOnly,
        excludedPageIds: policy.excludedPageIds,
        statusBlockedPageIds,
      }),
      statusBlockedPageIds,
    };
  }

  async isPageExcluded(
    pageId: string,
    spaceId: string,
    workspaceId: string,
  ): Promise<boolean> {
    return (await this.getExcludedPageIds(spaceId, workspaceId)).has(pageId);
  }

  async getAdminPolicy(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiSpaceContentPolicy> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const db = this.db as unknown as Db;
    const policy = await this.getEffectivePolicyWithDb(
      db,
      spaceId,
      workspace.id,
    );
    const rows = await db
      .selectFrom('aiSpaceContentExclusions as e')
      .innerJoin('pages as p', 'p.id', 'e.pageId')
      .select([
        'e.pageId',
        'e.includeDescendants',
        'p.title',
        'p.icon',
        'p.deletedAt',
      ])
      .where('e.spaceId', '=', spaceId)
      .where('e.workspaceId', '=', workspace.id)
      .orderBy('e.createdAt', 'asc')
      .execute();

    const counts = await this.effectiveCounts(db, spaceId, workspace.id);
    const breadcrumbs = await this.exclusionBreadcrumbs(
      db,
      spaceId,
      workspace.id,
    );
    const policyRow = await db
      .selectFrom('aiSpaceContentPolicies')
      .select(['updatedAt'])
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    return {
      spaceId,
      revision: policy.revision,
      fingerprint: policy.fingerprint,
      ragSearchDoneOnly: policy.ragSearchDoneOnly,
      exclusions: rows.map((row) => ({
        pageId: row.pageId,
        title: row.title?.trim() || '',
        icon: row.icon ?? null,
        breadcrumbs: breadcrumbs.get(row.pageId) ?? [],
        includeDescendants: row.includeDescendants,
        effectivePageCount: counts.get(row.pageId) ?? 1,
        available: !row.deletedAt,
      })),
      updatedAt: policyRow?.updatedAt?.toISOString() ?? null,
    };
  }

  async updatePolicy(
    spaceId: string,
    dto: UpdateAiContentPolicyDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiSpaceContentPolicy> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const normalized = this.normalizeExclusions(dto);
    const db = this.db as unknown as Db;
    const updated = await db.transaction().execute(async (trx) => {
      const pages =
        normalized.length > 0
          ? await trx
              .selectFrom('pages as p')
              .leftJoin('databases as d', (join) =>
                join
                  .onRef('d.pageId', '=', 'p.id')
                  .on('d.deletedAt', 'is', null),
              )
              .leftJoin('databaseRows as r', (join) =>
                join
                  .onRef('r.pageId', '=', 'p.id')
                  .on('r.archivedAt', 'is', null),
              )
              .select(['p.id', 'd.id as databaseId', 'r.id as databaseRowId'])
              .where(
                'p.id',
                'in',
                normalized.map((item) => item.pageId),
              )
              .where('p.spaceId', '=', spaceId)
              .where('p.workspaceId', '=', workspace.id)
              .where('p.deletedAt', 'is', null)
              .execute()
          : [];
      if (
        pages.length !== normalized.length ||
        pages.some((page) => page.databaseId || page.databaseRowId)
      ) {
        throw new BadRequestException({
          code: 'ai_context_descendant_invalid',
          message: 'AI exclusions accept document pages only',
        });
      }

      await trx
        .insertInto('aiSpaceContentPolicies')
        .values({
          spaceId,
          workspaceId: workspace.id,
          revision: 0,
          fingerprint: this.fingerprint([]),
          ragSearchDoneOnly: false,
        })
        .onConflict((oc) => oc.column('spaceId').doNothing())
        .execute();
      const locked = await trx
        .selectFrom('aiSpaceContentPolicies')
        .selectAll()
        .where('spaceId', '=', spaceId)
        .where('workspaceId', '=', workspace.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.revision !== dto.expectedRevision) {
        throw new ConflictException({
          code: 'ai_context_revision_conflict',
          message: 'AI content policy was updated elsewhere',
        });
      }

      await trx
        .deleteFrom('aiSpaceContentExclusions')
        .where('spaceId', '=', spaceId)
        .execute();
      if (normalized.length > 0) {
        await trx
          .insertInto('aiSpaceContentExclusions')
          .values(
            normalized.map((item) => ({
              spaceId,
              workspaceId: workspace.id,
              pageId: item.pageId,
              includeDescendants: item.includeDescendants,
            })),
          )
          .execute();
      }

      const effective = await this.getEffectivePolicyWithDb(
        trx,
        spaceId,
        workspace.id,
      );
      const revision = locked.revision + 1;
      await trx
        .updateTable('aiSpaceContentPolicies')
        .set({
          revision,
          fingerprint: effective.fingerprint,
          ragSearchDoneOnly: dto.ragSearchDoneOnly,
          updatedAt: new Date(),
        })
        .where('spaceId', '=', spaceId)
        .execute();
      await this.reconcileConversations(
        trx,
        spaceId,
        workspace.id,
        new Set(effective.excludedPageIds),
        effective.fingerprint,
      );
      return { revision, fingerprint: effective.fingerprint };
    });

    this.ws.server?.to(`space-${spaceId}`).emit('ai:content-policy.updated', {
      spaceId,
      revision: updated.revision,
      fingerprint: updated.fingerprint,
    });
    this.eventEmitter?.emit(EventName.RAG_SYNC_SCOPE_CHANGED, {
      workspaceId: workspace.id,
      spaceId,
    });
    return this.getAdminPolicy(spaceId, user, workspace);
  }

  async searchCandidates(
    spaceId: string,
    query: AiContentPolicyCandidatesQueryDto,
    user: User,
    workspace: Workspace,
  ) {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const result = await this.searchService.searchPage(
      {
        query: query.query.trim(),
        spaceId,
        limit: Math.min(51, query.limit + 1),
        offset: query.cursor,
      },
      { userId: user.id, workspaceId: workspace.id },
    );
    const db = this.db as unknown as Db;
    const pageIds = result.items.map((item) => item.id);
    const nonDocuments =
      pageIds.length > 0
        ? await db
            .selectFrom('pages as p')
            .leftJoin('databases as d', (join) =>
              join.onRef('d.pageId', '=', 'p.id').on('d.deletedAt', 'is', null),
            )
            .leftJoin('databaseRows as r', (join) =>
              join
                .onRef('r.pageId', '=', 'p.id')
                .on('r.archivedAt', 'is', null),
            )
            .select(['p.id', 'd.id as databaseId', 'r.id as databaseRowId'])
            .where('p.id', 'in', pageIds)
            .execute()
        : [];
    const blocked = new Set(
      nonDocuments
        .filter((item) => item.databaseId || item.databaseRowId)
        .map((item) => item.id),
    );
    const rows = result.items.filter((item) => !blocked.has(item.id));
    const parentRows =
      rows.length > 0
        ? await db
            .selectFrom('pages')
            .select(['parentPageId'])
            .where(
              'parentPageId',
              'in',
              rows.map((item) => item.id),
            )
            .where('deletedAt', 'is', null)
            .execute()
        : [];
    const rootsWithChildren = new Set(
      parentRows.map((item) => item.parentPageId).filter(Boolean),
    );
    const items: AiContextSource[] = rows
      .slice(0, query.limit)
      .map((row, i) => ({
        id: `page:${row.id}`,
        sourceType: 'page',
        sourceId: row.id,
        pageId: row.id,
        title: row.title?.trim() || '',
        icon: row.icon ?? null,
        breadcrumbs: (row.breadcrumbs ?? []).map((item) => item.title),
        url: null,
        position: i,
        available: true,
        hasChildren: rootsWithChildren.has(row.id),
        descendants: { mode: 'none', pageIds: [] },
      }));
    return {
      items,
      hasMore: rows.length > query.limit,
      nextCursor:
        rows.length > query.limit ? String(query.cursor + query.limit) : null,
    };
  }

  private normalizeExclusions(dto: UpdateAiContentPolicyDto) {
    const unique = new Map<
      string,
      { pageId: string; includeDescendants: boolean }
    >();
    for (const item of dto.exclusions) {
      unique.set(item.pageId, {
        pageId: item.pageId,
        includeDescendants: item.includeDescendants,
      });
    }
    if (unique.size > 100) {
      throw new BadRequestException('Too many AI content exclusions');
    }
    return [...unique.values()];
  }

  private async getEffectivePolicyWithDb(
    db: Db,
    spaceId: string,
    workspaceId: string,
  ): Promise<EffectivePolicy> {
    const rows = await sql<{ id: string }>`
      with recursive excluded_pages as (
        select e.page_id as id, e.include_descendants as recurse, 0 as level
        from ai_space_content_exclusions e
        where e.space_id = ${spaceId} and e.workspace_id = ${workspaceId}
        union
        select p.id, true as recurse, ep.level + 1
        from pages p
        join excluded_pages ep on ep.id = p.parent_page_id
        where ep.recurse = true
          and ep.level < ${MAX_PAGE_TREE_DEPTH}
          and p.space_id = ${spaceId}
          and p.workspace_id = ${workspaceId}
      )
      select distinct id from excluded_pages order by id
    `.execute(db);
    const excludedPageIds = rows.rows.map((row) => row.id);
    const policy = await db
      .selectFrom('aiSpaceContentPolicies')
      .select(['revision', 'ragSearchDoneOnly'])
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    return {
      revision: policy?.revision ?? 0,
      fingerprint: this.fingerprint(excludedPageIds),
      ragSearchDoneOnly: policy?.ragSearchDoneOnly ?? false,
      excludedPageIds,
    };
  }

  private async effectiveCounts(
    db: Db,
    spaceId: string,
    workspaceId: string,
  ): Promise<Map<string, number>> {
    const rows = await sql<{ root_id: string; count: string }>`
      with recursive exclusion_tree as (
        select e.page_id as root_id, e.page_id as id,
          e.include_descendants as recurse, 0 as level
        from ai_space_content_exclusions e
        where e.space_id = ${spaceId} and e.workspace_id = ${workspaceId}
        union all
        select et.root_id, p.id, true, et.level + 1
        from pages p
        join exclusion_tree et on et.id = p.parent_page_id
        where et.recurse = true
          and et.level < ${MAX_PAGE_TREE_DEPTH}
          and p.space_id = ${spaceId}
          and p.workspace_id = ${workspaceId}
      )
      select root_id, count(distinct id)::text as count
      from exclusion_tree group by root_id
    `.execute(db);
    return new Map(rows.rows.map((row) => [row.root_id, Number(row.count)]));
  }

  private async exclusionBreadcrumbs(
    db: Db,
    spaceId: string,
    workspaceId: string,
  ): Promise<Map<string, string[]>> {
    const rows = await sql<{
      leaf_id: string;
      title: string;
      level: number;
    }>`
      with recursive ancestors as (
        select e.page_id as leaf_id, p.parent_page_id, p.title, 0 as level
        from ai_space_content_exclusions e
        join pages p on p.id = e.page_id
        where e.space_id = ${spaceId} and e.workspace_id = ${workspaceId}
        union all
        select a.leaf_id, p.parent_page_id, p.title, a.level + 1
        from pages p
        join ancestors a on a.parent_page_id = p.id
        where a.level < ${MAX_PAGE_TREE_DEPTH}
          and p.space_id = ${spaceId}
          and p.workspace_id = ${workspaceId}
      )
      select leaf_id, title, level
      from ancestors
      where level > 0
      order by leaf_id, level desc
    `.execute(db);
    const result = new Map<string, string[]>();
    for (const row of rows.rows) {
      const titles = result.get(row.leaf_id) ?? [];
      titles.push(row.title?.trim() || '');
      result.set(row.leaf_id, titles);
    }
    return result;
  }

  private async reconcileConversations(
    db: Db,
    spaceId: string,
    workspaceId: string,
    excluded: Set<string>,
    policyFingerprint: string,
  ): Promise<void> {
    if (excluded.size === 0) return;
    const pageIds = [...excluded];
    const ancestorRows = await sql<{ id: string }>`
      with recursive ancestors as (
        select id, parent_page_id, 0 as level
        from pages
        where id in (${sql.join(pageIds)})
        union
        select p.id, p.parent_page_id, a.level + 1
        from pages p
        join ancestors a on a.parent_page_id = p.id
        where a.level < ${MAX_PAGE_TREE_DEPTH}
          and p.space_id = ${spaceId}
          and p.workspace_id = ${workspaceId}
      )
      select distinct id from ancestors
    `.execute(db);
    const ancestorIds = new Set(ancestorRows.rows.map((row) => row.id));
    const sourceRows = await db
      .selectFrom('aiConversationContextSources as s')
      .innerJoin('aiConversations as c', 'c.id', 's.conversationId')
      .select([
        's.id',
        's.conversationId',
        's.pageId',
        's.descendantMode',
        's.selectedDescendantPageIds',
      ])
      .where('c.spaceId', '=', spaceId)
      .where('c.workspaceId', '=', workspaceId)
      .execute();
    const dependencies = await db
      .selectFrom('aiRunSourceDependencies as d')
      .innerJoin('aiRuns as r', 'r.id', 'd.runId')
      .select(['r.conversationId'])
      .where('d.pageId', 'in', pageIds)
      .where('r.spaceId', '=', spaceId)
      .where('r.workspaceId', '=', workspaceId)
      .execute();
    const current = await db
      .selectFrom('aiConversations')
      .select([
        'id',
        'pageId',
        'currentDocumentDescendantMode',
        'currentDocumentSelectedPageIds',
      ])
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .execute();
    const sourceAffected = sourceRows.filter(
      (row) =>
        excluded.has(row.pageId) ||
        (row.descendantMode === 'all' && ancestorIds.has(row.pageId)) ||
        row.selectedDescendantPageIds.some((pageId: string) =>
          excluded.has(pageId),
        ),
    );
    const currentAffected = current.filter(
      (row) =>
        excluded.has(row.pageId) ||
        (row.currentDocumentDescendantMode === 'all' &&
          ancestorIds.has(row.pageId)) ||
        row.currentDocumentSelectedPageIds.some((pageId: string) =>
          excluded.has(pageId),
        ),
    );
    const affected = new Set([
      ...sourceAffected.map((row) => row.conversationId),
      ...dependencies.map((row) => row.conversationId),
      ...currentAffected.map((row) => row.id),
    ]);
    if (affected.size === 0) return;
    await db
      .deleteFrom('aiConversationContextSources')
      .where('conversationId', 'in', [...affected])
      .where('pageId', 'in', pageIds)
      .execute();
    for (const conversationId of affected) {
      const conversation = await db
        .selectFrom('aiConversations')
        .select([
          'id',
          'pageId',
          'contextRevision',
          'contextFingerprint',
          'currentDocumentSelectedPageIds',
        ])
        .where('id', '=', conversationId)
        .executeTakeFirst();
      if (!conversation) continue;
      const currentSelected =
        conversation.currentDocumentSelectedPageIds.filter(
          (pageId: string) => !excluded.has(pageId),
        );
      const update: Record<string, unknown> = {
        currentDocumentSelectedPageIds: currentSelected,
        contextRevision: conversation.contextRevision + 1,
        contextFingerprint: this.fingerprint([
          conversation.contextFingerprint,
          policyFingerprint,
        ]),
        promptHistoryCutoffAt: new Date(),
        updatedAt: new Date(),
      };
      if (excluded.has(conversation.pageId)) {
        update.includeCurrentDocument = false;
        update.currentDocumentDescendantMode = 'none';
      }
      await db
        .updateTable('aiConversations')
        .set(update)
        .where('id', '=', conversationId)
        .execute();
    }
    const remainingSourceRows = await db
      .selectFrom('aiConversationContextSources')
      .select(['id', 'selectedDescendantPageIds'])
      .where('conversationId', 'in', [...affected])
      .execute();
    for (const row of remainingSourceRows) {
      await db
        .updateTable('aiConversationContextSources')
        .set({
          selectedDescendantPageIds: row.selectedDescendantPageIds.filter(
            (pageId: string) => !excluded.has(pageId),
          ),
          updatedAt: new Date(),
        })
        .where('id', '=', row.id)
        .execute();
    }
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
