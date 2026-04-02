import { Injectable } from '@nestjs/common';
import { SearchDTO, SearchSuggestionDTO } from './dto/search.dto';
import { SearchBreadcrumbDto, SearchResponseDto } from './dto/search-response.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import {
  PageAccessService,
  SidebarAccessSnapshot,
} from '../page-access/page-access.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

interface SearchAncestorRow {
  id: string;
  title: string | null;
  icon: string | null;
  slugId: string;
  parentPageId: string | null;
  spaceId: string;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private pageRepo: PageRepo,
    private shareRepo: ShareRepo,
    private spaceMemberRepo: SpaceMemberRepo,
    private userRepo: UserRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  private normalizeSearchHighlights(
    searchResults: SearchResponseDto[],
  ): SearchResponseDto[] {
    return searchResults.map((result) => {
      if (!result.highlight) {
        return result;
      }

      return {
        ...result,
        highlight: result.highlight
          .replace(/\r\n|\r|\n/g, ' ')
          .replace(/\s+/g, ' '),
      };
    });
  }

  private async buildSpaceAccessSnapshotMap(
    user: User,
    searchResults: SearchResponseDto[],
  ): Promise<Map<string, SidebarAccessSnapshot>> {
    const spaceIds = [...new Set(
      searchResults
        .map((result) => result.space?.id)
        .filter((spaceId): spaceId is string => !!spaceId),
    )];

    if (spaceIds.length === 0) {
      return new Map();
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

    return new Map(entries);
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

  private async attachBreadcrumbsToResults(
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
    },
  ): Promise<{ items: SearchResponseDto[] }> {
    const { query } = searchParams;

    if (query.length < 1) {
      return { items: [] };
    }
    const searchQuery = tsquery(query.trim() + '*');

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
        sql<number>`ts_rank(tsv, to_tsquery('english', f_unaccent(${searchQuery})))`.as(
          'rank',
        ),
        sql<string>`ts_headline('english', text_content, to_tsquery('english', f_unaccent(${searchQuery})),'MinWords=9, MaxWords=10, MaxFragments=3')`.as(
          'highlight',
        ),
      ])
      .select((eb) => this.pageRepo.withDatabaseId(eb))
      .where(
        'tsv',
        '@@',
        sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`,
      )
      .$if(Boolean(searchParams.creatorId), (qb) =>
        qb.where('creatorId', '=', searchParams.creatorId),
      )
      .where('deletedAt', 'is', null)
      .orderBy('rank', 'desc')
      .limit(searchParams.limit || 25)
      .offset(searchParams.offset || 0);

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

    const rawResults = await queryResults.execute();
    let searchResults = this.normalizeSearchHighlights(
      rawResults as unknown as SearchResponseDto[],
    );

    if (opts.userId) {
      const authUser = await this.userRepo.findById(opts.userId, opts.workspaceId);

      if (!authUser) {
        return { items: [] };
      }

      const snapshotBySpaceId = await this.buildSpaceAccessSnapshotMap(
        authUser,
        searchResults,
      );
      searchResults = this.filterReadableResults(searchResults, snapshotBySpaceId);

      const visiblePageIdsBySpaceId = this.buildVisiblePageIdsMap(
        snapshotBySpaceId,
      );

      searchResults = await this.attachBreadcrumbsToResults(
        searchResults,
        visiblePageIdsBySpaceId,
      );
    } else {
      searchResults = await this.attachBreadcrumbsToResults(searchResults);
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
    let pages = [];

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
        .select(['id', 'slugId', 'title', 'icon', 'spaceId'])
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(pages.title))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('deletedAt', 'is', null)
        .where('workspaceId', '=', workspaceId)
        .limit(limit);

      if (suggestion?.spaceId) {
        pageSearch = pageSearch.where('spaceId', '=', suggestion.spaceId);
      }

      const candidatePages = await pageSearch.execute();
      const accessRows = await Promise.all(
        candidatePages.map(async (page) => {
          const access = await this.pageAccessService.getEffectiveAccess(
            page as any,
            authUser,
          );
          return access.capabilities.canRead ? page : null;
        }),
      );

      pages = accessRows.filter(
        (page): page is (typeof candidatePages)[number] => !!page,
      );
    }

    return { users, groups, pages };
  }
}
