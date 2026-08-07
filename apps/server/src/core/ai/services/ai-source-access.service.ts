import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';

export type AiSourceAccessReference = {
  sourceType: string;
  sourceId: string;
  pageId: string;
};

export class AiSourceAccessChangedError extends Error {
  readonly aiErrorCode = 'source_access_changed';

  constructor() {
    super('Source access changed during AI generation');
    this.name = 'AiSourceAccessChangedError';
  }
}

@Injectable()
export class AiSourceAccessService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageAccessService: PageAccessService,
    private readonly contentPolicy: AiContentPolicyService,
  ) {}

  async getAllowedPageIds(params: {
    user: User;
    workspaceId: string;
    spaceId: string;
  }): Promise<Set<string>> {
    const [snapshot, excluded] = await Promise.all([
      this.pageAccessService.getSidebarAccessSnapshot(
        params.user,
        params.spaceId,
      ),
      this.contentPolicy.getExcludedPageIds(
        params.spaceId,
        params.workspaceId,
      ),
    ]);
    const candidates = [...snapshot.readablePageIds].filter(
      (pageId) => !excluded.has(pageId),
    );
    if (candidates.length === 0) return new Set();
    const live = await this.db
      .selectFrom('pages')
      .select('id')
      .where('id', 'in', candidates)
      .where('workspaceId', '=', params.workspaceId)
      .where('spaceId', '=', params.spaceId)
      .where('deletedAt', 'is', null)
      .execute();
    return new Set(live.map((page) => page.id));
  }

  async filterAccessible<T extends AiSourceAccessReference>(
    sources: T[],
    params: { user: User; workspaceId: string; spaceId: string },
  ): Promise<T[]> {
    if (sources.length === 0) return [];
    const allowedPageIds = await this.getAllowedPageIds(params);
    if (allowedPageIds.size === 0) return [];

    const rowIds = sources
      .filter((source) => source.sourceType === 'database_row')
      .map((source) => source.sourceId);
    const attachmentIds = sources
      .filter((source) => source.sourceType === 'attachment')
      .map((source) => source.sourceId);
    const databaseIds = sources
      .filter((source) => source.sourceType === 'database')
      .map((source) => source.sourceId);
    const [rows, attachments, databases] = await Promise.all([
      rowIds.length
        ? this.db
            .selectFrom('databaseRows')
            .innerJoin('databases', 'databases.id', 'databaseRows.databaseId')
            .select([
              'databaseRows.id as id',
              'databaseRows.pageId as pageId',
            ])
            .where('databaseRows.id', 'in', rowIds)
            .where('databaseRows.workspaceId', '=', params.workspaceId)
            .where('databaseRows.archivedAt', 'is', null)
            .where('databases.workspaceId', '=', params.workspaceId)
            .where('databases.spaceId', '=', params.spaceId)
            .where('databases.deletedAt', 'is', null)
            .execute()
        : [],
      attachmentIds.length
        ? this.db
            .selectFrom('attachments')
            .select(['id', 'pageId', 'workspaceId', 'spaceId', 'deletedAt'])
            .where('id', 'in', attachmentIds)
            .where('workspaceId', '=', params.workspaceId)
            .where('spaceId', '=', params.spaceId)
            .where('deletedAt', 'is', null)
            .execute()
        : [],
      databaseIds.length
        ? this.db
            .selectFrom('databases')
            .select(['id', 'pageId', 'workspaceId', 'spaceId', 'deletedAt'])
            .where('id', 'in', databaseIds)
            .where('workspaceId', '=', params.workspaceId)
            .where('spaceId', '=', params.spaceId)
            .where('deletedAt', 'is', null)
            .execute()
        : [],
    ]);
    const rowPageById = new Map(
      rows.map((row) => [row.id, row.pageId] as const),
    );
    const attachmentPageById = new Map(
      attachments
        .filter((file) => Boolean(file.pageId))
        .map((file) => [file.id, file.pageId!] as const),
    );
    const databasePageById = new Map(
      databases
        .filter((database) => Boolean(database.pageId))
        .map((database) => [database.id, database.pageId!] as const),
    );

    return sources.filter((source) => {
      if (!allowedPageIds.has(source.pageId)) return false;
      switch (source.sourceType) {
        case 'page':
          return source.sourceId === source.pageId;
        case 'database_row':
          return rowPageById.get(source.sourceId) === source.pageId;
        case 'attachment':
          return attachmentPageById.get(source.sourceId) === source.pageId;
        case 'database':
          return databasePageById.get(source.sourceId) === source.pageId;
        default:
          return false;
      }
    });
  }

  async assertAccessible(
    sources: AiSourceAccessReference[],
    params: { user: User; workspaceId: string; spaceId: string },
  ): Promise<void> {
    if (sources.length === 0) return;
    const accessible = await this.filterAccessible(sources, params);
    if (accessible.length !== sources.length) {
      throw new AiSourceAccessChangedError();
    }
  }
}
