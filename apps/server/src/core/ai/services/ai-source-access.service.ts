import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
import { PAGE_CUSTOM_FIELD_STATUS } from '@docmost/api-contract';
import { PageAccessService } from '../../page-access/page-access.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';

export type AiSourceAccessReference = {
  sourceType: string;
  sourceId: string;
  pageId: string | null;
};

type AiSourceAccessMode = 'default' | 'rag-search';

type AiSourceAccessParams = {
  user: User;
  workspaceId: string;
  spaceId: string;
  mode?: AiSourceAccessMode;
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
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  async getAllowedPageIds(params: AiSourceAccessParams): Promise<Set<string>> {
    const [snapshot, policy] = await Promise.all([
      this.pageAccessService.getSidebarAccessSnapshot(
        params.user,
        params.spaceId,
      ),
      params.mode === 'rag-search'
        ? this.contentPolicy.getRagSearchPolicy(
            params.spaceId,
            params.workspaceId,
          )
        : this.contentPolicy
            .getExcludedPageIds(params.spaceId, params.workspaceId)
            .then((excludedPageIds) => ({
              ragSearchDoneOnly: false,
              excludedPageIds: [...excludedPageIds],
            })),
    ]);
    const excluded = new Set(policy.excludedPageIds);
    const candidates = [...snapshot.readablePageIds].filter(
      (pageId) => !excluded.has(pageId),
    );
    if (candidates.length === 0) return new Set();
    let liveQuery = this.db
      .selectFrom('pages')
      .select('id')
      .where('id', 'in', candidates)
      .where('workspaceId', '=', params.workspaceId)
      .where('spaceId', '=', params.spaceId)
      .where('deletedAt', 'is', null);
    if (params.mode === 'rag-search' && policy.ragSearchDoneOnly) {
      liveQuery = liveQuery.where(
        sql<boolean>`coalesce(settings ->> 'status', '') = ${sql.lit(PAGE_CUSTOM_FIELD_STATUS.DONE)}`,
      );
    }
    const live = await liveQuery.execute();
    return new Set(live.map((page) => page.id));
  }

  async filterAccessible<T extends AiSourceAccessReference>(
    sources: T[],
    params: AiSourceAccessParams,
  ): Promise<T[]> {
    if (sources.length === 0) return [];
    const allowedPageIds = await this.getAllowedPageIds(params);
    const dictionaryIds = sources
      .filter((source) => source.sourceType === 'dictionary_term')
      .map((source) => source.sourceId);
    const space = await this.db
      .selectFrom('spaces')
      .select(['settings'])
      .where('id', '=', params.spaceId)
      .where('workspaceId', '=', params.workspaceId)
      .executeTakeFirst();
    const dictionaryEnabled = Boolean(
      space?.settings &&
        typeof space.settings === 'object' &&
        !Array.isArray(space.settings) &&
        (space.settings as any).dictionary?.enabled,
    );
    let readableDictionaryIds = new Set<string>();
    if (dictionaryEnabled && dictionaryIds.length > 0) {
      const ability = await this.spaceAbility.createForUser(
        params.user,
        params.spaceId,
      );
      if (ability.can(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        const terms = await this.db
          .selectFrom('dictionaryTerms')
          .select('id')
          .where('workspaceId', '=', params.workspaceId)
          .where('spaceId', '=', params.spaceId)
          .where('deletedAt', 'is', null)
          .where('id', 'in', dictionaryIds)
          .execute();
        readableDictionaryIds = new Set(terms.map((term) => term.id));
      }
    }

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
            .select(['databaseRows.id as id', 'databaseRows.pageId as pageId'])
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
      if (source.sourceType === 'dictionary_term') {
        return (
          source.pageId === null && readableDictionaryIds.has(source.sourceId)
        );
      }
      if (!source.pageId) return false;
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
    params: AiSourceAccessParams,
  ): Promise<void> {
    if (sources.length === 0) return;
    const accessible = await this.filterAccessible(sources, params);
    if (accessible.length !== sources.length) {
      throw new AiSourceAccessChangedError();
    }
  }
}
