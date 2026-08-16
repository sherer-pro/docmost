import { Injectable } from '@nestjs/common';
import {
  BUILT_IN_SEARCH_TAGS,
  SearchDTO,
  SearchSuggestionDTO,
  type BuiltInSearchTag,
} from './dto/search.dto';
import {
  AttachmentSearchResponseDto,
  SearchBreadcrumbDto,
  SearchContentKind,
  SearchResponseDto,
  SearchTagFacetDto,
} from './dto/search-response.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { LabelType } from '@docmost/db/repos/label/label.repo';
import { User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import {
  PageAccessService,
  SidebarAccessSnapshot,
} from '../page-access/page-access.service';
import { ShareService } from '../share/share.service';
import { buildTagSearchMetadata } from './tag-search.utils';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

// `pg-tsquery` keeps characters it does not recognize as operators inside the
// tokens it emits. `f_unaccent` then expands some of them into tsquery
// structure - guillemets become `<<` and `>>`, for example - and `to_tsquery`
// raises a syntax error for the whole request. Keep word characters, marks and
// the operators `pg-tsquery` understands, and drop everything else.
const UNSAFE_SEARCH_QUERY_CHARS = /[^\p{L}\p{M}\p{Nd}_\s&|!()"'+,\-*]/gu;

export function buildSearchTsQuery(rawQuery: string): string | undefined {
  const normalized = rawQuery.replace(UNSAFE_SEARCH_QUERY_CHARS, ' ').trim();
  if (!normalized) return undefined;
  const searchQuery = tsquery(normalized + '*');
  return typeof searchQuery === 'string' && searchQuery.trim().length > 0
    ? searchQuery
    : undefined;
}

interface SearchAncestorRow {
  id: string;
  title: string | null;
  icon: string | null;
  slugId: string;
  parentPageId: string | null;
  spaceId: string;
}

const DEFAULT_SEARCH_LIMIT = 25;
const MAX_SEARCH_FETCH_BATCH = 100;
const TAG_FACET_FETCH_BATCH = 1_000;
const HIGHLIGHT_START = '__DOCMOST_TS_HIGHLIGHT_START_8C527D__';
const HIGHLIGHT_END = '__DOCMOST_TS_HIGHLIGHT_END_8C527D__';
const TS_HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MinWords=9, MaxWords=10, MaxFragments=3`;
const ATTACHMENT_TS_HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MinWords=9, MaxWords=18, MaxFragments=3`;

@Injectable()
export class SearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private pageRepo: PageRepo,
    private shareRepo: ShareRepo,
    private spaceMemberRepo: SpaceMemberRepo,
    private userRepo: UserRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly shareService: ShareService,
  ) {}

  private normalizeSearchHighlights<T extends { highlight?: string | null }>(
    searchResults: T[],
  ): T[] {
    return searchResults.map((result) => {
      if (!result.highlight) {
        return result;
      }

      const normalized = result.highlight
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\s+/g, ' ');
      const escaped = this.escapeHtml(normalized);

      return {
        ...result,
        // Escape the source fragment first, then restore only the private
        // ts_headline selection markers as the Typesense-compatible contract.
        highlight: escaped
          .replaceAll(HIGHLIGHT_START, '<mark>')
          .replaceAll(HIGHLIGHT_END, '</mark>'),
      };
    });
  }

  private getSelectedTags(searchParams: SearchDTO): string[] {
    return [
      ...new Set([
        ...(searchParams.tags ?? []),
        ...(searchParams.tag ? [searchParams.tag] : []),
      ]),
    ];
  }

  private attachTagMetadata(
    searchResults: SearchResponseDto[],
    tags: readonly string[],
  ): SearchResponseDto[] {
    return searchResults.map((searchResult) => {
      const { content, ...result } = searchResult as SearchResponseDto & {
        content?: unknown;
      };

      return {
        ...result,
        ...buildTagSearchMetadata(content, tags),
      };
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  projectPublicShareResults(
    searchResults: SearchResponseDto[],
  ): SearchResponseDto[] {
    return searchResults.map((result) => {
      const { id, slugId, title, icon, rank, highlight } = result;
      return {
        id,
        slugId,
        title,
        icon,
        rank,
        highlight,
      } as unknown as SearchResponseDto;
    });
  }

  private async buildSpaceAccessSnapshotMap(
    user: User,
    searchResults: Array<{ space?: { id?: string | null } | null }>,
    snapshotBySpaceId = new Map<string, SidebarAccessSnapshot>(),
  ): Promise<Map<string, SidebarAccessSnapshot>> {
    return this.buildSpaceAccessSnapshotMapForSpaceIds(
      user,
      searchResults
        .map((result) => result.space?.id)
        .filter((spaceId): spaceId is string => !!spaceId),
      snapshotBySpaceId,
    );
  }

  private async buildSpaceAccessSnapshotMapForSpaceIds(
    user: User,
    spaceIdsToLoad: Array<string | null | undefined>,
    snapshotBySpaceId = new Map<string, SidebarAccessSnapshot>(),
  ): Promise<Map<string, SidebarAccessSnapshot>> {
    const spaceIds = [
      ...new Set(
        spaceIdsToLoad.filter(
          (spaceId): spaceId is string =>
            !!spaceId && !snapshotBySpaceId.has(spaceId),
        ),
      ),
    ];

    if (spaceIds.length === 0) {
      return snapshotBySpaceId;
    }

    const entries = await Promise.all(
      spaceIds.map(async (spaceId) => {
        const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
          user,
          spaceId,
        );
        return [spaceId, snapshot] as const;
      }),
    );

    entries.forEach(([spaceId, snapshot]) => {
      snapshotBySpaceId.set(spaceId, snapshot);
    });

    return snapshotBySpaceId;
  }

  private getSearchFetchBatchSize(limit: number): number {
    return Math.min(MAX_SEARCH_FETCH_BATCH, Math.max(limit * 3, limit));
  }

  private filterReadableResults(
    searchResults: SearchResponseDto[],
    snapshotBySpaceId: Map<string, SidebarAccessSnapshot>,
  ): SearchResponseDto[] {
    return searchResults.filter((result) => {
      const spaceId = result.space?.id;
      if (!spaceId) {
        return false;
      }

      const snapshot = snapshotBySpaceId.get(spaceId);
      return snapshot?.readablePageIds.has(result.id) ?? false;
    });
  }

  private filterReadableAttachmentResults(
    searchResults: AttachmentSearchResponseDto[],
    snapshotBySpaceId: Map<string, SidebarAccessSnapshot>,
  ): AttachmentSearchResponseDto[] {
    return searchResults.filter((result) => {
      const spaceId = result.space?.id;
      const pageId = result.page?.id ?? result.pageId;
      if (!spaceId || !pageId) {
        return false;
      }

      const snapshot = snapshotBySpaceId.get(spaceId);
      return snapshot?.readablePageIds.has(pageId) ?? false;
    });
  }

  private buildVisiblePageIdsMap(
    snapshotBySpaceId: Map<string, SidebarAccessSnapshot>,
  ): Map<string, Set<string>> {
    return new Map(
      [...snapshotBySpaceId.entries()].map(([spaceId, snapshot]) => [
        spaceId,
        snapshot.visiblePageIds,
      ]),
    );
  }

  private async collectAncestorRows(
    parentPageIds: Array<string | null | undefined>,
  ): Promise<Map<string, SearchAncestorRow>> {
    const ancestorsById = new Map<string, SearchAncestorRow>();
    const visitedPageIds = new Set<string>();
    let frontier = new Set(
      parentPageIds.filter((pageId): pageId is string => !!pageId),
    );

    while (frontier.size > 0) {
      const idsToLoad = [...frontier].filter(
        (pageId) => !visitedPageIds.has(pageId),
      );

      frontier = new Set();

      if (idsToLoad.length === 0) {
        continue;
      }

      idsToLoad.forEach((pageId) => visitedPageIds.add(pageId));

      const rows = await this.db
        .selectFrom('pages')
        .select(['id', 'title', 'icon', 'slugId', 'parentPageId', 'spaceId'])
        .where('id', 'in', idsToLoad)
        .where('deletedAt', 'is', null)
        .execute();

      rows.forEach((row) => {
        ancestorsById.set(row.id, row);

        if (row.parentPageId && !visitedPageIds.has(row.parentPageId)) {
          frontier.add(row.parentPageId);
        }
      });
    }

    return ancestorsById;
  }

  private buildBreadcrumbsForResult(
    result: SearchResponseDto,
    ancestorsById: Map<string, SearchAncestorRow>,
    visiblePageIdsBySpaceId?: Map<string, Set<string>>,
  ): SearchBreadcrumbDto[] {
    const breadcrumbs: SearchBreadcrumbDto[] = [];
    const visiblePageIds =
      visiblePageIdsBySpaceId && result.space?.id
        ? visiblePageIdsBySpaceId.get(result.space.id)
        : undefined;

    const seenPageIds = new Set<string>();
    let cursor = result.parentPageId as string | null | undefined;

    while (cursor && !seenPageIds.has(cursor)) {
      seenPageIds.add(cursor);

      const ancestor = ancestorsById.get(cursor);
      if (!ancestor) {
        break;
      }

      if (!visiblePageIds || visiblePageIds.has(ancestor.id)) {
        breadcrumbs.push({
          id: ancestor.id,
          title: ancestor.title?.trim() ? ancestor.title : 'Untitled',
        });
      }

      cursor = ancestor.parentPageId;
    }

    return breadcrumbs.reverse();
  }

  async attachBreadcrumbsToResults(
    searchResults: SearchResponseDto[],
    visiblePageIdsBySpaceId?: Map<string, Set<string>>,
  ): Promise<SearchResponseDto[]> {
    if (searchResults.length === 0) {
      return searchResults;
    }

    const ancestorsById = await this.collectAncestorRows(
      searchResults.map((result) => result.parentPageId),
    );

    return searchResults.map((result) => ({
      ...result,
      breadcrumbs: this.buildBreadcrumbsForResult(
        result,
        ancestorsById,
        visiblePageIdsBySpaceId,
      ),
    }));
  }

  async searchPage(
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
      excludedPageIds?: ReadonlySet<string>;
    },
  ): Promise<{ items: SearchResponseDto[] }> {
    const { labelId } = searchParams;
    const tags = this.getSelectedTags(searchParams);
    const query = searchParams.query?.trim() ?? '';
    const searchQuery = query ? buildSearchTsQuery(query) : undefined;
    const hasTextQuery = searchQuery !== undefined;

    if (!hasTextQuery && !labelId && tags.length === 0) {
      return { items: [] };
    }

    const rankExpression = hasTextQuery
      ? sql<number>`ts_rank(tsv, to_tsquery('english', f_unaccent(${searchQuery})))`
      : sql<number>`0`;
    const highlightExpression = hasTextQuery
      ? sql<string>`ts_headline('english', text_content, to_tsquery('english', f_unaccent(${searchQuery})), ${TS_HEADLINE_OPTIONS})`
      : sql<string>`${''}`;

    let queryResults = this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'parentPageId',
        'creatorId',
        'createdAt',
        'updatedAt',
        rankExpression.as('rank'),
        highlightExpression.as('highlight'),
        sql<SearchContentKind>`
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM databases AS search_database
              WHERE search_database.page_id = pages.id
                AND search_database.deleted_at IS NULL
            ) THEN 'database'
            WHEN EXISTS (
              SELECT 1
              FROM database_rows AS search_database_row
              WHERE search_database_row.page_id = pages.id
                AND search_database_row.archived_at IS NULL
            ) THEN 'databaseRow'
            ELSE 'page'
          END
        `.as('contentKind'),
      ])
      .select((eb) => this.pageRepo.withDatabaseId(eb))
      .$if(tags.length > 0, (qb) => qb.select('content'))
      .$if(Boolean(searchParams.creatorId), (qb) =>
        qb.where('creatorId', '=', searchParams.creatorId),
      )
      .where('deletedAt', 'is', null)
      .where('templateKind', 'is', null);

    if (hasTextQuery) {
      queryResults = queryResults.where(
        'tsv',
        '@@',
        sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`,
      );
    }

    if (labelId) {
      queryResults = queryResults
        .select((eb) =>
          jsonArrayFrom(
            eb
              .selectFrom('labels')
              .innerJoin(
                'pageLabels as matchingPageLabels',
                'matchingPageLabels.labelId',
                'labels.id',
              )
              .select([
                'labels.id',
                'labels.name',
                'labels.spaceId',
                'labels.type',
              ])
              .whereRef('matchingPageLabels.pageId', '=', 'pages.id')
              .where('labels.id', '=', labelId)
              .where('labels.workspaceId', '=', opts.workspaceId)
              .whereRef('labels.spaceId', '=', 'pages.spaceId')
              .where('labels.type', '=', LabelType.PAGE),
          ).as('labels'),
        )
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('pageLabels as labelFilter')
              .innerJoin(
                'labels as labelFilterLabels',
                'labelFilterLabels.id',
                'labelFilter.labelId',
              )
              .select('labelFilter.id')
              .whereRef('labelFilter.pageId', '=', 'pages.id')
              .where('labelFilter.labelId', '=', labelId)
              .where('labelFilterLabels.workspaceId', '=', opts.workspaceId)
              .whereRef('labelFilterLabels.spaceId', '=', 'pages.spaceId')
              .where('labelFilterLabels.type', '=', LabelType.PAGE),
          ),
        )
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('databaseRows')
                .select('databaseRows.id')
                .whereRef('databaseRows.pageId', '=', 'pages.id')
                .where('databaseRows.archivedAt', 'is', null),
            ),
          ),
        );
    }

    if (tags.length > 0) {
      queryResults = queryResults.where(
        sql<boolean>`${sql.ref('pages.tagValues')} && ${tags}::text[]`,
      );
      queryResults = queryResults.where(
        sql<boolean>`NOT EXISTS (
          SELECT 1
          FROM database_rows AS archived_search_row
          WHERE archived_search_row.page_id = pages.id
            AND archived_search_row.archived_at IS NOT NULL
        )`,
      );
    }

    if (!searchParams.shareId) {
      queryResults = queryResults.select((eb) => this.pageRepo.withSpace(eb));
    }

    if (searchParams.spaceId) {
      // search by spaceId
      queryResults = queryResults.where('spaceId', '=', searchParams.spaceId);
    } else if (opts.userId && !searchParams.spaceId) {
      // only search spaces the user is a member of
      queryResults = queryResults
        .where(
          'spaceId',
          'in',
          this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId),
        )
        .where('workspaceId', '=', opts.workspaceId);
    } else if (searchParams.shareId && !searchParams.spaceId && !opts.userId) {
      // search in shares
      const shareId = searchParams.shareId;
      const share = await this.shareRepo.findById(shareId);
      if (!share || share.workspaceId !== opts.workspaceId) {
        return { items: [] };
      }

      // Every other public share surface gates on this; without it, disabling
      // public sharing still leaves titles and content snippets searchable.
      const sharingAllowed = await this.shareService.isSharingAllowed(
        share.workspaceId,
        share.spaceId,
      );
      if (!sharingAllowed) {
        return { items: [] };
      }

      const pageIdsToSearch = [];
      if (share.includeSubPages) {
        const pageList = await this.pageRepo.getPageAndDescendants(
          share.pageId,
          {
            includeContent: false,
          },
        );

        pageIdsToSearch.push(...pageList.map((page) => page.id));
      } else {
        pageIdsToSearch.push(share.pageId);
      }

      if (pageIdsToSearch.length > 0) {
        queryResults = queryResults
          .where('id', 'in', pageIdsToSearch)
          .where('workspaceId', '=', opts.workspaceId);
      } else {
        return { items: [] };
      }
    } else {
      return { items: [] };
    }

    if (hasTextQuery) {
      queryResults = queryResults
        .orderBy('rank', 'desc')
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');
    } else {
      queryResults = queryResults
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');
    }

    if (opts.userId) {
      const authUser = await this.userRepo.findById(
        opts.userId,
        opts.workspaceId,
      );

      if (!authUser) {
        return { items: [] };
      }

      const limit = searchParams.limit || DEFAULT_SEARCH_LIMIT;
      const offset = searchParams.offset || 0;
      const fetchBatchSize = this.getSearchFetchBatchSize(limit);
      const snapshotBySpaceId = new Map<string, SidebarAccessSnapshot>();
      const searchResults: SearchResponseDto[] = [];
      let rawOffset = 0;
      let readableRowsToSkip = offset;

      while (searchResults.length < limit) {
        const rawBatch = await queryResults
          .limit(fetchBatchSize)
          .offset(rawOffset)
          .execute();

        if (rawBatch.length === 0) {
          break;
        }

        const normalizedBatch = this.normalizeSearchHighlights(
          rawBatch as unknown as SearchResponseDto[],
        );

        await this.buildSpaceAccessSnapshotMap(
          authUser,
          normalizedBatch,
          snapshotBySpaceId,
        );

        const readableBatch = this.filterReadableResults(
          normalizedBatch,
          snapshotBySpaceId,
        ).filter((result) => !opts.excludedPageIds?.has(result.id));

        for (const result of readableBatch) {
          if (readableRowsToSkip > 0) {
            readableRowsToSkip -= 1;
            continue;
          }

          searchResults.push(result);

          if (searchResults.length >= limit) {
            break;
          }
        }

        if (rawBatch.length < fetchBatchSize) {
          break;
        }

        rawOffset += rawBatch.length;
      }

      const visiblePageIdsBySpaceId =
        this.buildVisiblePageIdsMap(snapshotBySpaceId);

      const searchResultsWithTagMetadata = this.attachTagMetadata(
        searchResults,
        tags,
      );
      const searchResultsWithBreadcrumbs =
        await this.attachBreadcrumbsToResults(
          searchResultsWithTagMetadata,
          visiblePageIdsBySpaceId,
        );

      return { items: searchResultsWithBreadcrumbs };
    } else {
      const rawResults = await queryResults
        .limit(searchParams.limit || DEFAULT_SEARCH_LIMIT)
        .offset(searchParams.offset || 0)
        .execute();
      const searchResults = this.attachTagMetadata(
        this.normalizeSearchHighlights(
          rawResults as unknown as SearchResponseDto[],
        ).filter((result) => !opts.excludedPageIds?.has(result.id)),
        tags,
      );
      const searchResultsWithBreadcrumbs =
        await this.attachBreadcrumbsToResults(searchResults);

      return {
        items: this.projectPublicShareResults(searchResultsWithBreadcrumbs),
      };
    }
  }

  async getTagFacets(
    searchParams: { spaceId?: string },
    opts: { userId: string; workspaceId: string },
  ): Promise<{ items: SearchTagFacetDto[] }> {
    const authUser = await this.userRepo.findById(
      opts.userId,
      opts.workspaceId,
    );
    if (!authUser) {
      return { items: [] };
    }

    const counts = new Map<BuiltInSearchTag, number>(
      BUILT_IN_SEARCH_TAGS.map((tag) => [tag, 0]),
    );
    const snapshotBySpaceId = new Map<string, SidebarAccessSnapshot>();
    let lastId: string | undefined;

    while (true) {
      let candidates = this.db
        .selectFrom('pages')
        .select(['id', 'spaceId', 'tagValues'])
        .where('workspaceId', '=', opts.workspaceId)
        .where('deletedAt', 'is', null)
        .where('templateKind', 'is', null)
        .where(
          sql<boolean>`${sql.ref('pages.tagValues')} && ${BUILT_IN_SEARCH_TAGS}::text[]`,
        )
        .where(
          sql<boolean>`NOT EXISTS (
            SELECT 1
            FROM database_rows AS archived_facet_row
            WHERE archived_facet_row.page_id = pages.id
              AND archived_facet_row.archived_at IS NOT NULL
          )`,
        );

      if (searchParams.spaceId) {
        candidates = candidates.where('spaceId', '=', searchParams.spaceId);
      } else {
        candidates = candidates.where(
          'spaceId',
          'in',
          this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId),
        );
      }
      if (lastId) {
        candidates = candidates.where('id', '>', lastId);
      }

      const batch = await candidates
        .orderBy('id', 'asc')
        .limit(TAG_FACET_FETCH_BATCH)
        .execute();
      if (batch.length === 0) {
        break;
      }

      await this.buildSpaceAccessSnapshotMapForSpaceIds(
        authUser,
        batch.map((row) => row.spaceId),
        snapshotBySpaceId,
      );

      batch.forEach((row) => {
        const snapshot = snapshotBySpaceId.get(row.spaceId);
        if (!snapshot?.readablePageIds.has(row.id)) {
          return;
        }

        BUILT_IN_SEARCH_TAGS.forEach((tag) => {
          if (row.tagValues.includes(tag)) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        });
      });

      lastId = batch[batch.length - 1].id;
      if (batch.length < TAG_FACET_FETCH_BATCH) {
        break;
      }
    }

    return {
      items: BUILT_IN_SEARCH_TAGS.map((value) => ({
        value,
        documentCount: counts.get(value) ?? 0,
      })).filter((item) => item.documentCount > 0),
    };
  }

  async searchAttachments(
    searchParams: SearchDTO,
    opts: {
      userId: string;
      workspaceId: string;
    },
  ): Promise<{ items: AttachmentSearchResponseDto[] }> {
    const query = searchParams.query?.trim() ?? '';
    const searchQuery = query ? buildSearchTsQuery(query) : undefined;

    if (!searchQuery) {
      return { items: [] };
    }

    const textQuery = sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`;

    let queryResults = this.db
      .selectFrom('attachments')
      .innerJoin('pages', 'pages.id', 'attachments.pageId')
      .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
      .select([
        'attachments.id as id',
        'attachments.fileName as fileName',
        'attachments.pageId as pageId',
        'attachments.creatorId as creatorId',
        'attachments.createdAt as createdAt',
        'attachments.updatedAt as updatedAt',
        sql<number>`ts_rank(attachments.tsv, ${textQuery})`.as('rank'),
        sql<string>`ts_headline(
          'english',
          coalesce(attachments.text_content, ''),
          ${textQuery},
          ${ATTACHMENT_TS_HEADLINE_OPTIONS}
        )`.as('highlight'),
      ])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('spaces')
            .select([
              'spaces.id',
              'spaces.name',
              'spaces.slug',
              'spaces.logo as icon',
            ])
            .whereRef('spaces.id', '=', 'attachments.spaceId'),
        ).as('space'),
        jsonObjectFrom(
          eb
            .selectFrom('pages')
            .select(['pages.id', 'pages.title', 'pages.slugId'])
            .whereRef('pages.id', '=', 'attachments.pageId'),
        ).as('page'),
      ])
      .where('attachments.deletedAt', 'is', null)
      .where('attachments.workspaceId', '=', opts.workspaceId)
      .where('attachments.pageId', 'is not', null)
      .where('attachments.spaceId', 'is not', null)
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .where('attachments.tsv', '@@', textQuery)
      .orderBy('rank', 'desc')
      .orderBy('attachments.fileName', 'asc');

    if (searchParams.spaceId) {
      queryResults = queryResults.where(
        'attachments.spaceId',
        '=',
        searchParams.spaceId,
      );
    } else {
      queryResults = queryResults.where(
        'attachments.spaceId',
        'in',
        this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId),
      );
    }

    const authUser = await this.userRepo.findById(
      opts.userId,
      opts.workspaceId,
    );

    if (!authUser) {
      return { items: [] };
    }

    const limit = searchParams.limit || DEFAULT_SEARCH_LIMIT;
    const offset = searchParams.offset || 0;
    const fetchBatchSize = this.getSearchFetchBatchSize(limit);
    const snapshotBySpaceId = new Map<string, SidebarAccessSnapshot>();
    const searchResults: AttachmentSearchResponseDto[] = [];
    let rawOffset = 0;
    let readableRowsToSkip = offset;

    while (searchResults.length < limit) {
      const rawBatch = await queryResults
        .limit(fetchBatchSize)
        .offset(rawOffset)
        .execute();

      if (rawBatch.length === 0) {
        break;
      }

      const normalizedBatch = this.normalizeSearchHighlights(
        rawBatch as unknown as AttachmentSearchResponseDto[],
      );

      await this.buildSpaceAccessSnapshotMap(
        authUser,
        normalizedBatch,
        snapshotBySpaceId,
      );

      const readableBatch = this.filterReadableAttachmentResults(
        normalizedBatch,
        snapshotBySpaceId,
      );

      for (const result of readableBatch) {
        if (readableRowsToSkip > 0) {
          readableRowsToSkip -= 1;
          continue;
        }

        searchResults.push(result);

        if (searchResults.length >= limit) {
          break;
        }
      }

      if (rawBatch.length < fetchBatchSize) {
        break;
      }

      rawOffset += rawBatch.length;
    }

    return { items: searchResults };
  }

  async searchSuggestions(
    suggestion: SearchSuggestionDTO,
    authUser: User,
    workspaceId: string,
  ) {
    let users = [];
    let groups = [];
    const pages = [];

    const limit = suggestion?.limit || 10;
    const query = suggestion.query.toLowerCase().trim();

    // Build user suggestions through the shared participant directory visibility filter.
    if (suggestion.includeUsers) {
      users = await this.userRepo.getVisibleUsersForSuggestion(
        workspaceId,
        query,
        limit,
        authUser,
      );
    }

    if (suggestion.includeGroups) {
      let groupsQuery = this.db
        .selectFrom('groups')
        .select(['id', 'name', 'description'])
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(groups.name))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('workspaceId', '=', workspaceId);

      // MEMBER can only see groups they belong to.
      if (authUser.role === UserRole.MEMBER) {
        groupsQuery = groupsQuery.where((eb) =>
          eb.exists(
            eb
              .selectFrom('groupUsers')
              .select('groupUsers.groupId')
              .whereRef('groupUsers.groupId', '=', 'groups.id')
              .where('groupUsers.userId', '=', authUser.id),
          ),
        );
      }

      groups = await groupsQuery.limit(limit).execute();
    }

    if (suggestion.includePages) {
      let pageSearch = this.db
        .selectFrom('pages')
        .select(['id', 'slugId', 'title', 'icon', 'spaceId', 'workspaceId'])
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(pages.title))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('deletedAt', 'is', null)
        .where('workspaceId', '=', workspaceId)
        .orderBy('title', 'asc')
        .orderBy('id', 'asc');

      if (suggestion?.spaceId) {
        pageSearch = pageSearch.where('spaceId', '=', suggestion.spaceId);
      } else {
        pageSearch = pageSearch.where((eb) =>
          eb.exists(
            eb
              .selectFrom('spaces')
              .select('spaces.id')
              .whereRef('spaces.id', '=', 'pages.spaceId')
              .where('spaces.archivedAt', 'is', null),
          ),
        );
      }

      const fetchBatchSize = this.getSearchFetchBatchSize(limit);
      const snapshotBySpaceId = new Map<string, SidebarAccessSnapshot>();
      let rawOffset = 0;

      while (pages.length < limit) {
        const candidatePages = await pageSearch
          .limit(fetchBatchSize)
          .offset(rawOffset)
          .execute();

        if (candidatePages.length === 0) {
          break;
        }

        await this.buildSpaceAccessSnapshotMapForSpaceIds(
          authUser,
          candidatePages.map((page) => page.spaceId),
          snapshotBySpaceId,
        );

        for (const page of candidatePages) {
          const snapshot = snapshotBySpaceId.get(page.spaceId);
          if (!snapshot?.readablePageIds.has(page.id)) {
            continue;
          }

          pages.push(page);

          if (pages.length >= limit) {
            break;
          }
        }

        if (candidatePages.length < fetchBatchSize) {
          break;
        }

        rawOffset += candidatePages.length;
      }
    }

    return { users, groups, pages };
  }
}
