import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { jsonToMarkdown } from '../../../collaboration/collaboration.util';
import { SearchService } from '../../search/search.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiContextSource,
  AiContextSourceType,
  AiConversationContext,
} from '@docmost/api-contract';
import {
  AiConversation,
  AiRun,
  AiRunContextSource,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import {
  AiContextSourceSearchQueryDto,
  AiContextSourceInputDto,
  SendAiMessageDto,
  UpdateAiConversationContextDto,
} from '../dto/ai.dto';
import { AiConversationService } from './ai-conversation.service';

export interface AiResolvedRunContextSource {
  sourceType: AiContextSourceType;
  sourceId: string;
  pageId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  excerpt: string;
  markdown: string;
  position: number;
  contextSourceId: string;
  dependencyPageIds: string[];
  origin: 'current_document' | 'explicit';
}

@Injectable()
export class AiContextService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly conversations: AiConversationService,
    private readonly pageAccessService: PageAccessService,
    private readonly searchService: SearchService,
  ) {}

  async get(
    conversationId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiConversationContext> {
    const conversation = await this.conversations.getOwnedEntity(
      conversationId,
      user,
      workspace,
    );
    return this.toContext(conversation, user);
  }

  async update(
    conversationId: string,
    dto: UpdateAiConversationContextDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiConversationContext> {
    const conversation = await this.conversations.getOwnedEntity(
      conversationId,
      user,
      workspace,
    );
    const normalizedSources = this.normalizeSourceInputs(dto.sources);
    const resolved = await this.resolveDescriptors(
      normalizedSources,
      conversation.spaceId,
      workspace.id,
      user,
      true,
    );
    await this.assertFiles(dto.fileIds, conversation.id, user.id, workspace.id);
    await this.assertAttachments(
      dto.attachmentIds,
      conversation.spaceId,
      workspace.id,
      user,
    );
    const fingerprint = this.fingerprint({
      includeCurrentDocument: dto.includeCurrentDocument,
      sources: normalizedSources,
      fileIds: [...dto.fileIds].sort(),
      attachmentIds: [...dto.attachmentIds].sort(),
    });

    const updated = await this.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('aiConversations')
        .selectAll()
        .where('id', '=', conversation.id)
        .where('deletedAt', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) {
        throw new BadRequestException({
          code: 'context_source_unavailable',
          message: 'AI conversation is unavailable',
        });
      }
      if (locked.contextFingerprint === fingerprint) {
        return locked;
      }
      if (locked.contextRevision !== dto.expectedRevision) {
        throw new ConflictException({
          code: 'ai_context_revision_conflict',
          message: 'AI conversation context was updated elsewhere',
        });
      }

      await trx
        .deleteFrom('aiConversationContextSources')
        .where('conversationId', '=', locked.id)
        .execute();
      if (resolved.length > 0) {
        await trx
          .insertInto('aiConversationContextSources')
          .values(
            resolved.map((source, position) => ({
              conversationId: locked.id,
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              pageId: source.pageId,
              position,
            })),
          )
          .execute();
      }
      return trx
        .updateTable('aiConversations')
        .set({
          includeCurrentDocument: dto.includeCurrentDocument,
          contextChatFileIds: [...dto.fileIds],
          contextAttachmentIds: [...dto.attachmentIds],
          contextFingerprint: fingerprint,
          contextRevision: locked.contextRevision + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', locked.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return this.toContext(updated, user);
  }

  async search(
    conversationId: string,
    query: AiContextSourceSearchQueryDto,
    user: User,
    workspace: Workspace,
  ) {
    const conversation = await this.conversations.getOwnedEntity(
      conversationId,
      user,
      workspace,
    );
    if (!query.query?.trim()) {
      return { items: [], hasMore: false, nextCursor: null };
    }
    const result = await this.searchService.searchPage(
      {
        query: query.query.trim(),
        spaceId: conversation.spaceId,
        limit: Math.min(51, query.limit + 1),
        offset: query.cursor,
      },
      { userId: user.id, workspaceId: workspace.id },
    );
    const rows = result.items.slice(0, query.limit);
    const rowPages = rows.length
      ? await this.db
          .selectFrom('databaseRows')
          .select(['id', 'pageId'])
          .where(
            'pageId',
            'in',
            rows.map((row) => row.id),
          )
          .where('archivedAt', 'is', null)
          .execute()
      : [];
    const rowByPageId = new Map(rowPages.map((row) => [row.pageId, row.id]));
    const items: AiContextSource[] = rows.map((row, position) => {
      const databaseRowId = rowByPageId.get(row.id);
      const sourceType: AiContextSourceType = row.databaseId
        ? 'database'
        : databaseRowId
          ? 'database_row'
          : 'page';
      return {
        id: `${sourceType}:${row.databaseId ?? databaseRowId ?? row.id}`,
        sourceType,
        sourceId: row.databaseId ?? databaseRowId ?? row.id,
        pageId: row.id,
        title: row.title?.trim() || '',
        breadcrumbs: (row.breadcrumbs ?? []).map(
          (breadcrumb) => breadcrumb.title,
        ),
        url: null,
        position,
        available: true,
      };
    });
    const hasMore = result.items.length > query.limit;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? String(query.cursor + query.limit) : null,
    };
  }

  async captureRunContext(
    trx: any,
    runId: string,
    conversation: AiConversation,
    dto: SendAiMessageDto,
  ): Promise<void> {
    if (conversation.contextRevision !== dto.contextRevision) {
      throw new ConflictException({
        code: 'ai_context_revision_conflict',
        message: 'AI conversation context was updated elsewhere',
      });
    }
    const explicit = await trx
      .selectFrom('aiConversationContextSources')
      .selectAll()
      .where('conversationId', '=', conversation.id)
      .orderBy('position', 'asc')
      .execute();
    const pageIds = [
      ...(conversation.includeCurrentDocument ? [conversation.pageId] : []),
      ...explicit.map((source: any) => source.pageId),
    ];
    const pages = pageIds.length
      ? await trx
          .selectFrom('pages')
          .select(['id', 'title', 'slugId'])
          .where('id', 'in', pageIds)
          .execute()
      : [];
    const pageById = new Map<
      string,
      { id: string; title: string | null; slugId: string }
    >(pages.map((page: any) => [page.id, page]));
    const snapshots: Array<{
      runId: string;
      origin: 'current_document' | 'explicit';
      sourceType: string;
      sourceId: string;
      pageId: string;
      sourceTitle: string;
      sourceUrl: null;
      markdownSnapshot: string;
      contentSha256: string;
      position: number;
    }> = [];

    if (
      conversation.includeCurrentDocument &&
      dto.documentSnapshot !== undefined
    ) {
      const markdown = dto.documentSnapshot;
      snapshots.push({
        runId,
        origin: 'current_document',
        sourceType: 'page',
        sourceId: conversation.pageId,
        pageId: conversation.pageId,
        sourceTitle: String(
          pageById.get(conversation.pageId)?.title ?? '',
        ).trim(),
        sourceUrl: null,
        markdownSnapshot: markdown,
        contentSha256: this.fingerprint(markdown),
        position: 0,
      });
    }
    const explicitStartPosition = snapshots.length;
    explicit.forEach((source: any, index: number) => {
      snapshots.push({
        runId,
        origin: 'explicit',
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        pageId: source.pageId,
        sourceTitle: String(pageById.get(source.pageId)?.title ?? '').trim(),
        sourceUrl: null,
        markdownSnapshot: '',
        contentSha256: '',
        position: explicitStartPosition + index,
      });
    });
    if (snapshots.length > 0) {
      await trx.insertInto('aiRunContextSources').values(snapshots).execute();
    }
  }

  async copyRunContext(
    trx: any,
    sourceRunId: string,
    targetRunId: string,
    assistantMessageId: string,
  ): Promise<void> {
    const sources = await trx
      .selectFrom('aiRunContextSources')
      .selectAll()
      .where('runId', '=', sourceRunId)
      .orderBy('position', 'asc')
      .execute();
    const sourceIdMap = new Map<string, string>();
    for (const source of sources) {
      const inserted = await trx
        .insertInto('aiRunContextSources')
        .values({
          runId: targetRunId,
          origin: source.origin,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          pageId: source.pageId,
          sourceTitle: source.sourceTitle,
          sourceUrl: source.sourceUrl,
          markdownSnapshot: source.markdownSnapshot,
          contentSha256: source.contentSha256,
          position: source.position,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      sourceIdMap.set(source.id, inserted.id);
    }
    const dependencies = await trx
      .selectFrom('aiRunSourceDependencies')
      .selectAll()
      .where('runId', '=', sourceRunId)
      .execute();
    if (dependencies.length > 0) {
      await trx
        .insertInto('aiRunSourceDependencies')
        .values(
          dependencies.map((dependency) => ({
            runId: targetRunId,
            messageId: assistantMessageId,
            contextSourceId: dependency.contextSourceId
              ? (sourceIdMap.get(dependency.contextSourceId) ?? null)
              : null,
            pageId: dependency.pageId,
          })),
        )
        .execute();
    }
  }

  async resolveRunContext(
    run: AiRun,
    user: User,
    maxChars: number,
  ): Promise<AiResolvedRunContextSource[]> {
    const rows = await this.db
      .selectFrom('aiRunContextSources')
      .selectAll()
      .where('runId', '=', run.id)
      .orderBy('position', 'asc')
      .execute();
    const readable = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      run.spaceId,
    );
    const resolved: AiResolvedRunContextSource[] = [];
    let remaining = maxChars;
    for (const row of rows) {
      if (!readable.readablePageIds.has(row.pageId)) {
        throw this.contextUnavailable();
      }
      let markdown = row.markdownSnapshot;
      let title = row.sourceTitle;
      let dependencies = [row.pageId];
      if (row.origin === 'explicit' && row.contentSha256 === '') {
        const snapshot = await this.resolveSnapshot(
          row,
          user,
          run.workspaceId,
          run.spaceId,
          readable.readablePageIds,
          Math.max(0, remaining),
        );
        markdown = snapshot.markdown;
        title = snapshot.title;
        dependencies = snapshot.dependencyPageIds;
      }
      const bounded = markdown.slice(0, Math.max(0, remaining));
      remaining -= bounded.length;
      const stored = await this.persistResolvedSnapshot(
        run,
        row,
        title,
        bounded,
        dependencies,
      );
      resolved.push({
        sourceType: row.sourceType as AiContextSourceType,
        sourceId: row.sourceId,
        pageId: row.pageId,
        sourceTitle: title,
        sourceUrl: row.sourceUrl,
        excerpt: bounded.slice(0, 1000),
        markdown: bounded,
        position: row.position,
        contextSourceId: stored.id,
        dependencyPageIds: dependencies,
        origin: row.origin as 'current_document' | 'explicit',
      });
    }
    return resolved;
  }

  private async persistResolvedSnapshot(
    run: AiRun,
    row: AiRunContextSource,
    title: string,
    markdown: string,
    dependencyPageIds: string[],
  ): Promise<AiRunContextSource> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('aiRunContextSources')
        .set({
          sourceTitle: title,
          markdownSnapshot: markdown,
          contentSha256: this.fingerprint(markdown),
        })
        .where('id', '=', row.id)
        .where('runId', '=', run.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (dependencyPageIds.length > 0) {
        await trx
          .insertInto('aiRunSourceDependencies')
          .values(
            [...new Set(dependencyPageIds)].map((pageId) => ({
              runId: run.id,
              messageId: run.assistantMessageId,
              contextSourceId: row.id,
              pageId,
            })),
          )
          .onConflict((oc) => oc.columns(['runId', 'pageId']).doNothing())
          .execute();
      }
      return updated;
    });
  }

  private async resolveSnapshot(
    row: AiRunContextSource,
    user: User,
    workspaceId: string,
    spaceId: string,
    readablePageIds: Set<string>,
    maxChars: number,
  ): Promise<{
    title: string;
    markdown: string;
    dependencyPageIds: string[];
  }> {
    if (row.sourceType === 'page') {
      const page = await this.db
        .selectFrom('pages')
        .selectAll()
        .where('id', '=', row.sourceId)
        .where('workspaceId', '=', workspaceId)
        .where('spaceId', '=', spaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      if (!page || !readablePageIds.has(page.id)) {
        throw this.contextUnavailable();
      }
      return {
        title: page.title?.trim() || '',
        markdown: this.pageMarkdown(
          page.title,
          page.content,
          page.textContent,
        ).slice(0, maxChars),
        dependencyPageIds: [page.id],
      };
    }
    if (row.sourceType === 'database_row') {
      return this.resolveDatabaseRow(
        row.sourceId,
        workspaceId,
        spaceId,
        readablePageIds,
        maxChars,
      );
    }
    if (row.sourceType === 'database') {
      return this.resolveDatabase(
        row.sourceId,
        workspaceId,
        spaceId,
        readablePageIds,
        maxChars,
      );
    }
    throw this.contextUnavailable();
  }

  private async resolveDatabaseRow(
    rowId: string,
    workspaceId: string,
    spaceId: string,
    readablePageIds: Set<string>,
    maxChars: number,
  ) {
    const row = await this.db
      .selectFrom('databaseRows as r')
      .innerJoin('databases as d', 'd.id', 'r.databaseId')
      .innerJoin('pages as p', 'p.id', 'r.pageId')
      .select([
        'r.id',
        'r.pageId',
        'r.databaseId',
        'd.name as databaseName',
        'd.pageId as databasePageId',
        'p.title',
        'p.content',
        'p.textContent',
      ])
      .where('r.id', '=', rowId)
      .where('r.workspaceId', '=', workspaceId)
      .where('r.archivedAt', 'is', null)
      .where('d.spaceId', '=', spaceId)
      .where('d.deletedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      .executeTakeFirst();
    if (
      !row ||
      !readablePageIds.has(row.pageId) ||
      (row.databasePageId && !readablePageIds.has(row.databasePageId))
    ) {
      throw this.contextUnavailable();
    }
    const cells = await this.databaseRowCells(row.databaseId, [row.pageId]);
    const markdown = [
      `# ${row.title?.trim() || row.databaseName}`,
      `Database: ${row.databaseName}`,
      this.cellsMarkdown(cells.get(row.pageId) ?? []),
      this.safeMarkdown(row.content, row.textContent),
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, maxChars);
    return {
      title: row.title?.trim() || row.databaseName,
      markdown,
      dependencyPageIds: [
        row.pageId,
        ...(row.databasePageId ? [row.databasePageId] : []),
      ],
    };
  }

  private async resolveDatabase(
    databaseId: string,
    workspaceId: string,
    spaceId: string,
    readablePageIds: Set<string>,
    maxChars: number,
  ) {
    const database = await this.db
      .selectFrom('databases')
      .selectAll()
      .where('id', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (
      !database ||
      !database.pageId ||
      !readablePageIds.has(database.pageId)
    ) {
      throw this.contextUnavailable();
    }
    const rows = await this.db
      .selectFrom('databaseRows as r')
      .innerJoin('pages as p', 'p.id', 'r.pageId')
      .select(['r.pageId', 'p.title', 'p.content', 'p.textContent'])
      .where('r.databaseId', '=', database.id)
      .where('r.workspaceId', '=', workspaceId)
      .where('r.archivedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      .orderBy('p.updatedAt', 'desc')
      .limit(200)
      .execute();
    const readableRows = rows.filter((row) => readablePageIds.has(row.pageId));
    const cells = await this.databaseRowCells(
      database.id,
      readableRows.map((row) => row.pageId),
    );
    let markdown = `# ${database.name}\n\n`;
    const description = this.safeMarkdown(
      database.descriptionContent,
      database.description,
    );
    if (description) markdown += `${description}\n\n`;
    const usedPageIds: string[] = [database.pageId];
    for (const row of readableRows) {
      const section = [
        `## ${row.title?.trim() || 'Untitled'}`,
        this.cellsMarkdown(cells.get(row.pageId) ?? []),
        this.safeMarkdown(row.content, row.textContent),
      ]
        .filter(Boolean)
        .join('\n\n');
      if (markdown.length + section.length > maxChars) break;
      markdown += `${section}\n\n`;
      usedPageIds.push(row.pageId);
    }
    return {
      title: database.name,
      markdown: markdown.slice(0, maxChars),
      dependencyPageIds: usedPageIds,
    };
  }

  private async databaseRowCells(databaseId: string, pageIds: string[]) {
    const result = new Map<
      string,
      Array<{ propertyName: string; value: unknown }>
    >();
    if (pageIds.length === 0) return result;
    const rows = await this.db
      .selectFrom('databaseCells as c')
      .innerJoin('databaseProperties as p', 'p.id', 'c.propertyId')
      .select(['c.pageId', 'c.value', 'p.name as propertyName', 'p.position'])
      .where('c.databaseId', '=', databaseId)
      .where('c.pageId', 'in', pageIds)
      .where('c.deletedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      .orderBy('p.position', 'asc')
      .execute();
    for (const row of rows) {
      const current = result.get(row.pageId) ?? [];
      current.push({ propertyName: row.propertyName, value: row.value });
      result.set(row.pageId, current);
    }
    return result;
  }

  private cellsMarkdown(
    cells: Array<{ propertyName: string; value: unknown }>,
  ): string {
    return cells
      .map(
        (cell) => `- ${cell.propertyName}: ${this.renderCellValue(cell.value)}`,
      )
      .join('\n');
  }

  private renderCellValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) {
      return value.map((entry) => this.renderCellValue(entry)).join(', ');
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of ['label', 'name', 'title', 'value']) {
        if (record[key] !== undefined) {
          return this.renderCellValue(record[key]);
        }
      }
      return JSON.stringify(record);
    }
    return String(value);
  }

  private pageMarkdown(
    title: string | null,
    content: unknown,
    textContent: string | null,
  ): string {
    return [
      title?.trim() ? `# ${title.trim()}` : '',
      this.safeMarkdown(content, textContent),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private safeMarkdown(content: unknown, fallback: string | null): string {
    if (content && typeof content === 'object') {
      try {
        return jsonToMarkdown(content as any);
      } catch {
        return fallback ?? '';
      }
    }
    return fallback ?? '';
  }

  private async toContext(
    conversation: AiConversation,
    user: User,
  ): Promise<AiConversationContext> {
    const rows = await this.db
      .selectFrom('aiConversationContextSources')
      .selectAll()
      .where('conversationId', '=', conversation.id)
      .orderBy('position', 'asc')
      .execute();
    const sources = await this.resolveDescriptors(
      rows.map((row) => ({
        sourceType: row.sourceType as AiContextSourceType,
        sourceId: row.sourceId,
      })),
      conversation.spaceId,
      conversation.workspaceId,
      user,
      false,
    );
    return {
      conversationId: conversation.id,
      revision: conversation.contextRevision,
      fingerprint: conversation.contextFingerprint,
      includeCurrentDocument: conversation.includeCurrentDocument,
      sources,
      fileIds: conversation.contextChatFileIds,
      attachmentIds: conversation.contextAttachmentIds,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private normalizeSourceInputs(
    sources: AiContextSourceInputDto[],
  ): AiContextSourceInputDto[] {
    const seen = new Set<string>();
    const normalized: AiContextSourceInputDto[] = [];
    for (const source of sources) {
      const identity = `${source.sourceType}:${source.sourceId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      normalized.push(source);
    }
    if (normalized.length > 10) {
      throw new BadRequestException({
        code: 'ai_context_source_limit',
        message: 'Too many AI context sources',
      });
    }
    return normalized;
  }

  private async resolveDescriptors(
    inputs: AiContextSourceInputDto[],
    spaceId: string,
    workspaceId: string,
    user: User | null,
    requireAvailable: boolean,
  ): Promise<AiContextSource[]> {
    if (inputs.length === 0) return [];
    const readable = user
      ? (await this.pageAccessService.getSidebarAccessSnapshot(user, spaceId))
          .readablePageIds
      : null;
    const descriptors: AiContextSource[] = [];
    for (const [position, input] of inputs.entries()) {
      const descriptor = await this.resolveDescriptor(
        input,
        spaceId,
        workspaceId,
      );
      const available =
        Boolean(descriptor) && (!readable || readable.has(descriptor!.pageId));
      if (!descriptor || !available) {
        if (requireAvailable) throw this.contextUnavailable();
        descriptors.push({
          id: `${input.sourceType}:${input.sourceId}`,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          pageId: descriptor?.pageId ?? input.sourceId,
          title: descriptor?.title ?? '',
          breadcrumbs: [],
          url: null,
          position,
          available: false,
        });
        continue;
      }
      descriptors.push({
        ...descriptor,
        position,
        available: true,
      });
    }
    return descriptors;
  }

  private async resolveDescriptor(
    input: AiContextSourceInputDto,
    spaceId: string,
    workspaceId: string,
  ): Promise<Omit<AiContextSource, 'position' | 'available'> | null> {
    if (input.sourceType === 'page') {
      const page = await this.db
        .selectFrom('pages')
        .select(['id', 'title'])
        .where('id', '=', input.sourceId)
        .where('spaceId', '=', spaceId)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      return page
        ? {
            id: `page:${page.id}`,
            sourceType: 'page',
            sourceId: page.id,
            pageId: page.id,
            title: page.title?.trim() || '',
            breadcrumbs: [],
            url: null,
          }
        : null;
    }
    if (input.sourceType === 'database') {
      const database = await this.db
        .selectFrom('databases')
        .select(['id', 'name', 'pageId'])
        .where('id', '=', input.sourceId)
        .where('spaceId', '=', spaceId)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      return database?.pageId
        ? {
            id: `database:${database.id}`,
            sourceType: 'database',
            sourceId: database.id,
            pageId: database.pageId,
            title: database.name.trim(),
            breadcrumbs: [],
            url: null,
          }
        : null;
    }
    const row = await this.db
      .selectFrom('databaseRows as r')
      .innerJoin('databases as d', 'd.id', 'r.databaseId')
      .innerJoin('pages as p', 'p.id', 'r.pageId')
      .select(['r.id', 'r.pageId', 'p.title'])
      .where((eb) =>
        eb.or([
          eb('r.id', '=', input.sourceId),
          eb('r.pageId', '=', input.sourceId),
        ]),
      )
      .where('r.workspaceId', '=', workspaceId)
      .where('r.archivedAt', 'is', null)
      .where('d.spaceId', '=', spaceId)
      .where('d.deletedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      .executeTakeFirst();
    return row
      ? {
          id: `database_row:${row.id}`,
          sourceType: 'database_row',
          sourceId: row.id,
          pageId: row.pageId,
          title: row.title?.trim() || '',
          breadcrumbs: [],
          url: null,
        }
      : null;
  }

  private async assertFiles(
    ids: string[],
    conversationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const count = await this.db
      .selectFrom('aiChatFiles')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('id', 'in', ids)
      .where('conversationId', '=', conversationId)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('status', '=', 'ready')
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    if (Number(count.count) !== ids.length) throw this.contextUnavailable();
  }

  private async assertAttachments(
    ids: string[],
    spaceId: string,
    workspaceId: string,
    user: User,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.db
      .selectFrom('attachments')
      .select(['id', 'pageId'])
      .where('id', 'in', ids)
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
    const readable = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      spaceId,
    );
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) => !row.pageId || !readable.readablePageIds.has(row.pageId),
      )
    ) {
      throw this.contextUnavailable();
    }
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private contextUnavailable(): BadRequestException {
    return new BadRequestException({
      code: 'context_source_unavailable',
      message: 'An AI context source is unavailable',
    });
  }
}
