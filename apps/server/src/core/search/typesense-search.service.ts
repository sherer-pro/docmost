import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SearchDTO } from './dto/search.dto';
import {
  AttachmentSearchResponseDto,
  SearchResponseDto,
} from './dto/search-response.dto';
import {
  PageAccessService,
  SidebarAccessSnapshot,
} from '../page-access/page-access.service';
import { ShareService } from '../share/share.service';
import { SearchService } from './search.service';
import {
  TypesenseAttachmentDocument,
  TypesenseIndexService,
  TypesensePageDocument,
} from './typesense-index.service';

const DEFAULT_SEARCH_LIMIT = 25;
const TYPESENSE_FETCH_BATCH_SIZE = 100;
const MAX_TYPESENSE_CANDIDATES = 10_000;

@Injectable()
export class TypesenseSearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly typesenseIndexService: TypesenseIndexService,
    private readonly pageRepo: PageRepo,
    private readonly shareRepo: ShareRepo,
    private readonly shareService: ShareService,
    private readonly userRepo: UserRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly searchService: SearchService,
  ) {}

  async searchPages(
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
    },
  ): Promise<{ items: SearchResponseDto[] }> {
    const query = searchParams.query?.trim();
    if (!query) {
      return { items: [] };
    }

    const publicShare = opts.userId
      ? null
      : await this.resolvePublicShare(searchParams, opts.workspaceId);
    if (!opts.userId && !publicShare) {
      return { items: [] };
    }

    const authUser = opts.userId
      ? await this.userRepo.findById(opts.userId, opts.workspaceId)
      : null;
    if (opts.userId && !authUser) {
      return { items: [] };
    }

    const limit = searchParams.limit ?? DEFAULT_SEARCH_LIMIT;
    let readableRowsToSkip = searchParams.offset ?? 0;
    let rawOffset = 0;
    const results: SearchResponseDto[] = [];
    const snapshots = new Map<string, SidebarAccessSnapshot>();

    while (results.length < limit && rawOffset < MAX_TYPESENSE_CANDIDATES) {
      const response = await this.runTypesenseRequest(() =>
        this.typesenseIndexService.searchPages({
          q: query,
          query_by: 'title,content',
          query_by_weights: '4,1',
          filter_by: this.buildFilter({
            workspaceId: opts.workspaceId,
            spaceId: publicShare?.spaceId ?? searchParams.spaceId,
            creatorId: searchParams.creatorId,
          }),
          prefix: true,
          prioritize_exact_match: true,
          sort_by: '_text_match:desc,updatedAt:desc',
          highlight_fields: 'title',
          exclude_fields: 'content',
          offset: rawOffset,
          limit: TYPESENSE_FETCH_BATCH_SIZE,
        }),
      );
      const hits = response.hits ?? [];
      if (hits.length === 0) {
        break;
      }

      const ids = hits.map((hit) => hit.document.id);
      const rows = await this.loadPages(ids, opts.workspaceId);
      const rowsById = new Map(rows.map((row) => [row.id, row]));

      for (const hit of hits) {
        const row = rowsById.get(hit.document.id);
        if (!row) {
          continue;
        }
        if (publicShare && !publicShare.pageIds.has(row.id)) {
          continue;
        }
        if (
          authUser &&
          !(await this.canReadPage(authUser, row.spaceId, row.id, snapshots))
        ) {
          continue;
        }
        if (readableRowsToSkip > 0) {
          readableRowsToSkip -= 1;
          continue;
        }

        const { textContent, space, ...publicRow } = row;
        results.push({
          ...publicRow,
          // Anonymous share results never expose space metadata, matching the
          // PostgreSQL driver which omits it for share searches.
          ...(publicShare ? {} : { space }),
          rank: Number(hit.text_match ?? 0),
          highlight: this.buildAuthoritativeHighlight(query, [
            textContent,
            row.title,
          ]),
        } as SearchResponseDto);
        if (results.length >= limit) {
          break;
        }
      }

      rawOffset += hits.length;
      if (hits.length < TYPESENSE_FETCH_BATCH_SIZE) {
        break;
      }
    }

    const visiblePageIdsBySpaceId = authUser
      ? new Map(
          [...snapshots.entries()].map(([spaceId, snapshot]) => [
            spaceId,
            snapshot.visiblePageIds,
          ]),
        )
      : undefined;
    const items = await this.searchService.attachBreadcrumbsToResults(
      results,
      visiblePageIdsBySpaceId,
    );
    return {
      items: publicShare
        ? this.searchService.projectPublicShareResults(items)
        : items,
    };
  }

  async searchAttachments(
    searchParams: SearchDTO,
    opts: {
      userId: string;
      workspaceId: string;
    },
  ): Promise<{ items: AttachmentSearchResponseDto[] }> {
    const query = searchParams.query?.trim();
    if (!query) {
      return { items: [] };
    }

    const authUser = await this.userRepo.findById(
      opts.userId,
      opts.workspaceId,
    );
    if (!authUser) {
      return { items: [] };
    }

    const limit = searchParams.limit ?? DEFAULT_SEARCH_LIMIT;
    let readableRowsToSkip = searchParams.offset ?? 0;
    let rawOffset = 0;
    const results: AttachmentSearchResponseDto[] = [];
    const snapshots = new Map<string, SidebarAccessSnapshot>();

    while (results.length < limit && rawOffset < MAX_TYPESENSE_CANDIDATES) {
      const response = await this.runTypesenseRequest(() =>
        this.typesenseIndexService.searchAttachments({
          q: query,
          query_by: 'fileName,content',
          query_by_weights: '4,1',
          filter_by: this.buildFilter({
            workspaceId: opts.workspaceId,
            spaceId: searchParams.spaceId,
          }),
          prefix: true,
          prioritize_exact_match: true,
          sort_by: '_text_match:desc,updatedAt:desc',
          highlight_fields: 'fileName',
          exclude_fields: 'content',
          offset: rawOffset,
          limit: TYPESENSE_FETCH_BATCH_SIZE,
        }),
      );
      const hits = response.hits ?? [];
      if (hits.length === 0) {
        break;
      }

      const ids = hits.map((hit) => hit.document.id);
      const rows = await this.loadAttachments(ids, opts.workspaceId);
      const rowsById = new Map(rows.map((row) => [row.id, row]));

      for (const hit of hits) {
        const row = rowsById.get(hit.document.id);
        if (!row?.page?.id || !row.space?.id) {
          continue;
        }
        if (
          !(await this.canReadPage(
            authUser,
            row.space.id,
            row.page.id,
            snapshots,
          ))
        ) {
          continue;
        }
        if (readableRowsToSkip > 0) {
          readableRowsToSkip -= 1;
          continue;
        }

        const { textContent, ...publicRow } = row;
        results.push({
          ...publicRow,
          rank: Number(hit.text_match ?? 0),
          highlight: this.buildAuthoritativeHighlight(query, [
            textContent,
            row.fileName,
          ]),
        } as AttachmentSearchResponseDto);
        if (results.length >= limit) {
          break;
        }
      }

      rawOffset += hits.length;
      if (hits.length < TYPESENSE_FETCH_BATCH_SIZE) {
        break;
      }
    }

    return { items: results };
  }

  private async loadPages(ids: string[], workspaceId: string) {
    if (ids.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.icon',
        'pages.parentPageId',
        'pages.creatorId',
        'pages.createdAt',
        'pages.updatedAt',
        'pages.spaceId',
        'pages.textContent',
      ])
      .select((eb) => this.pageRepo.withDatabaseId(eb))
      .select((eb) => this.pageRepo.withSpace(eb))
      .where('pages.id', 'in', ids)
      .where('pages.workspaceId', '=', workspaceId)
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();
  }

  private async loadAttachments(ids: string[], workspaceId: string) {
    if (ids.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('attachments')
      .innerJoin('pages', 'pages.id', 'attachments.pageId')
      .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
      .select([
        'attachments.id',
        'attachments.fileName',
        'attachments.pageId',
        'attachments.creatorId',
        'attachments.createdAt',
        'attachments.updatedAt',
        'attachments.textContent',
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
      .where('attachments.id', 'in', ids)
      .where('attachments.workspaceId', '=', workspaceId)
      .where('attachments.deletedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
      .where('spaces.archivedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null)
      .execute();
  }

  private async resolvePublicShare(
    searchParams: SearchDTO,
    workspaceId: string,
  ): Promise<{ pageIds: Set<string>; spaceId: string } | null> {
    if (!searchParams.shareId) {
      return null;
    }

    const share = await this.shareRepo.findById(searchParams.shareId);
    if (!share || share.workspaceId !== workspaceId) {
      return null;
    }
    if (
      !(await this.shareService.isSharingAllowed(
        share.workspaceId,
        share.spaceId,
      ))
    ) {
      return null;
    }

    const pageIds = new Set<string>([share.pageId]);
    if (share.includeSubPages) {
      const pages = await this.pageRepo.getPageAndDescendants(share.pageId, {
        includeContent: false,
      });
      pages.forEach((page) => pageIds.add(page.id));
    }

    return { pageIds, spaceId: share.spaceId };
  }

  private async canReadPage(
    user: any,
    spaceId: string,
    pageId: string,
    snapshots: Map<string, SidebarAccessSnapshot>,
  ): Promise<boolean> {
    let snapshot = snapshots.get(spaceId);
    if (!snapshot) {
      snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
        user,
        spaceId,
      );
      snapshots.set(spaceId, snapshot);
    }
    return snapshot.readablePageIds.has(pageId);
  }

  private buildFilter(opts: {
    workspaceId: string;
    spaceId?: string | null;
    creatorId?: string | null;
  }): string {
    const filters = [`workspaceId:=${this.filterValue(opts.workspaceId)}`];
    if (opts.spaceId) {
      filters.push(`spaceId:=${this.filterValue(opts.spaceId)}`);
    }
    if (opts.creatorId) {
      filters.push(`creatorId:=${this.filterValue(opts.creatorId)}`);
    }
    return filters.join(' && ');
  }

  private filterValue(value: string): string {
    return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
  }

  private buildAuthoritativeHighlight(
    query: string,
    candidates: Array<string | null | undefined>,
  ): string {
    const needles = [
      query.trim().toLocaleLowerCase(),
      ...query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '')
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const lowerValue = value.toLocaleLowerCase();
      let matchAt = -1;
      let matchLength = 0;
      for (const needle of needles) {
        const index = lowerValue.indexOf(needle);
        if (index >= 0 && (matchAt < 0 || index < matchAt)) {
          matchAt = index;
          matchLength = needle.length;
        }
      }

      if (matchAt >= 0) {
        const start = Math.max(0, matchAt - 80);
        const end = Math.min(value.length, matchAt + 160);
        const matchEnd = Math.min(end, matchAt + matchLength);
        // The PostgreSQL driver returns ts_headline markup, so the Typesense
        // driver marks the match too. Everything else is escaped first.
        const snippet =
          this.escapeHtml(value.slice(start, matchAt)) +
          `<mark>${this.escapeHtml(value.slice(matchAt, matchEnd))}</mark>` +
          this.escapeHtml(value.slice(matchEnd, end));
        return `${start > 0 ? '…' : ''}${snippet}${
          end < value.length ? '…' : ''
        }`;
      }
    }

    return '';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async runTypesenseRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch {
      throw new ServiceUnavailableException('Search service unavailable');
    }
  }
}
