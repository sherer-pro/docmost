import {
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

interface RagAuthContext {
  user: User;
  workspace: Workspace;
  space: Space;
}

interface RagDocumentFieldsConfig {
  status: boolean;
  assignee: boolean;
  stakeholders: boolean;
}

@Injectable()
export class RagService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly databaseRepo: DatabaseRepo,
    private readonly databasePropertyRepo: DatabasePropertyRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly commentRepo: CommentRepo,
    private readonly exportService: ExportService,
  ) {}

  private getDocumentFieldsConfig(space: Space): RagDocumentFieldsConfig {
    const documentFields = (space?.settings as any)?.documentFields ?? {};

    return {
      status: Boolean(documentFields.status),
      assignee: Boolean(documentFields.assignee),
      stakeholders: Boolean(documentFields.stakeholders),
    };
  }

  private buildCustomFields(
    settings: unknown,
    docFields: RagDocumentFieldsConfig,
  ): Record<string, unknown> | undefined {
    const normalized = settings && typeof settings === 'object' ? settings : {};
    const customFields: Record<string, unknown> = {};

    if (docFields.status) {
      customFields.status =
        typeof normalized['status'] === 'string' ? normalized['status'] : null;
    }

    if (docFields.assignee) {
      customFields.assigneeId =
        typeof normalized['assigneeId'] === 'string'
          ? normalized['assigneeId']
          : null;
    }

    if (docFields.stakeholders) {
      customFields.stakeholderIds = Array.isArray(normalized['stakeholderIds'])
        ? normalized['stakeholderIds']
            .filter((entry: unknown) => typeof entry === 'string')
            .filter(Boolean)
        : [];
    }

    return Object.keys(customFields).length > 0 ? customFields : undefined;
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
    scope: RagAuthContext,
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

    return page;
  }

  private async resolveDatabaseInScope(
    databaseIdOrPageSlug: string,
    scope: RagAuthContext,
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
      database = await this.databaseRepo.findByPageId(page.id, scope.workspace.id);
    }

    if (!database) {
      throw new NotFoundException('Database not found');
    }

    if (database.spaceId !== scope.space.id) {
      throw new ForbiddenException('Database is outside API key scope');
    }

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

  private buildDatabaseTableMarkdown(
    properties: any[],
    rows: any[],
  ): string {
    const header = ['Title', ...properties.map((item) => item.name || 'Column')];
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
    scope: RagAuthContext,
    opts?: { pageIds?: string[] },
  ) {
    const allRows = await this.databaseRowRepo.findByDatabaseId(
      databaseId,
      scope.workspace.id,
      scope.space.id,
    );

    const rowList =
      opts?.pageIds && opts.pageIds.length > 0
        ? allRows.filter((row) => opts.pageIds.includes(row.pageId))
        : allRows;

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
            ])
            .where('id', 'in', rowPageIds)
            .where('spaceId', '=', scope.space.id)
            .execute()
        : [];

    const rowPageMap = new Map(rowPages.map((row) => [row.id, row]));
    const documentFields = this.getDocumentFieldsConfig(scope.space);

    return rowList.map((row) => {
      const rowPage = rowPageMap.get(row.pageId);
      const rowMarkdown = this.toMarkdown(rowPage?.content ?? null);

      return {
        id: row.id,
        databaseId: row.databaseId,
        pageId: row.pageId,
        pageSlugId: row.pageSlugId,
        pageTitle: row.pageTitle,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        page: rowPage
          ? {
              id: rowPage.id,
              slugId: rowPage.slugId,
              title: rowPage.title,
              icon: rowPage.icon,
              parentPageId: rowPage.parentPageId,
              position: rowPage.position,
              customFields: this.buildCustomFields(
                rowPage.settings,
                documentFields,
              ),
            }
          : row.page,
        cells: row.cells ?? [],
        rowMarkdown,
      };
    });
  }

  async listPages(scope: RagAuthContext, includeContent = false) {
    const documentFields = this.getDocumentFieldsConfig(scope.space);

    const [regularPages, databaseNodes] = await Promise.all([
      this.db
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
        .where('pages.deletedAt', 'is', null)
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
        )
        .execute(),
      this.db
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
        ])
        .$if(includeContent, (qb) => qb.select('pages.content'))
        .where('databases.workspaceId', '=', scope.workspace.id)
        .where('databases.spaceId', '=', scope.space.id)
        .where('databases.deletedAt', 'is', null)
        .where('pages.deletedAt', 'is', null)
        .execute(),
    ]);

    const items = [
      ...regularPages.map((page) => ({
        type: 'page',
        id: page.id,
        slugId: page.slugId,
        title: page.title,
        icon: page.icon,
        parentPageId: page.parentPageId,
        position: page.position,
        customFields: this.buildCustomFields(page.settings, documentFields),
        settings: mapPageSettings(page.settings),
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
        ...(includeContent
          ? { contentMarkdown: this.toMarkdown((page as any).content) }
          : {}),
      })),
      ...databaseNodes.map((database) => ({
        type: 'database',
        id: database.id,
        databaseId: database.databaseId,
        slugId: database.slugId,
        title: database.title,
        icon: database.icon,
        parentPageId: database.parentPageId,
        position: database.position,
        customFields: this.buildCustomFields(database.settings, documentFields),
        settings: mapPageSettings(database.settings),
        createdAt: database.createdAt,
        updatedAt: database.updatedAt,
        ...(includeContent
          ? {
              descriptionMarkdown:
                this.toMarkdown(database.descriptionContent) ??
                database.description ??
                '',
              contentMarkdown: this.toMarkdown((database as any).content),
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

    return { items };
  }

  async getPageInfo(
    scope: RagAuthContext,
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
      customFields: this.buildCustomFields(page.settings, documentFields),
      databaseId: linkedDatabase?.id ?? activeRow?.databaseId ?? null,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      ...(includeContent ? { contentMarkdown: this.toMarkdown(page.content) } : {}),
    };
  }

  async getUpdates(scope: RagAuthContext, updatedSinceMs: number) {
    const updatedSince = new Date(updatedSinceMs);

    const pageUpdates = await this.db
      .selectFrom('pages')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.updatedAt',
      ])
      .where('pages.workspaceId', '=', scope.workspace.id)
      .where('pages.spaceId', '=', scope.space.id)
      .where('pages.deletedAt', 'is', null)
      .where('pages.updatedAt', '>=', updatedSince)
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
      )
      .execute();

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
        (eb) => eb.fn.max('rowPages.updatedAt').as('rowPagesUpdatedAt'),
      ])
      .groupBy('databaseRows.databaseId')
      .as('rowPagesChanges');

    const activeDatabases = await this.db
      .selectFrom('databases')
      .innerJoin('pages as databasePages', 'databasePages.id', 'databases.pageId')
      .leftJoin(propertiesChanges, 'propertiesChanges.databaseId', 'databases.id')
      .leftJoin(rowsChanges, 'rowsChanges.databaseId', 'databases.id')
      .leftJoin(cellsChanges, 'cellsChanges.databaseId', 'databases.id')
      .leftJoin(rowPagesChanges, 'rowPagesChanges.databaseId', 'databases.id')
      .select([
        'databases.id as databaseId',
        'databasePages.id as pageId',
        'databasePages.slugId',
        'databases.name as title',
        sql<Date>`GREATEST(
          COALESCE(${this.db.dynamic.ref('databases.updatedAt')}, to_timestamp(0)),
          COALESCE(${this.db.dynamic.ref('databasePages.updatedAt')}, to_timestamp(0)),
          COALESCE(${this.db.dynamic.ref('propertiesChanges.propertiesUpdatedAt')}, to_timestamp(0)),
          COALESCE(${this.db.dynamic.ref('rowsChanges.rowsUpdatedAt')}, to_timestamp(0)),
          COALESCE(${this.db.dynamic.ref('cellsChanges.cellsUpdatedAt')}, to_timestamp(0)),
          COALESCE(${this.db.dynamic.ref('rowPagesChanges.rowPagesUpdatedAt')}, to_timestamp(0))
        )`.as('lastChangedAt'),
      ])
      .where('databases.workspaceId', '=', scope.workspace.id)
      .where('databases.spaceId', '=', scope.space.id)
      .where('databases.deletedAt', 'is', null)
      .where('databasePages.deletedAt', 'is', null)
      .execute();

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
        updatedAt: page.updatedAt,
        updatedAtMs: new Date(page.updatedAt).getTime(),
      })),
      ...databaseUpdates,
    ].sort((a, b) => {
      if (a.updatedAtMs !== b.updatedAtMs) {
        return a.updatedAtMs - b.updatedAtMs;
      }
      return a.id.localeCompare(b.id);
    });

    const maxUpdatedAtMs =
      items.length > 0
        ? Math.max(...items.map((item) => item.updatedAtMs))
        : updatedSinceMs;

    return {
      items,
      maxUpdatedAtMs,
    };
  }

  async getDeleted(scope: RagAuthContext, deletedSinceMs: number) {
    const deletedSince = new Date(deletedSinceMs);

    const [deletedPages, deletedDatabases, deletedRows] = await Promise.all([
      this.db
        .selectFrom('pages')
        .select([
          'pages.id',
          'pages.slugId',
          'pages.title',
          'pages.parentPageId',
          'pages.deletedAt',
        ])
        .where('pages.workspaceId', '=', scope.workspace.id)
        .where('pages.spaceId', '=', scope.space.id)
        .where('pages.deletedAt', 'is not', null)
        .where('pages.deletedAt', '>=', deletedSince)
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
        )
        .execute(),
      this.db
        .selectFrom('databases')
        .leftJoin('pages', 'pages.id', 'databases.pageId')
        .select([
          'databases.id as databaseId',
          'databases.pageId',
          'databases.name as title',
          'databases.deletedAt',
          'pages.slugId',
          'pages.parentPageId',
        ])
        .where('databases.workspaceId', '=', scope.workspace.id)
        .where('databases.spaceId', '=', scope.space.id)
        .where('databases.deletedAt', 'is not', null)
        .where('databases.deletedAt', '>=', deletedSince)
        .execute(),
      this.db
        .selectFrom('databaseRows')
        .innerJoin('databases', 'databases.id', 'databaseRows.databaseId')
        .leftJoin('pages', 'pages.id', 'databaseRows.pageId')
        .select([
          'databaseRows.id as rowId',
          'databaseRows.databaseId',
          'databaseRows.pageId',
          'databaseRows.archivedAt',
          'pages.slugId',
          'pages.title',
          'pages.parentPageId',
        ])
        .where('databaseRows.workspaceId', '=', scope.workspace.id)
        .where('databases.workspaceId', '=', scope.workspace.id)
        .where('databases.spaceId', '=', scope.space.id)
        .where('databaseRows.archivedAt', 'is not', null)
        .where('databaseRows.archivedAt', '>=', deletedSince)
        .execute(),
    ]);

    const items = [
      ...deletedPages.map((page) => ({
        type: 'page',
        id: page.id,
        slugId: page.slugId,
        title: page.title,
        parentPageId: page.parentPageId,
        deletedAt: page.deletedAt,
        deletedAtMs: new Date(page.deletedAt).getTime(),
      })),
      ...deletedDatabases.map((database) => ({
        type: 'database',
        id: database.pageId ?? database.databaseId,
        databaseId: database.databaseId,
        slugId: database.slugId,
        title: database.title,
        parentPageId: database.parentPageId,
        deletedAt: database.deletedAt,
        deletedAtMs: new Date(database.deletedAt).getTime(),
      })),
      ...deletedRows.map((row) => ({
        type: 'databaseRow',
        id: row.pageId,
        rowId: row.rowId,
        databaseId: row.databaseId,
        slugId: row.slugId,
        title: row.title,
        parentPageId: row.parentPageId,
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

    const maxDeletedAtMs =
      items.length > 0
        ? Math.max(...items.map((item) => item.deletedAtMs))
        : deletedSinceMs;

    return {
      items,
      maxDeletedAtMs,
    };
  }

  async getDatabaseInfo(scope: RagAuthContext, databaseIdOrPageSlug: string) {
    const database = await this.resolveDatabaseInScope(databaseIdOrPageSlug, scope);
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
      this.toMarkdown(database.descriptionContent) ?? database.description ?? '';
    const rowsMarkdown = rows
      .map((row) => {
        const title = row.page?.title || row.pageTitle || row.pageId;
        const body = row.rowMarkdown?.trim();
        return body ? `## ${title}\n\n${body}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    const knowledgeMarkdownParts = [
      descriptionMarkdown?.trim() ? `## Description\n\n${descriptionMarkdown}` : '',
      tableMarkdown?.trim() ? `## Table\n\n${tableMarkdown}` : '',
      rowsMarkdown?.trim() ? `## Rows\n\n${rowsMarkdown}` : '',
    ].filter(Boolean);

    const documentFields = this.getDocumentFieldsConfig(scope.space);

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
      customFields: this.buildCustomFields(databasePage.settings, documentFields),
      descriptionMarkdown,
      pageContentMarkdown: this.toMarkdown(databasePage.content),
      properties: normalizedProperties,
      rows,
      knowledgeMarkdown: knowledgeMarkdownParts.join('\n\n'),
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
    };
  }

  async getDatabaseRows(
    scope: RagAuthContext,
    databaseIdOrPageSlug: string,
    pageIds?: string[],
  ) {
    const database = await this.resolveDatabaseInScope(databaseIdOrPageSlug, scope);

    const rows = await this.loadRowsWithContent(database.id, scope, {
      pageIds: pageIds ?? [],
    });

    return {
      databaseId: database.id,
      items: rows,
    };
  }

  async getPageAttachments(scope: RagAuthContext, pageIdOrSlug: string) {
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
      })),
    };
  }

  async getComments(scope: RagAuthContext, pageIdOrSlug: string) {
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
    );
  }

  async resolveAttachmentForDownload(scope: RagAuthContext, fileId: string) {
    const attachment = await this.attachmentRepo.findById(fileId);

    if (!attachment) {
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

    return attachment;
  }
}
