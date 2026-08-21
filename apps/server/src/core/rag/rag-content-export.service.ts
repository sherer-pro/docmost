import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { User, Workspace, Space } from '@docmost/db/types/entity.types';
import { jsonToMarkdown } from '../../collaboration/collaboration.util';
import { mapPageSettings } from '../page/mappers/page-response.mapper';
import { validate as isValidUuid } from 'uuid';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { ExportService } from '../../integrations/export/export.service';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { PageAccessService } from '../page-access/page-access.service';
import { AiContentPolicyService } from '../ai-content-policy/ai-content-policy.service';
import {
  KnowledgeDocumentFieldsConfig,
  KnowledgeProjectionService,
} from './knowledge-projection.service';

export interface RagAuthContext {
  user: User;
  workspace: Workspace;
  space: Space;
}

export interface RagSystemContext {
  accessMode: 'system';
  workspace: Workspace;
  space: Space;
}

export type RagReadContext = RagAuthContext | RagSystemContext;

type RagFeedPagination = {
  limit?: number;
  cursor?: string;
};

type RagFeedCursor = {
  version: 2;
  kind: string;
  workspaceId: string;
  spaceId: string;
  scopeFingerprint: string;
  watermarkMs: number | null;
  snapshotUpperBoundMs: number;
  timestampMs: number;
  id: string;
};

type RagFeedSnapshot = {
  cursor: RagFeedCursor | null;
  workspaceId: string;
  spaceId: string;
  scopeFingerprint: string;
  watermarkMs: number | null;
  snapshotUpperBoundMs: number;
};

@Injectable()
export class RagContentExportService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly databaseRepo: DatabaseRepo,
    private readonly databasePropertyRepo: DatabasePropertyRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly commentRepo: CommentRepo,
    private readonly exportService: ExportService,
    private readonly pageAccessService: PageAccessService,
    private readonly contentPolicy: AiContentPolicyService,
    private readonly projection: KnowledgeProjectionService,
  ) {}

  /**
   * Page-level access rules are a second authorization layer on top of space
   * membership. The RAG API is scoped to a space, so without consulting them an
   * API key would read pages its own creator is denied, turning the key into a
   * privilege-escalation primitive.
   */
  private async getReadablePageIds(
    scope: RagReadContext,
  ): Promise<Set<string>> {
    const excluded = await this.contentPolicy.getExcludedPageIds(
      scope.space.id,
      scope.workspace.id,
    );
    if (this.isSystemContext(scope)) {
      const pages = await this.db
        .selectFrom('pages')
        .select('id')
        .where('workspaceId', '=', scope.workspace.id)
        .where('spaceId', '=', scope.space.id)
        .where('deletedAt', 'is', null)
        .where('templateKind', 'is', null)
        .execute();
      return new Set(
        pages.map((page) => page.id).filter((pageId) => !excluded.has(pageId)),
      );
    }

    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      scope.user,
      scope.space.id,
    );
    return new Set(
      [...snapshot.readablePageIds].filter((pageId) => !excluded.has(pageId)),
    );
  }

  async getScope(scope: RagReadContext) {
    const systemContext = this.isSystemContext(scope);
    const [policy, readablePageIds, aiConfig] = await Promise.all([
      this.contentPolicy.getEffectivePolicy(scope.space.id, scope.workspace.id),
      systemContext
        ? Promise.resolve(undefined)
        : this.getReadablePageIds(scope),
      this.db
        .selectFrom('aiSpaceConfigs')
        .select([
          'retrievalAdapter',
          'retrievalOpenWebuiBaseUrl',
          'retrievalOpenWebuiKnowledgeId',
        ])
        .where('workspaceId', '=', scope.workspace.id)
        .where('spaceId', '=', scope.space.id)
        .executeTakeFirst(),
    ]);
    const syncTarget =
      aiConfig?.retrievalAdapter === 'open-webui-knowledge-v1' &&
      aiConfig.retrievalOpenWebuiBaseUrl &&
      aiConfig.retrievalOpenWebuiKnowledgeId
        ? {
            adapter: 'open-webui-knowledge-v1' as const,
            baseUrl: aiConfig.retrievalOpenWebuiBaseUrl,
            knowledgeId: aiConfig.retrievalOpenWebuiKnowledgeId,
          }
        : null;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: 2,
          ...this.projection.fingerprintInput(scope.space),
          workspaceId: scope.workspace.id,
          spaceId: scope.space.id,
          syncTarget,
          policyFingerprint: policy.fingerprint,
          ...(readablePageIds
            ? { readablePageIds: [...readablePageIds].sort() }
            : {}),
        }),
      )
      .digest('hex');
    return {
      schemaVersion: 2 as const,
      projectionVersion: this.projection.version,
      workspaceId: scope.workspace.id,
      spaceId: scope.space.id,
      syncTarget,
      fingerprint,
      excludedPageIds: policy.excludedPageIds,
    };
  }

  async getBlockedPages(
    scope: RagReadContext,
    pagination: RagFeedPagination = {},
  ) {
    const readablePageIds = await this.getReadablePageIds(scope);
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'scope-blocked',
      null,
      pagination.cursor,
    );
    const cursor = snapshot.cursor;
    const loadBatch = async (afterId?: string) => {
      let query = this.db
        .selectFrom('pages')
        .select('id')
        .where('workspaceId', '=', scope.workspace.id)
        .where('spaceId', '=', scope.space.id)
        .where('deletedAt', 'is', null)
        .where('templateKind', 'is', null)
        .where('createdAt', '<=', new Date(snapshot.snapshotUpperBoundMs));
      if (afterId) {
        query = query.where('id', '>', afterId);
      }
      query = query.orderBy('id', 'asc');
      if (pagination.limit) {
        query = query.limit(
          Math.min(1000, Math.max(100, pagination.limit * 2)),
        );
      }
      return query.execute();
    };
    let allPages: Array<{ id: string }> = [];
    if (!pagination.limit) {
      allPages = await loadBatch(cursor?.id);
    } else {
      let afterId = cursor?.id;
      while (allPages.length <= pagination.limit) {
        const batch = await loadBatch(afterId);
        if (batch.length === 0) {
          break;
        }
        allPages.push(...batch.filter((page) => !readablePageIds.has(page.id)));
        afterId = batch.at(-1)!.id;
        if (
          batch.length < Math.min(1000, Math.max(100, pagination.limit * 2))
        ) {
          break;
        }
      }
    }
    const items = allPages
      .filter((page) => !readablePageIds.has(page.id))
      .map((page) => ({ pageId: page.id }));
    const page = this.paginateFeed(
      items,
      'scope-blocked',
      pagination,
      () => 0,
      (item) => item.pageId,
      snapshot,
    );
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  private async filterReadablePageRows<T extends { id: string }>(
    rows: T[],
    scope: RagReadContext,
  ): Promise<T[]> {
    if (rows.length === 0) {
      return rows;
    }

    const readablePageIds = this.isSystemContext(scope)
      ? null
      : await this.getReadablePageIds(scope);

    return readablePageIds
      ? rows.filter((row) => readablePageIds.has(row.id))
      : rows;
  }

  private getDocumentFieldsConfig(space: Space): KnowledgeDocumentFieldsConfig {
    return this.projection.getDocumentFieldsConfig(space);
  }

  private buildCustomFields(
    settings: unknown,
    docFields: KnowledgeDocumentFieldsConfig,
  ) {
    return this.projection.buildCustomFields(settings, docFields);
  }

  private toMarkdown(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
      return null;
    }

    try {
      return jsonToMarkdown(content);
    } catch {
      return null;
    }
  }

  private async resolvePageInScope(
    pageIdOrSlug: string,
    scope: RagReadContext,
    opts?: { includeContent?: boolean; allowDeleted?: boolean },
  ) {
    const page = await this.pageRepo.findById(pageIdOrSlug, {
      includeContent: opts?.includeContent,
      includeSpace: true,
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    if (page.spaceId !== scope.space.id) {
      throw new ForbiddenException('Page is outside API key scope');
    }

    if (!opts?.allowDeleted && page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    if (!this.isSystemContext(scope)) {
      // An API key never grants more than the user who created it can read.
      const access = await this.pageAccessService.getEffectiveAccess(
        page,
        scope.user,
      );

      if (!access.capabilities.canRead) {
        throw new ForbiddenException('Page is outside API key scope');
      }
    }
    if (
      await this.contentPolicy.isPageExcluded(
        page.id,
        scope.space.id,
        scope.workspace.id,
      )
    ) {
      throw new ForbiddenException('Page is excluded from AI and RAG');
    }

    return page;
  }

  private async resolveDatabaseInScope(
    databaseIdOrPageSlug: string,
    scope: RagReadContext,
  ) {
    let database = null;

    if (isValidUuid(databaseIdOrPageSlug)) {
      database = await this.databaseRepo.findById(
        databaseIdOrPageSlug,
        scope.workspace.id,
      );
    }

    if (!database) {
      const page = await this.resolvePageInScope(databaseIdOrPageSlug, scope, {
        allowDeleted: false,
      });
      database = await this.databaseRepo.findByPageId(
        page.id,
        scope.workspace.id,
      );
    }

    if (!database) {
      throw new NotFoundException('Database not found');
    }

    if (database.spaceId !== scope.space.id) {
      throw new ForbiddenException('Database is outside API key scope');
    }
    if (!database.pageId) {
      throw new NotFoundException('Database page not found');
    }
    await this.resolvePageInScope(database.pageId, scope, {
      allowDeleted: false,
    });

    return database;
  }

  private stringifyCellValue(value: unknown): string {
    if (value === null || typeof value === 'undefined') {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'object' && value !== null) {
      if (typeof value['name'] === 'string') {
        return value['name'];
      }

      if (typeof value['label'] === 'string') {
        return value['label'];
      }

      if (typeof value['value'] === 'string') {
        return value['value'];
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private buildDatabaseTableMarkdown(properties: any[], rows: any[]): string {
    const header = [
      'Title',
      ...properties.map((item) => item.name || 'Column'),
    ];
    const separator = header.map(() => '---');

    const bodyRows = rows.map((row) => {
      const valueByPropertyId = new Map<string, unknown>(
        (row.cells ?? []).map((cell) => [cell.propertyId, cell.value]),
      );

      return [
        row.page?.title || row.pageTitle || '',
        ...properties.map((property) =>
          this.stringifyCellValue(valueByPropertyId.get(property.id)),
        ),
      ];
    });

    return [header, separator, ...bodyRows]
      .map((line) => `| ${line.join(' | ')} |`)
      .join('\n');
  }

  private async loadRowsWithContent(
    databaseId: string,
    scope: RagReadContext,
    opts?: { pageIds?: string[] },
  ) {
    const allRows = await this.databaseRowRepo.findByDatabaseId(
      databaseId,
      scope.workspace.id,
      scope.space.id,
    );

    const selectedRows =
      opts?.pageIds && opts.pageIds.length > 0
        ? allRows.filter((row) => opts.pageIds.includes(row.pageId))
        : allRows;

    return this.hydrateRowsWithContent(selectedRows, scope);
  }

  private async hydrateRowsWithContent(
    selectedRows: any[],
    scope: RagReadContext,
  ) {
    // A readable database container does not imply read access to every row
    // page. Apply the creator's current page ACL before loading row content or
    // returning cell values.
    const readablePageIds = this.isSystemContext(scope)
      ? null
      : await this.getReadablePageIds(scope);
    const rowList = readablePageIds
      ? selectedRows.filter((row) => readablePageIds.has(row.pageId))
      : selectedRows;

    const rowPageIds = rowList.map((row) => row.pageId);
    const rowPages =
      rowPageIds.length > 0
        ? await this.db
            .selectFrom('pages')
            .select([
              'id',
              'slugId',
              'title',
              'icon',
              'parentPageId',
              'position',
              'settings',
              'content',
              'updatedAt',
            ])
            .where('id', 'in', rowPageIds)
            .where('spaceId', '=', scope.space.id)
            .execute()
        : [];

    const rowPageMap = new Map(rowPages.map((row) => [row.id, row]));
    const documentFields = this.getDocumentFieldsConfig(scope.space);
    const properties = rowList[0]?.databaseId
      ? await this.databasePropertyRepo.findByDatabaseId(rowList[0].databaseId)
      : [];
    const customFields = rowList.map((row) =>
      this.buildCustomFields(
        rowPageMap.get(row.pageId)?.settings,
        documentFields,
      ),
    );
    const members = await this.projection.resolveMembers(
      scope.workspace.id,
      customFields,
    );
    const memberNames = this.projection.memberNames(members);

    return rowList.map((row, index) => {
      const rowPage = rowPageMap.get(row.pageId);
      const rowMarkdown = this.toMarkdown(rowPage?.content ?? null);
      const rowFields = this.projection.renderRowFields(
        properties,
        row.cells ?? [],
      );
      const fields = customFields[index];
      const updatedAt = new Date(
        Math.max(
          new Date(row.updatedAt).getTime(),
          rowPage?.updatedAt ? new Date(rowPage.updatedAt).getTime() : 0,
        ),
      );
      const projectionBaseUpdatedAt = new Date(
        Math.max(
          updatedAt.getTime(),
          ...(row.cells ?? []).map((cell: { updatedAt?: Date | string }) =>
            cell.updatedAt ? new Date(cell.updatedAt).getTime() : 0,
          ),
        ),
      );
      const projectionUpdatedAt =
        this.projection.projectionUpdatedAtFromMembers(
          projectionBaseUpdatedAt,
          fields,
          members,
        );

      return {
        id: row.id,
        databaseId: row.databaseId,
        pageId: row.pageId,
        pageSlugId: row.pageSlugId,
        pageTitle: row.pageTitle,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
        updatedAt,
        projectionUpdatedAt,
        page: rowPage
          ? {
              id: rowPage.id,
              slugId: rowPage.slugId,
              title: rowPage.title,
              icon: rowPage.icon,
              parentPageId: rowPage.parentPageId,
              position: rowPage.position,
              customFields: fields,
            }
          : row.page,
        cells: rowFields.cells,
        rowMarkdown,
        knowledgeMarkdown: [
          `# ${rowPage?.title || row.pageTitle || row.id}`,
          this.projection.renderDocumentFields(fields, memberNames),
          rowFields.markdown,
          rowMarkdown?.trim() ?? '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    });
  }

  async listPages(
    scope: RagReadContext,
    includeContent = false,
    pagination: RagFeedPagination = {},
  ) {
    const documentFields = this.getDocumentFieldsConfig(scope.space);
    const readablePageIds = await this.getReadablePageIds(scope);
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'pages',
      null,
      pagination.cursor,
    );
    const cursor = snapshot.cursor;
    const queryLimit = pagination.limit ? pagination.limit + 1 : null;
    const pageUpdatedAtMs = this.millisecondTimestamp('pages.updatedAt');
    const databaseUpdatedAtMs = this.millisecondTimestamp(
      'databases.updatedAt',
    );

    let regularPagesQuery = this.db
      .selectFrom('pages')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.icon',
        'pages.parentPageId',
        'pages.position',
        'pages.settings',
        'pages.createdAt',
        'pages.updatedAt',
      ])
      .$if(includeContent, (qb) => qb.select('pages.content'))
      .where('pages.workspaceId', '=', scope.workspace.id)
      .where('pages.spaceId', '=', scope.space.id)
      .where('pages.id', 'in', [...readablePageIds])
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
      .where(pageUpdatedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs))
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'pages.id')
              .where('databases.deletedAt', 'is', null),
          ),
        ),
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'pages.id')
              .where('databaseRows.archivedAt', 'is', null),
          ),
        ),
      );
    let databaseNodesQuery = this.db
      .selectFrom('databases')
      .innerJoin('pages', 'pages.id', 'databases.pageId')
      .select([
        'databases.id as databaseId',
        'databases.name as title',
        'databases.description',
        'databases.descriptionContent',
        'databases.icon',
        'databases.createdAt',
        'databases.updatedAt',
        'pages.id',
        'pages.slugId',
        'pages.parentPageId',
        'pages.position',
        'pages.settings',
        'pages.updatedAt as pageUpdatedAt',
      ])
      .$if(includeContent, (qb) => qb.select('pages.content'))
      .where('databases.workspaceId', '=', scope.workspace.id)
      .where('databases.spaceId', '=', scope.space.id)
      .where('databases.deletedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .where('pages.id', 'in', [...readablePageIds])
      .where(
        databaseUpdatedAtMs,
        '<=',
        new Date(snapshot.snapshotUpperBoundMs),
      );
    if (cursor) {
      const cursorDate = new Date(cursor.timestampMs);
      regularPagesQuery = regularPagesQuery.where((eb) =>
        eb.or([
          eb(pageUpdatedAtMs, '>', cursorDate),
          eb.and([
            eb(pageUpdatedAtMs, '=', cursorDate),
            eb('pages.id', '>', cursor.id),
          ]),
        ]),
      );
      databaseNodesQuery = databaseNodesQuery.where((eb) =>
        eb.or([
          eb(databaseUpdatedAtMs, '>', cursorDate),
          eb.and([
            eb(databaseUpdatedAtMs, '=', cursorDate),
            eb('pages.id', '>', cursor.id),
          ]),
        ]),
      );
    }
    if (queryLimit) {
      regularPagesQuery = regularPagesQuery
        .orderBy(pageUpdatedAtMs, 'asc')
        .orderBy('pages.id', 'asc')
        .limit(queryLimit);
      databaseNodesQuery = databaseNodesQuery
        .orderBy(databaseUpdatedAtMs, 'asc')
        .orderBy('pages.id', 'asc')
        .limit(queryLimit);
    }
    const [regularPages, databaseNodes] =
      readablePageIds.size === 0
        ? [[], []]
        : await Promise.all([
            regularPagesQuery.execute(),
            databaseNodesQuery.execute(),
          ]);

    const regularFields = regularPages.map((page) =>
      this.buildCustomFields(page.settings, documentFields),
    );
    const databaseFields = databaseNodes.map((database) =>
      this.buildCustomFields(database.settings, documentFields),
    );
    const members = await this.projection.resolveMembers(scope.workspace.id, [
      ...regularFields,
      ...databaseFields,
    ]);
    const memberNames = this.projection.memberNames(members);
    const items = [
      ...regularPages.map((page, index) => ({
        type: 'page',
        id: page.id,
        slugId: page.slugId,
        title: page.title,
        icon: page.icon,
        parentPageId: page.parentPageId,
        position: page.position,
        customFields: regularFields[index],
        settings: mapPageSettings(page.settings),
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
        projectionUpdatedAt: this.projection.projectionUpdatedAtFromMembers(
          page.updatedAt,
          regularFields[index],
          members,
        ),
        ...(includeContent
          ? {
              contentMarkdown: this.toMarkdown((page as any).content),
              knowledgeMarkdown: this.projection.renderPageKnowledgeMarkdown({
                title: page.title,
                contentMarkdown: this.toMarkdown((page as any).content),
                customFields: regularFields[index],
                memberNames,
              }),
            }
          : {}),
      })),
      ...databaseNodes.map((database, index) => ({
        type: 'database',
        id: database.id,
        databaseId: database.databaseId,
        slugId: database.slugId,
        title: database.title,
        icon: database.icon,
        parentPageId: database.parentPageId,
        position: database.position,
        customFields: databaseFields[index],
        settings: mapPageSettings(database.settings),
        createdAt: database.createdAt,
        updatedAt: database.updatedAt,
        projectionUpdatedAt: this.projection.projectionUpdatedAtFromMembers(
          new Date(
            Math.max(
              new Date(database.updatedAt).getTime(),
              new Date(database.pageUpdatedAt).getTime(),
            ),
          ),
          databaseFields[index],
          members,
        ),
        ...(includeContent
          ? {
              descriptionMarkdown:
                this.toMarkdown(database.descriptionContent) ??
                database.description ??
                '',
              contentMarkdown: this.toMarkdown((database as any).content),
              knowledgeMarkdown: this.projection.renderPageKnowledgeMarkdown({
                title: database.title,
                contentMarkdown: [
                  this.toMarkdown(database.descriptionContent) ??
                    database.description ??
                    '',
                  this.toMarkdown((database as any).content) ?? '',
                ]
                  .filter(Boolean)
                  .join('\n\n'),
                customFields: databaseFields[index],
                memberNames,
              }),
            }
          : {}),
      })),
    ].sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.id.localeCompare(b.id);
    });

    if (!pagination.limit && !pagination.cursor) {
      return { items };
    }
    return this.paginateFeed(
      items,
      'pages',
      pagination,
      (item) => new Date(item.updatedAt).getTime(),
      (item) => item.id,
      snapshot,
    );
  }

  async getPageInfo(
    scope: RagReadContext,
    pageIdOrSlug: string,
    includeContent = true,
  ) {
    const page = await this.resolvePageInScope(pageIdOrSlug, scope, {
      includeContent,
    });

    const [linkedDatabase, activeRow] = await Promise.all([
      this.databaseRepo.findByPageId(page.id, scope.workspace.id),
      this.db
        .selectFrom('databaseRows')
        .select(['databaseId'])
        .where('pageId', '=', page.id)
        .where('workspaceId', '=', scope.workspace.id)
        .where('archivedAt', 'is', null)
        .executeTakeFirst(),
    ]);

    const documentFields = this.getDocumentFieldsConfig(scope.space);
    const customFields = this.buildCustomFields(page.settings, documentFields);
    const members = await this.projection.resolveMembers(scope.workspace.id, [
      customFields,
    ]);
    const memberNames = this.projection.memberNames(members);
    const projectionUpdatedAt = this.projection.projectionUpdatedAtFromMembers(
      page.updatedAt,
      customFields,
      members,
    );
    const type = linkedDatabase
      ? 'database'
      : activeRow
        ? 'databaseRow'
        : 'page';

    return {
      id: page.id,
      slugId: page.slugId,
      type,
      title: page.title,
      icon: page.icon,
      parentPageId: page.parentPageId,
      position: page.position,
      spaceId: page.spaceId,
      settings: mapPageSettings(page.settings),
      customFields,
      databaseId: linkedDatabase?.id ?? activeRow?.databaseId ?? null,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      projectionUpdatedAt,
      ...(includeContent
        ? {
            contentMarkdown: this.toMarkdown(page.content),
            knowledgeMarkdown: this.projection.renderPageKnowledgeMarkdown({
              title: page.title,
              contentMarkdown: this.toMarkdown(page.content),
              customFields,
              memberNames,
            }),
          }
        : {}),
    };
  }

  async listDictionaryTerms(
    scope: RagReadContext,
    pagination: RagFeedPagination = {},
  ) {
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'dictionary-terms',
      null,
      pagination.cursor,
    );
    const items = this.projection.isDictionaryEnabled(scope.space)
      ? await this.loadDictionaryTerms(scope, {
          updatedBeforeOrAt: new Date(snapshot.snapshotUpperBoundMs),
        })
      : [];
    const page = this.paginateFeed(
      items,
      'dictionary-terms',
      pagination,
      (item) => item.updatedAtMs,
      (item) => item.id,
      snapshot,
    );
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getDictionaryTerm(scope: RagReadContext, termId: string) {
    if (!this.projection.isDictionaryEnabled(scope.space)) {
      throw new NotFoundException('Dictionary term not found');
    }
    const items = await this.loadDictionaryTerms(scope, { termId });
    const item = items[0];
    if (!item) throw new NotFoundException('Dictionary term not found');
    return item;
  }

  async getDictionaryUpdates(
    scope: RagReadContext,
    updatedSinceMs: number,
    pagination: RagFeedPagination = {},
  ) {
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'dictionary-updates',
      updatedSinceMs,
      pagination.cursor,
    );
    const items = this.projection.isDictionaryEnabled(scope.space)
      ? await this.loadDictionaryTerms(scope, {
          updatedAfterOrAt: new Date(updatedSinceMs),
          updatedBeforeOrAt: new Date(snapshot.snapshotUpperBoundMs),
        })
      : [];
    const changes = items.map((item) => ({
      type: 'dictionaryTerm' as const,
      id: item.id,
      term: item.term,
      updatedAt: item.updatedAt,
      updatedAtMs: item.updatedAtMs,
    }));
    const page = this.paginateFeed(
      changes,
      'dictionary-updates',
      pagination,
      (item) => item.updatedAtMs,
      (item) => item.id,
      snapshot,
    );
    return {
      items: page.items,
      maxUpdatedAtMs: this.feedWatermark(
        page,
        (item) => item.updatedAtMs,
        updatedSinceMs,
        snapshot.snapshotUpperBoundMs,
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getDictionaryDeleted(
    scope: RagReadContext,
    deletedSinceMs: number,
    pagination: RagFeedPagination = {},
  ) {
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'dictionary-deleted',
      deletedSinceMs,
      pagination.cursor,
    );
    const deletedAtMs = this.millisecondTimestamp('deletedAt');
    const rows = await this.db
      .selectFrom('dictionaryTerms')
      .select(['id', 'deletedAt'])
      .where('workspaceId', '=', scope.workspace.id)
      .where('spaceId', '=', scope.space.id)
      .where('deletedAt', 'is not', null)
      .where('deletedAt', '>=', new Date(deletedSinceMs))
      .where(deletedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs))
      .orderBy(deletedAtMs, 'asc')
      .orderBy('id', 'asc')
      .execute();
    const items = rows.map((row) => ({
      type: 'dictionaryTerm' as const,
      id: row.id,
      deletedAt: row.deletedAt!,
      deletedAtMs: new Date(row.deletedAt!).getTime(),
    }));
    const page = this.paginateFeed(
      items,
      'dictionary-deleted',
      pagination,
      (item) => item.deletedAtMs,
      (item) => item.id,
      snapshot,
    );
    return {
      items: page.items,
      maxDeletedAtMs: this.feedWatermark(
        page,
        (item) => item.deletedAtMs,
        deletedSinceMs,
        snapshot.snapshotUpperBoundMs,
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getUpdates(
    scope: RagReadContext,
    updatedSinceMs: number,
    pagination: RagFeedPagination = {},
  ) {
    const updatedSince = new Date(updatedSinceMs);
    const readablePageIds = this.isSystemContext(scope)
      ? null
      : await this.getReadablePageIds(scope);
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'updates',
      updatedSinceMs,
      pagination.cursor,
    );
    const cursor = snapshot.cursor;
    const queryLimit = pagination.limit ? pagination.limit + 1 : null;
    const documentFields = this.getDocumentFieldsConfig(scope.space);
    const pageUpdatedAtMs = this.projectionTimestamp(
      'pages.updatedAt',
      'pages.settings',
      scope.workspace.id,
      documentFields,
    );

    let pageUpdatesQuery = this.db
      .selectFrom('pages')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        pageUpdatedAtMs.as('projectionUpdatedAt'),
      ])
      .where('pages.workspaceId', '=', scope.workspace.id)
      .where('pages.spaceId', '=', scope.space.id)
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
      .where(pageUpdatedAtMs, '>=', updatedSince)
      .where(pageUpdatedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs))
      .$if(Boolean(readablePageIds), (qb) =>
        qb.where('pages.id', 'in', [...readablePageIds!]),
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'pages.id')
              .where('databases.deletedAt', 'is', null),
          ),
        ),
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'pages.id')
              .where('databaseRows.archivedAt', 'is', null),
          ),
        ),
      );
    if (cursor) {
      const cursorDate = new Date(cursor.timestampMs);
      pageUpdatesQuery = pageUpdatesQuery.where((eb) =>
        eb.or([
          eb(pageUpdatedAtMs, '>', cursorDate),
          eb.and([
            eb(pageUpdatedAtMs, '=', cursorDate),
            eb('pages.id', '>', cursor.id),
          ]),
        ]),
      );
    }
    if (queryLimit) {
      pageUpdatesQuery = pageUpdatesQuery
        .orderBy(pageUpdatedAtMs, 'asc')
        .orderBy('pages.id', 'asc')
        .limit(queryLimit);
    }
    const pageUpdates =
      readablePageIds?.size === 0 ? [] : await pageUpdatesQuery.execute();

    const propertiesChanges = this.db
      .selectFrom('databaseProperties')
      .select([
        'databaseId',
        (eb) => eb.fn.max('updatedAt').as('propertiesUpdatedAt'),
      ])
      .groupBy('databaseId')
      .as('propertiesChanges');

    const rowsChanges = this.db
      .selectFrom('databaseRows')
      .select([
        'databaseId',
        (eb) => eb.fn.max('updatedAt').as('rowsUpdatedAt'),
      ])
      .groupBy('databaseId')
      .as('rowsChanges');

    const cellsChanges = this.db
      .selectFrom('databaseCells')
      .select([
        'databaseId',
        (eb) => eb.fn.max('updatedAt').as('cellsUpdatedAt'),
      ])
      .groupBy('databaseId')
      .as('cellsChanges');

    const rowPagesChanges = this.db
      .selectFrom('databaseRows')
      .innerJoin('pages as rowPages', 'rowPages.id', 'databaseRows.pageId')
      .select([
        'databaseRows.databaseId as databaseId',
        (eb) =>
          eb.fn
            .max(
              this.projectionTimestamp(
                'rowPages.updatedAt',
                'rowPages.settings',
                scope.workspace.id,
                documentFields,
              ),
            )
            .as('rowPagesUpdatedAt'),
      ])
      .groupBy('databaseRows.databaseId')
      .as('rowPagesChanges');

    const databasePageProjectionUpdatedAt = this.projectionTimestamp(
      'databasePages.updatedAt',
      'databasePages.settings',
      scope.workspace.id,
      documentFields,
    );
    const lastChangedAtExpression = sql<Date>`GREATEST(
      COALESCE(${this.db.dynamic.ref('databases.updatedAt')}, to_timestamp(0)),
      COALESCE(${databasePageProjectionUpdatedAt}, to_timestamp(0)),
      COALESCE(${this.db.dynamic.ref('propertiesChanges.propertiesUpdatedAt')}, to_timestamp(0)),
      COALESCE(${this.db.dynamic.ref('rowsChanges.rowsUpdatedAt')}, to_timestamp(0)),
      COALESCE(${this.db.dynamic.ref('cellsChanges.cellsUpdatedAt')}, to_timestamp(0)),
      COALESCE(${this.db.dynamic.ref('rowPagesChanges.rowPagesUpdatedAt')}, to_timestamp(0))
    )`;
    const lastChangedAtMsExpression = sql<Date>`date_trunc('milliseconds', ${lastChangedAtExpression})`;
    let activeDatabasesQuery = this.db
      .selectFrom('databases')
      .innerJoin(
        'pages as databasePages',
        'databasePages.id',
        'databases.pageId',
      )
      .leftJoin(
        propertiesChanges,
        'propertiesChanges.databaseId',
        'databases.id',
      )
      .leftJoin(rowsChanges, 'rowsChanges.databaseId', 'databases.id')
      .leftJoin(cellsChanges, 'cellsChanges.databaseId', 'databases.id')
      .leftJoin(rowPagesChanges, 'rowPagesChanges.databaseId', 'databases.id')
      .select([
        'databases.id as databaseId',
        'databasePages.id as pageId',
        'databasePages.slugId',
        'databases.name as title',
        lastChangedAtExpression.as('lastChangedAt'),
      ])
      .where('databases.workspaceId', '=', scope.workspace.id)
      .where('databases.spaceId', '=', scope.space.id)
      .where('databases.deletedAt', 'is', null)
      .where('databasePages.deletedAt', 'is', null)
      .$if(Boolean(readablePageIds), (qb) =>
        qb.where('databasePages.id', 'in', [...readablePageIds!]),
      )
      .where(lastChangedAtExpression, '>=', updatedSince)
      .where(
        lastChangedAtMsExpression,
        '<=',
        new Date(snapshot.snapshotUpperBoundMs),
      );
    if (cursor) {
      const cursorDate = new Date(cursor.timestampMs);
      activeDatabasesQuery = activeDatabasesQuery.where(
        sql<boolean>`(${lastChangedAtMsExpression} > ${cursorDate} OR (${lastChangedAtMsExpression} = ${cursorDate} AND ${this.db.dynamic.ref('databasePages.id')} > ${cursor.id}))`,
      );
    }
    if (queryLimit) {
      activeDatabasesQuery = activeDatabasesQuery
        .orderBy(lastChangedAtMsExpression, 'asc')
        .orderBy('databasePages.id', 'asc')
        .limit(queryLimit);
    }
    const activeDatabases =
      readablePageIds?.size === 0 ? [] : await activeDatabasesQuery.execute();

    const databaseUpdates: Array<{
      type: string;
      id: string;
      databaseId: string;
      slugId: string;
      title: string;
      updatedAt: Date;
      updatedAtMs: number;
    }> = [];

    for (const database of activeDatabases) {
      const lastChangedAt = database.lastChangedAt
        ? new Date(database.lastChangedAt)
        : null;

      if (!lastChangedAt || lastChangedAt < updatedSince) {
        continue;
      }

      databaseUpdates.push({
        type: 'database',
        id: database.pageId,
        databaseId: database.databaseId,
        slugId: database.slugId,
        title: database.title,
        updatedAt: lastChangedAt,
        updatedAtMs: lastChangedAt.getTime(),
      });
    }

    const items = [
      ...pageUpdates.map((page) => ({
        type: 'page',
        id: page.id,
        slugId: page.slugId,
        title: page.title,
        updatedAt: page.projectionUpdatedAt,
        updatedAtMs: new Date(page.projectionUpdatedAt).getTime(),
      })),
      ...databaseUpdates,
    ]
      // `id` is the page id in both branches, so page access rules apply to the
      // whole change feed.
      .filter((item) => !readablePageIds || readablePageIds.has(item.id))
      .sort((a, b) => {
        if (a.updatedAtMs !== b.updatedAtMs) {
          return a.updatedAtMs - b.updatedAtMs;
        }
        return a.id.localeCompare(b.id);
      });

    const page = this.paginateFeed(
      items,
      'updates',
      pagination,
      (item) => item.updatedAtMs,
      (item) => item.id,
      snapshot,
    );

    return {
      items: page.items,
      maxUpdatedAtMs: this.feedWatermark(
        page,
        (item) => item.updatedAtMs,
        updatedSinceMs,
        snapshot.snapshotUpperBoundMs,
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getDeleted(
    scope: RagReadContext,
    deletedSinceMs: number,
    pagination: RagFeedPagination = {},
  ) {
    const deletedSince = new Date(deletedSinceMs);
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'deleted',
      deletedSinceMs,
      pagination.cursor,
    );
    const cursor = snapshot.cursor;
    const queryLimit = pagination.limit ? pagination.limit + 1 : null;
    const pageDeletedAtMs = this.millisecondTimestamp('pages.deletedAt');
    const databaseDeletedAtMs = this.millisecondTimestamp(
      'databases.deletedAt',
    );
    const rowArchivedAtMs = this.millisecondTimestamp(
      'databaseRows.archivedAt',
    );

    let deletedPagesQuery = this.db
      .selectFrom('pages')
      .select(['pages.id', 'pages.deletedAt'])
      .where('pages.workspaceId', '=', scope.workspace.id)
      .where('pages.spaceId', '=', scope.space.id)
      .where('pages.deletedAt', 'is not', null)
      .where('pages.templateKind', 'is', null)
      .where('pages.deletedAt', '>=', deletedSince)
      .where(pageDeletedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs))
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'pages.id'),
          ),
        ),
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'pages.id'),
          ),
        ),
      );
    let deletedDatabasesQuery = this.db
      .selectFrom('databases')
      .select([
        'databases.id as databaseId',
        'databases.pageId',
        'databases.deletedAt',
      ])
      .where('databases.workspaceId', '=', scope.workspace.id)
      .where('databases.spaceId', '=', scope.space.id)
      .where('databases.deletedAt', 'is not', null)
      .where('databases.deletedAt', '>=', deletedSince)
      .where(
        databaseDeletedAtMs,
        '<=',
        new Date(snapshot.snapshotUpperBoundMs),
      );
    let deletedRowsQuery = this.db
      .selectFrom('databaseRows')
      .innerJoin('databases', 'databases.id', 'databaseRows.databaseId')
      .select([
        'databaseRows.id as rowId',
        'databaseRows.databaseId',
        'databaseRows.pageId',
        'databaseRows.archivedAt',
      ])
      .where('databaseRows.workspaceId', '=', scope.workspace.id)
      .where('databases.workspaceId', '=', scope.workspace.id)
      .where('databases.spaceId', '=', scope.space.id)
      .where('databaseRows.archivedAt', 'is not', null)
      .where('databaseRows.archivedAt', '>=', deletedSince)
      .where(rowArchivedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs));
    if (cursor) {
      const cursorDate = new Date(cursor.timestampMs);
      deletedPagesQuery = deletedPagesQuery.where((eb) =>
        eb.or([
          eb(pageDeletedAtMs, '>', cursorDate),
          eb.and([
            eb(pageDeletedAtMs, '=', cursorDate),
            eb('pages.id', '>', cursor.id),
          ]),
        ]),
      );
      deletedDatabasesQuery = deletedDatabasesQuery.where(
        sql<boolean>`(${databaseDeletedAtMs} > ${cursorDate} OR (${databaseDeletedAtMs} = ${cursorDate} AND COALESCE(${this.db.dynamic.ref('databases.pageId')}, ${this.db.dynamic.ref('databases.id')}) > ${cursor.id}))`,
      );
      deletedRowsQuery = deletedRowsQuery.where((eb) =>
        eb.or([
          eb(rowArchivedAtMs, '>', cursorDate),
          eb.and([
            eb(rowArchivedAtMs, '=', cursorDate),
            eb('databaseRows.pageId', '>', cursor.id),
          ]),
        ]),
      );
    }
    if (queryLimit) {
      deletedPagesQuery = deletedPagesQuery
        .orderBy(pageDeletedAtMs, 'asc')
        .orderBy('pages.id', 'asc')
        .limit(queryLimit);
      deletedDatabasesQuery = deletedDatabasesQuery
        .orderBy(databaseDeletedAtMs, 'asc')
        .orderBy(
          sql<string>`COALESCE(${this.db.dynamic.ref('databases.pageId')}, ${this.db.dynamic.ref('databases.id')})`,
          'asc',
        )
        .limit(queryLimit);
      deletedRowsQuery = deletedRowsQuery
        .orderBy(rowArchivedAtMs, 'asc')
        .orderBy('databaseRows.pageId', 'asc')
        .limit(queryLimit);
    }
    const [deletedPages, deletedDatabases, deletedRows] = await Promise.all([
      deletedPagesQuery.execute(),
      deletedDatabasesQuery.execute(),
      deletedRowsQuery.execute(),
    ]);

    const items = [
      ...deletedPages.map((page) => ({
        type: 'page',
        id: page.id,
        slugId: null,
        title: null,
        parentPageId: null,
        deletedAt: page.deletedAt,
        deletedAtMs: new Date(page.deletedAt).getTime(),
      })),
      ...deletedDatabases.map((database) => ({
        type: 'database',
        id: database.pageId ?? database.databaseId,
        databaseId: database.databaseId,
        slugId: null,
        title: null,
        parentPageId: null,
        deletedAt: database.deletedAt,
        deletedAtMs: new Date(database.deletedAt).getTime(),
      })),
      ...deletedRows.map((row) => ({
        type: 'databaseRow',
        id: row.pageId,
        rowId: row.rowId,
        databaseId: row.databaseId,
        slugId: null,
        title: null,
        parentPageId: null,
        deletedAt: row.archivedAt,
        deletedAtMs: new Date(row.archivedAt).getTime(),
      })),
    ]
      .filter((item) => Boolean(item.id))
      .sort((a, b) => {
        if (a.deletedAtMs !== b.deletedAtMs) {
          return a.deletedAtMs - b.deletedAtMs;
        }
        return a.id.localeCompare(b.id);
      });

    const page = this.paginateFeed(
      items,
      'deleted',
      pagination,
      (item) => item.deletedAtMs,
      (item) => String(item.id),
      snapshot,
    );

    return {
      items: page.items,
      maxDeletedAtMs: this.feedWatermark(
        page,
        (item) => item.deletedAtMs,
        deletedSinceMs,
        snapshot.snapshotUpperBoundMs,
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getAttachmentUpdates(
    scope: RagReadContext,
    updatedSinceMs: number,
    pagination: RagFeedPagination = {},
  ) {
    const readablePageIds = this.isSystemContext(scope)
      ? null
      : await this.getReadablePageIds(scope);
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'attachment-updates',
      updatedSinceMs,
      pagination.cursor,
    );
    const cursor = snapshot.cursor;
    const queryLimit = pagination.limit ? pagination.limit + 1 : null;
    const updatedAtMs = this.millisecondTimestamp('attachments.updatedAt');
    let rowsQuery = this.db
      .selectFrom('attachments')
      .innerJoin(
        'pages as attachmentPages',
        'attachmentPages.id',
        'attachments.pageId',
      )
      .select([
        'attachments.id',
        'attachments.fileName',
        'attachments.fileSize',
        'attachments.fileExt',
        'attachments.mimeType',
        'attachments.pageId',
        'attachments.spaceId',
        'attachments.createdAt',
        'attachments.updatedAt',
      ])
      .where('attachments.workspaceId', '=', scope.workspace.id)
      .where('attachments.spaceId', '=', scope.space.id)
      .where('attachments.pageId', 'is not', null)
      .where('attachmentPages.workspaceId', '=', scope.workspace.id)
      .where('attachmentPages.spaceId', '=', scope.space.id)
      .where('attachmentPages.deletedAt', 'is', null)
      .$if(Boolean(readablePageIds), (qb) =>
        qb.where('attachments.pageId', 'in', [...readablePageIds!]),
      )
      .where('attachments.deletedAt', 'is', null)
      .where('attachments.updatedAt', '>=', new Date(updatedSinceMs))
      .where(updatedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs));
    if (cursor) {
      const cursorDate = new Date(cursor.timestampMs);
      rowsQuery = rowsQuery.where((eb) =>
        eb.or([
          eb(updatedAtMs, '>', cursorDate),
          eb.and([
            eb(updatedAtMs, '=', cursorDate),
            eb('attachments.id', '>', cursor.id),
          ]),
        ]),
      );
    }
    if (queryLimit) {
      rowsQuery = rowsQuery
        .orderBy(updatedAtMs, 'asc')
        .orderBy('attachments.id', 'asc')
        .limit(queryLimit);
    }
    const rows = readablePageIds?.size === 0 ? [] : await rowsQuery.execute();
    const items = rows
      .filter((row) => Boolean(row.pageId && row.spaceId))
      .map((row) => ({
        id: row.id,
        fileId: row.id,
        fileName: row.fileName,
        fileExt: row.fileExt,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
        pageId: row.pageId!,
        spaceId: row.spaceId!,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        updatedAtMs: new Date(row.updatedAt).getTime(),
        downloadUrl: `/api/rag/attachments/${row.id}/${encodeURIComponent(
          row.fileName,
        )}`,
      }))
      .sort(
        (left, right) =>
          left.updatedAtMs - right.updatedAtMs ||
          left.id.localeCompare(right.id),
      );
    const page = this.paginateFeed(
      items,
      'attachment-updates',
      pagination,
      (item) => item.updatedAtMs,
      (item) => item.id,
      snapshot,
    );
    return {
      items: page.items,
      maxUpdatedAtMs: this.feedWatermark(
        page,
        (item) => item.updatedAtMs,
        updatedSinceMs,
        snapshot.snapshotUpperBoundMs,
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getAttachmentDeleted(
    scope: RagReadContext,
    deletedSinceMs: number,
    pagination: RagFeedPagination = {},
  ) {
    const snapshot = await this.prepareFeedSnapshot(
      scope,
      'attachment-deleted',
      deletedSinceMs,
      pagination.cursor,
    );
    const cursor = snapshot.cursor;
    const queryLimit = pagination.limit ? pagination.limit + 1 : null;
    const deletedAtMs = this.millisecondTimestamp('deletedAt');
    let rowsQuery = this.db
      .selectFrom('attachments')
      .select(['id', 'deletedAt'])
      .where('workspaceId', '=', scope.workspace.id)
      .where('spaceId', '=', scope.space.id)
      .where('deletedAt', 'is not', null)
      .where('deletedAt', '>=', new Date(deletedSinceMs))
      .where(deletedAtMs, '<=', new Date(snapshot.snapshotUpperBoundMs));
    if (cursor) {
      const cursorDate = new Date(cursor.timestampMs);
      rowsQuery = rowsQuery.where((eb) =>
        eb.or([
          eb(deletedAtMs, '>', cursorDate),
          eb.and([eb(deletedAtMs, '=', cursorDate), eb('id', '>', cursor.id)]),
        ]),
      );
    }
    if (queryLimit) {
      rowsQuery = rowsQuery
        .orderBy(deletedAtMs, 'asc')
        .orderBy('id', 'asc')
        .limit(queryLimit);
    }
    const rows = await rowsQuery.execute();
    const items = rows
      .map((row) => ({
        id: row.id,
        fileId: row.id,
        pageId: null,
        spaceId: null,
        deletedAt: row.deletedAt!,
        deletedAtMs: new Date(row.deletedAt!).getTime(),
      }))
      .sort(
        (left, right) =>
          left.deletedAtMs - right.deletedAtMs ||
          left.id.localeCompare(right.id),
      );
    const page = this.paginateFeed(
      items,
      'attachment-deleted',
      pagination,
      (item) => item.deletedAtMs,
      (item) => item.id,
      snapshot,
    );
    return {
      items: page.items,
      maxDeletedAtMs: this.feedWatermark(
        page,
        (item) => item.deletedAtMs,
        deletedSinceMs,
        snapshot.snapshotUpperBoundMs,
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getDatabaseInfo(scope: RagReadContext, databaseIdOrPageSlug: string) {
    const database = await this.resolveDatabaseInScope(
      databaseIdOrPageSlug,
      scope,
    );
    const databasePage = await this.resolvePageInScope(database.pageId, scope, {
      includeContent: true,
    });

    const [properties, rows] = await Promise.all([
      this.databasePropertyRepo.findByDatabaseId(database.id),
      this.loadRowsWithContent(database.id, scope),
    ]);

    const normalizedProperties = properties.map((property) => ({
      id: property.id,
      name: property.name,
      type: property.type,
      position: property.position,
      settings: property.settings ?? {},
      createdAt: property.createdAt,
      updatedAt: property.updatedAt,
    }));

    const tableMarkdown = this.buildDatabaseTableMarkdown(
      normalizedProperties,
      rows,
    );
    const descriptionMarkdown =
      this.toMarkdown(database.descriptionContent) ??
      database.description ??
      '';
    const pageContentMarkdown = this.toMarkdown(databasePage.content) ?? '';
    const rowsMarkdown = rows
      .map((row) => {
        const title = row.page?.title || row.pageTitle || row.pageId;
        const body = row.rowMarkdown?.trim();
        return body ? `## ${title}\n\n${body}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    const documentFields = this.getDocumentFieldsConfig(scope.space);
    const customFields = this.buildCustomFields(
      databasePage.settings,
      documentFields,
    );
    const members = await this.projection.resolveMembers(scope.workspace.id, [
      customFields,
    ]);
    const memberNames = this.projection.memberNames(members);
    const baseProjectionUpdatedAt = new Date(
      Math.max(
        new Date(database.updatedAt).getTime(),
        new Date(databasePage.updatedAt).getTime(),
        ...normalizedProperties.map((property) =>
          new Date(property.updatedAt).getTime(),
        ),
        ...rows.map((row) =>
          new Date(row.projectionUpdatedAt).getTime(),
        ),
      ),
    );
    const projectionUpdatedAt = this.projection.projectionUpdatedAtFromMembers(
      baseProjectionUpdatedAt,
      customFields,
      members,
    );
    const knowledgeMarkdownParts = [
      `# ${database.name}`,
      this.projection.renderDocumentFields(customFields, memberNames),
      this.projection.renderDatabaseSchema(normalizedProperties),
      descriptionMarkdown?.trim()
        ? `## Description\n\n${descriptionMarkdown}`
        : '',
      pageContentMarkdown.trim()
        ? `## Database page\n\n${pageContentMarkdown}`
        : '',
      tableMarkdown?.trim() ? `## Table\n\n${tableMarkdown}` : '',
      rowsMarkdown?.trim() ? `## Rows\n\n${rowsMarkdown}` : '',
    ].filter(Boolean);

    return {
      id: databasePage.id,
      slugId: databasePage.slugId,
      databaseId: database.id,
      type: 'database',
      name: database.name,
      title: database.name,
      icon: database.icon,
      parentPageId: databasePage.parentPageId,
      position: databasePage.position,
      spaceId: database.spaceId,
      settings: mapPageSettings(databasePage.settings),
      customFields,
      descriptionMarkdown,
      pageContentMarkdown: this.toMarkdown(databasePage.content),
      properties: normalizedProperties,
      rows,
      knowledgeMarkdown: knowledgeMarkdownParts.join('\n\n'),
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
      projectionUpdatedAt,
    };
  }

  async getDatabaseSyncMetadata(
    scope: RagSystemContext,
    databaseIdOrPageSlug: string,
  ) {
    const database = await this.resolveDatabaseInScope(
      databaseIdOrPageSlug,
      scope,
    );
    const databasePage = await this.resolvePageInScope(database.pageId, scope, {
      includeContent: true,
    });
    const descriptionMarkdown =
      this.toMarkdown(database.descriptionContent) ??
      database.description ??
      '';
    const pageContentMarkdown = this.toMarkdown(databasePage.content) ?? '';
    const properties = await this.databasePropertyRepo.findByDatabaseId(
      database.id,
    );
    const documentFields = this.getDocumentFieldsConfig(scope.space);
    const customFields = this.buildCustomFields(
      databasePage.settings,
      documentFields,
    );
    const members = await this.projection.resolveMembers(scope.workspace.id, [
      customFields,
    ]);
    const memberNames = this.projection.memberNames(members);
    return {
      id: databasePage.id,
      databaseId: database.id,
      title: database.name,
      customFields,
      knowledgeMarkdown: [
        this.projection.renderDocumentFields(customFields, memberNames),
        this.projection.renderDatabaseSchema(properties),
        descriptionMarkdown.trim()
          ? `## Description\n\n${descriptionMarkdown}`
          : '',
        pageContentMarkdown.trim()
          ? `## Database page\n\n${pageContentMarkdown}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  async getDatabaseSyncRowsPage(
    scope: RagSystemContext,
    databaseId: string,
    options: { cursor?: string; limit: number },
  ) {
    const database = await this.resolveDatabaseInScope(databaseId, scope);
    const page = await this.databaseRowRepo.findByDatabaseIdPaginated(
      database.id,
      scope.workspace.id,
      scope.space.id,
      {
        limit: Math.min(100, Math.max(1, options.limit)),
        cursor: options.cursor,
      },
    );
    const rows = await this.hydrateRowsWithContent(page.items, scope);
    return {
      items: rows,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async getDatabaseRows(
    scope: RagReadContext,
    databaseIdOrPageSlug: string,
    pageIds?: string[],
  ) {
    const database = await this.resolveDatabaseInScope(
      databaseIdOrPageSlug,
      scope,
    );

    const rows = await this.loadRowsWithContent(database.id, scope, {
      pageIds: pageIds ?? [],
    });

    return {
      databaseId: database.id,
      items: rows,
    };
  }

  async getPageAttachments(scope: RagReadContext, pageIdOrSlug: string) {
    const page = await this.resolvePageInScope(pageIdOrSlug, scope, {
      includeContent: false,
    });

    const attachments = await this.db
      .selectFrom('attachments')
      .select([
        'id',
        'fileName',
        'fileSize',
        'fileExt',
        'mimeType',
        'filePath',
        'pageId',
        'spaceId',
        'createdAt',
        'updatedAt',
      ])
      .where('workspaceId', '=', scope.workspace.id)
      .where('spaceId', '=', scope.space.id)
      .where('pageId', '=', page.id)
      .where('deletedAt', 'is', null)
      .execute();
    const customFields = this.buildCustomFields(
      page.settings,
      this.getDocumentFieldsConfig(scope.space),
    );

    return {
      pageId: page.id,
      items: attachments.map((attachment) => ({
        id: attachment.id,
        fileId: attachment.id,
        fileName: attachment.fileName,
        fileExt: attachment.fileExt,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        pageId: attachment.pageId,
        spaceId: attachment.spaceId,
        createdAt: attachment.createdAt,
        updatedAt: attachment.updatedAt,
        downloadUrl: `/api/rag/attachments/${attachment.id}/${encodeURIComponent(attachment.fileName)}`,
        customFields,
      })),
    };
  }

  async getComments(scope: RagReadContext, pageIdOrSlug: string) {
    const page = await this.resolvePageInScope(pageIdOrSlug, scope, {
      includeContent: false,
    });

    const comments = await this.db
      .selectFrom('comments')
      .selectAll('comments')
      .select((eb) => this.commentRepo.withCreator(eb))
      .select((eb) => this.commentRepo.withResolvedBy(eb))
      .where('workspaceId', '=', scope.workspace.id)
      .where('spaceId', '=', scope.space.id)
      .where('pageId', '=', page.id)
      .where('deletedAt', 'is', null)
      .orderBy('id', 'asc')
      .execute();

    return {
      pageId: page.id,
      items: comments,
    };
  }

  async exportPage(
    scope: RagAuthContext,
    pageIdOrSlug: string,
    opts: {
      format: 'markdown' | 'html';
      includeAttachments: boolean;
      includeChildren: boolean;
    },
  ) {
    const page = await this.resolvePageInScope(pageIdOrSlug, scope, {
      includeContent: false,
    });

    const stream = await this.exportService.exportPages(
      page.id,
      opts.format,
      opts.includeAttachments,
      opts.includeChildren,
      undefined,
      undefined,
      // An API key never grants more than its creator can read.
      scope.user,
      await this.getReadablePageIds(scope),
    );

    return {
      page,
      stream,
    };
  }

  async exportSpace(
    scope: RagAuthContext,
    opts: {
      format: 'markdown' | 'html';
      includeAttachments: boolean;
    },
  ) {
    return this.exportService.exportSpace(
      scope.space.id,
      opts.format,
      opts.includeAttachments,
      undefined,
      undefined,
      await this.getReadablePageIds(scope),
      scope.user,
    );
  }

  async resolveAttachmentForDownload(scope: RagReadContext, fileId: string) {
    const attachment = await this.attachmentRepo.findById(fileId);

    if (!attachment || attachment.deletedAt) {
      throw new NotFoundException('File not found');
    }

    if (attachment.workspaceId !== scope.workspace.id) {
      throw new NotFoundException('File not found');
    }

    if (attachment.spaceId !== scope.space.id) {
      throw new ForbiddenException('File is outside API key scope');
    }

    if (!attachment.pageId || !attachment.spaceId) {
      throw new NotFoundException('File not found');
    }

    const page = await this.pageRepo.findById(attachment.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== scope.workspace.id ||
      page.spaceId !== scope.space.id
    ) {
      throw new NotFoundException('File not found');
    }
    if (!this.isSystemContext(scope)) {
      const access = await this.pageAccessService.getEffectiveAccess(
        page,
        scope.user,
      );
      if (!access.capabilities.canRead) {
        throw new ForbiddenException('File is outside API key scope');
      }
    }
    if (
      await this.contentPolicy.isPageExcluded(
        page.id,
        scope.space.id,
        scope.workspace.id,
      )
    ) {
      throw new ForbiddenException('File is excluded from AI and RAG');
    }

    return attachment;
  }

  private isSystemContext(scope: RagReadContext): scope is RagSystemContext {
    return 'accessMode' in scope && scope.accessMode === 'system';
  }

  private millisecondTimestamp(reference: string) {
    return sql<Date>`date_trunc('milliseconds', ${this.db.dynamic.ref(reference)})`;
  }

  private projectionTimestamp(
    updatedAtReference: string,
    settingsReference: string,
    workspaceId: string,
    config: KnowledgeDocumentFieldsConfig,
  ) {
    const sourceUpdatedAt = this.millisecondTimestamp(updatedAtReference);
    const settings = this.db.dynamic.ref(settingsReference);
    const memberConditions: Array<ReturnType<typeof sql<boolean>>> = [];

    if (config.assignee) {
      memberConditions.push(
        sql<boolean>`projection_users.id::text = ${settings} ->> 'assigneeId'`,
      );
    }
    if (config.stakeholders) {
      memberConditions.push(
        sql<boolean>`COALESCE(${settings} -> 'stakeholderIds', '[]'::jsonb) ? projection_users.id::text`,
      );
    }
    if (memberConditions.length === 0) return sourceUpdatedAt;

    return sql<Date>`GREATEST(
      ${sourceUpdatedAt},
      COALESCE((
        SELECT MAX(date_trunc('milliseconds', projection_users.updated_at))
        FROM users AS projection_users
        WHERE projection_users.workspace_id = ${workspaceId}
          AND (${sql.join(memberConditions, sql` OR `)})
      ), to_timestamp(0))
    )`;
  }

  private async loadDictionaryTerms(
    scope: RagReadContext,
    filters: {
      termId?: string;
      updatedAfterOrAt?: Date;
      updatedBeforeOrAt?: Date;
    },
  ) {
    let query = this.db
      .selectFrom('dictionaryTerms')
      .selectAll()
      .where('workspaceId', '=', scope.workspace.id)
      .where('spaceId', '=', scope.space.id)
      .where('deletedAt', 'is', null);
    if (filters.termId) query = query.where('id', '=', filters.termId);
    if (filters.updatedAfterOrAt) {
      query = query.where('updatedAt', '>=', filters.updatedAfterOrAt);
    }
    if (filters.updatedBeforeOrAt) {
      query = query.where('updatedAt', '<=', filters.updatedBeforeOrAt);
    }
    const terms = await query
      .orderBy('updatedAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
    if (terms.length === 0) return [];

    const aliases = await this.db
      .selectFrom('dictionaryTermAliases')
      .select(['termId', 'alias', 'isPrimary'])
      .where(
        'termId',
        'in',
        terms.map((term) => term.id),
      )
      .orderBy('alias', 'asc')
      .execute();
    const formsByTerm = new Map<string, string[]>();
    for (const alias of aliases) {
      if (alias.isPrimary) continue;
      const forms = formsByTerm.get(alias.termId) ?? [];
      forms.push(alias.alias);
      formsByTerm.set(alias.termId, forms);
    }

    return terms.map((term) => {
      const forms = formsByTerm.get(term.id) ?? [];
      return {
        id: term.id,
        workspaceId: term.workspaceId,
        spaceId: term.spaceId,
        term: term.term,
        forms,
        definitionMarkdown: term.definitionMarkdown,
        knowledgeMarkdown: this.projection.renderDictionaryKnowledgeMarkdown({
          term: term.term,
          forms,
          definitionMarkdown: term.definitionMarkdown,
        }),
        createdAt: term.createdAt,
        updatedAt: term.updatedAt,
        updatedAtMs: new Date(term.updatedAt).getTime(),
      };
    });
  }

  private async prepareFeedSnapshot(
    scope: RagReadContext,
    kind: string,
    watermarkMs: number | null,
    cursorValue?: string,
  ): Promise<RagFeedSnapshot> {
    const scopeFingerprint = await this.getFeedScopeFingerprint(scope);
    if (cursorValue) {
      const cursor = this.decodeFeedCursor(cursorValue, {
        kind,
        workspaceId: scope.workspace.id,
        spaceId: scope.space.id,
        scopeFingerprint,
        watermarkMs,
      });
      return {
        cursor,
        workspaceId: cursor.workspaceId,
        spaceId: cursor.spaceId,
        scopeFingerprint: cursor.scopeFingerprint,
        watermarkMs: cursor.watermarkMs,
        snapshotUpperBoundMs: cursor.snapshotUpperBoundMs,
      };
    }
    const snapshot = await this.db
      .selectFrom('workspaces')
      .select(
        sql<Date>`date_trunc('milliseconds', clock_timestamp())`.as(
          'snapshotUpperBound',
        ),
      )
      .where('id', '=', scope.workspace.id)
      .executeTakeFirst();
    const snapshotUpperBoundMs = snapshot?.snapshotUpperBound
      ? new Date(snapshot.snapshotUpperBound).getTime()
      : Date.now();
    if (
      !Number.isSafeInteger(snapshotUpperBoundMs) ||
      snapshotUpperBoundMs < 0
    ) {
      throw new BadRequestException('Invalid RAG feed cursor');
    }
    return {
      cursor: null,
      workspaceId: scope.workspace.id,
      spaceId: scope.space.id,
      scopeFingerprint,
      watermarkMs,
      snapshotUpperBoundMs,
    };
  }

  private async getFeedScopeFingerprint(
    scope: RagReadContext,
  ): Promise<string> {
    const policy = await this.contentPolicy.getEffectivePolicy(
      scope.space.id,
      scope.workspace.id,
    );
    return createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: 2,
          ...this.projection.fingerprintInput(scope.space),
          workspaceId: scope.workspace.id,
          spaceId: scope.space.id,
          policyFingerprint: policy.fingerprint,
          principal: this.isSystemContext(scope)
            ? { accessMode: 'system' }
            : { userId: scope.user.id, userRole: scope.user.role ?? null },
        }),
      )
      .digest('hex');
  }

  private paginateFeed<T>(
    items: T[],
    kind: string,
    pagination: RagFeedPagination,
    timestamp: (item: T) => number,
    identity: (item: T) => string,
    snapshot: RagFeedSnapshot,
  ): {
    items: T[];
    hasMore: boolean;
    nextCursor: string | null;
  } {
    const cursor = snapshot.cursor;
    const remaining = cursor
      ? items.filter((item) => {
          const itemTimestamp = timestamp(item);
          return (
            itemTimestamp > cursor.timestampMs ||
            (itemTimestamp === cursor.timestampMs &&
              identity(item).localeCompare(cursor.id) > 0)
          );
        })
      : items;
    const limit = pagination.limit ?? remaining.length;
    const pageItems = remaining.slice(0, limit);
    const hasMore = pageItems.length < remaining.length;
    const last = pageItems.at(-1);
    return {
      items: pageItems,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                version: 2,
                kind,
                workspaceId: snapshot.workspaceId,
                spaceId: snapshot.spaceId,
                scopeFingerprint: snapshot.scopeFingerprint,
                watermarkMs: snapshot.watermarkMs,
                snapshotUpperBoundMs: snapshot.snapshotUpperBoundMs,
                timestampMs: timestamp(last),
                id: identity(last),
              } satisfies RagFeedCursor),
              'utf8',
            ).toString('base64url')
          : null,
    };
  }

  private feedWatermark<T>(
    page: { items: T[]; hasMore: boolean },
    timestamp: (item: T) => number,
    initialWatermarkMs: number,
    snapshotUpperBoundMs: number,
  ): number {
    if (!page.hasMore) return snapshotUpperBoundMs;
    return page.items.length > 0
      ? Math.max(...page.items.map(timestamp))
      : initialWatermarkMs;
  }

  private decodeFeedCursor(
    value: string,
    expected: {
      kind: string;
      workspaceId: string;
      spaceId: string;
      scopeFingerprint: string;
      watermarkMs: number | null;
    },
  ): RagFeedCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as Partial<RagFeedCursor>;
      if (
        parsed.version !== 2 ||
        parsed.kind !== expected.kind ||
        parsed.workspaceId !== expected.workspaceId ||
        parsed.spaceId !== expected.spaceId ||
        parsed.scopeFingerprint !== expected.scopeFingerprint ||
        parsed.watermarkMs !== expected.watermarkMs ||
        !Number.isSafeInteger(parsed.snapshotUpperBoundMs) ||
        Number(parsed.snapshotUpperBoundMs) < 0 ||
        !Number.isSafeInteger(parsed.timestampMs) ||
        Number(parsed.timestampMs) < 0 ||
        Number(parsed.timestampMs) > Number(parsed.snapshotUpperBoundMs) ||
        typeof parsed.id !== 'string' ||
        parsed.id.length === 0
      ) {
        throw new Error('Invalid cursor');
      }
      return parsed as RagFeedCursor;
    } catch {
      throw new BadRequestException('Invalid RAG feed cursor');
    }
  }
}
