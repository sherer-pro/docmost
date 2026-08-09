import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { jsonToMarkdown } from '../../../collaboration/collaboration.util';
import { SearchService } from '../../search/search.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AI_CONTEXT_LIMITS,
  AiDocumentHeading,
  AiDescendantSelection,
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
  AiContextDescendantsQueryDto,
  AiContextSourceInputDto,
  AiDescendantSelectionDto,
  SendAiMessageDto,
  UpdateAiConversationContextDto,
} from '../dto/ai.dto';
import { AiConversationService } from './ai-conversation.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { hashCanonicalJson } from '../../../common/helpers/canonical-json.util';

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
  citationHeadings: AiDocumentHeading[];
}

interface AiContextRoot {
  source: AiContextSource;
  descendants: AiDescendantSelection;
  origin: 'current_document' | 'explicit';
}

@Injectable()
export class AiContextService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly conversations: AiConversationService,
    private readonly pageAccessService: PageAccessService,
    private readonly searchService: SearchService,
    private readonly pageRepo: PageRepo,
    private readonly contentPolicy: AiContentPolicyService,
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
    const resolvedSources = await this.resolveDescriptors(
      normalizedSources,
      conversation.spaceId,
      workspace.id,
      user,
      true,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      conversation.spaceId,
      workspace.id,
    );
    if (resolvedSources.some((source) => excluded.has(source.pageId))) {
      throw new BadRequestException({
        code: 'ai_context_source_excluded',
        message: 'An AI context source is excluded by space policy',
      });
    }
    let currentDocumentDescendants = this.normalizeSelection(
      dto.currentDocumentDescendants,
    );
    const includeCurrentDocument =
      dto.includeCurrentDocument && !excluded.has(conversation.pageId);
    const roots: AiContextRoot[] = [];
    const seenPageIds = new Set<string>();
    if (includeCurrentDocument) {
      const duplicateIndex = resolvedSources.findIndex(
        (source) => source.pageId === conversation.pageId,
      );
      if (duplicateIndex >= 0 && currentDocumentDescendants.mode === 'none') {
        currentDocumentDescendants = this.normalizeSelection(
          normalizedSources[duplicateIndex]?.descendants,
        );
      }
      const current = await this.resolveDescriptor(
        { sourceType: 'page', sourceId: conversation.pageId },
        conversation.spaceId,
        workspace.id,
      );
      if (!current) throw this.contextUnavailable();
      roots.push({
        source: {
          ...current,
          position: 0,
          available: true,
          hasChildren: await this.hasChildren(conversation.pageId),
          descendants: currentDocumentDescendants,
        },
        descendants: currentDocumentDescendants,
        origin: 'current_document',
      });
      seenPageIds.add(conversation.pageId);
    }
    for (const [index, source] of resolvedSources.entries()) {
      if (seenPageIds.has(source.pageId)) continue;
      seenPageIds.add(source.pageId);
      const descendants =
        source.sourceType === 'page'
          ? this.normalizeSelection(normalizedSources[index]?.descendants)
          : this.emptySelection();
      roots.push({ source, descendants, origin: 'explicit' });
    }
    const expanded = await this.expandRoots(
      roots,
      conversation.spaceId,
      workspace.id,
      user,
      excluded,
      true,
    );
    if (expanded.length > AI_CONTEXT_LIMITS.resolvedSources) {
      throw this.resolvedSourceLimit(expanded.length, roots);
    }
    await this.assertFiles(dto.fileIds, conversation.id, user.id, workspace.id);
    await this.assertAttachments(
      dto.attachmentIds,
      conversation.spaceId,
      workspace.id,
      user,
    );
    const explicitRoots = roots.filter((root) => root.origin === 'explicit');
    const fingerprint = this.fingerprint({
      includeCurrentDocument,
      currentDocumentDescendants,
      sources: explicitRoots.map((root) => ({
        sourceType: root.source.sourceType,
        sourceId: root.source.sourceId,
        descendants: root.descendants,
      })),
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
      if (explicitRoots.length > 0) {
        await trx
          .insertInto('aiConversationContextSources')
          .values(
            explicitRoots.map((root, position) => ({
              conversationId: locked.id,
              sourceType: root.source.sourceType,
              sourceId: root.source.sourceId,
              pageId: root.source.pageId,
              position,
              descendantMode: root.descendants.mode,
              selectedDescendantPageIds: root.descendants.pageIds,
            })),
          )
          .execute();
      }
      return trx
        .updateTable('aiConversations')
        .set({
          includeCurrentDocument,
          currentDocumentDescendantMode: currentDocumentDescendants.mode,
          currentDocumentSelectedPageIds: currentDocumentDescendants.pageIds,
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
    const fetchLimit = Math.min(51, Math.max(query.limit + 1, query.limit * 2));
    const result = await this.searchService.searchPage(
      {
        query: query.query.trim(),
        spaceId: conversation.spaceId,
        limit: fetchLimit,
        offset: query.cursor,
      },
      { userId: user.id, workspaceId: workspace.id },
    );
    const rows = result.items;
    const excluded = await this.contentPolicy.getExcludedPageIds(
      conversation.spaceId,
      workspace.id,
    );
    const selectedRows = await this.db
      .selectFrom('aiConversationContextSources')
      .select([
        'sourceType',
        'sourceId',
        'pageId',
        'descendantMode',
        'selectedDescendantPageIds',
      ])
      .where('conversationId', '=', conversation.id)
      .execute();
    const selectedDescriptors = await this.resolveDescriptors(
      selectedRows.map((row) => ({
        sourceType: row.sourceType as AiContextSourceType,
        sourceId: row.sourceId,
        descendants: {
          mode: row.descendantMode as AiDescendantSelection['mode'],
          pageIds: row.selectedDescendantPageIds,
        },
      })),
      conversation.spaceId,
      workspace.id,
      user,
      false,
    );
    const selectedRoots: AiContextRoot[] = selectedDescriptors.map(
      (source) => ({
        source,
        descendants: source.descendants,
        origin: 'explicit',
      }),
    );
    if (
      conversation.includeCurrentDocument &&
      !excluded.has(conversation.pageId)
    ) {
      const [currentDescriptor] = await this.resolveDescriptors(
        [
          {
            sourceType: 'page',
            sourceId: conversation.pageId,
            descendants: {
              mode: conversation.currentDocumentDescendantMode as AiDescendantSelection['mode'],
              pageIds: conversation.currentDocumentSelectedPageIds,
            },
          },
        ],
        conversation.spaceId,
        workspace.id,
        user,
        false,
      );
      if (currentDescriptor?.available) {
        selectedRoots.unshift({
          source: currentDescriptor,
          descendants: currentDescriptor.descendants,
          origin: 'current_document',
        });
      }
    }
    const selectedPageIds = new Set(
      (
        await this.expandRoots(
          selectedRoots,
          conversation.spaceId,
          workspace.id,
          user,
          excluded,
          false,
        )
      ).map((item) => item.source.pageId),
    );
    const childRows = rows.length
      ? await this.db
          .selectFrom('pages')
          .select('parentPageId')
          .where(
            'parentPageId',
            'in',
            rows.map((row) => row.id),
          )
          .where('deletedAt', 'is', null)
          .execute()
      : [];
    const parentsWithChildren = new Set(
      childRows
        .map((row) => row.parentPageId)
        .filter((id): id is string => Boolean(id)),
    );
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
    const mappedItems: AiContextSource[] = rows.map((row, position) => {
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
        icon: row.icon ?? null,
        breadcrumbs: (row.breadcrumbs ?? []).map(
          (breadcrumb) => breadcrumb.title,
        ),
        url: null,
        position,
        available: !excluded.has(row.id) && !selectedPageIds.has(row.id),
        hasChildren: parentsWithChildren.has(row.id),
        descendants: this.emptySelection(),
      };
    });
    const seen = new Set<string>();
    const items: AiContextSource[] = [];
    let consumedRows = 0;
    for (const item of mappedItems) {
      consumedRows += 1;
      const identity = `${item.sourceType}:${item.sourceId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      items.push({ ...item, position: items.length });
      if (items.length === query.limit) break;
    }
    const hasMore =
      consumedRows < result.items.length || result.items.length === fetchLimit;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? String(query.cursor + consumedRows) : null,
    };
  }

  async descendants(
    conversationId: string,
    query: AiContextDescendantsQueryDto,
    user: User,
    workspace: Workspace,
  ) {
    const conversation = await this.conversations.getOwnedEntity(
      conversationId,
      user,
      workspace,
    );
    const root = await this.db
      .selectFrom('pages')
      .select(['id'])
      .where('id', '=', query.parentPageId)
      .where('spaceId', '=', conversation.spaceId)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!root) throw this.contextUnavailable();
    const readable = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      conversation.spaceId,
    );
    if (!readable.readablePageIds.has(root.id)) {
      throw this.contextUnavailable();
    }
    const excluded = await this.contentPolicy.getExcludedPageIds(
      conversation.spaceId,
      workspace.id,
    );
    const rows = await this.db
      .selectFrom('pages')
      .select(['id', 'position'])
      .where('parentPageId', '=', root.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .offset(query.cursor)
      .limit(query.limit + 1)
      .execute();
    const pageRows = rows.slice(0, query.limit);
    const visible = pageRows.filter(
      (row) => readable.readablePageIds.has(row.id) && !excluded.has(row.id),
    );
    const pageIds = visible.map((row) => row.id);
    const inputs = await this.inputsForPageIds(pageIds);
    const items = await this.resolveDescriptors(
      inputs,
      conversation.spaceId,
      workspace.id,
      user,
      true,
    );
    return {
      items,
      hasMore: rows.length > query.limit,
      nextCursor:
        rows.length > query.limit ? String(query.cursor + query.limit) : null,
    };
  }

  async captureRunContext(
    trx: any,
    runId: string,
    conversation: AiConversation,
    dto: SendAiMessageDto,
    user: User,
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
    const excluded = await this.contentPolicy.getExcludedPageIds(
      conversation.spaceId,
      conversation.workspaceId,
    );
    if (
      conversation.includeCurrentDocument &&
      excluded.has(conversation.pageId)
    ) {
      await trx
        .updateTable('aiRuns')
        .set({
          documentSnapshot: null,
          snapshotHash: null,
          selectionText: null,
          selectionFrom: null,
          selectionTo: null,
        })
        .where('id', '=', runId)
        .execute();
    }
    const inputs = explicit.map((source: any) => ({
      sourceType: source.sourceType as AiContextSourceType,
      sourceId: source.sourceId,
      descendants: {
        mode: source.descendantMode,
        pageIds: source.selectedDescendantPageIds,
      },
    }));
    const descriptors = await this.resolveDescriptors(
      inputs,
      conversation.spaceId,
      conversation.workspaceId,
      user,
      false,
    );
    const roots: AiContextRoot[] = [];
    if (
      conversation.includeCurrentDocument &&
      !excluded.has(conversation.pageId)
    ) {
      const current = await this.resolveDescriptor(
        { sourceType: 'page', sourceId: conversation.pageId },
        conversation.spaceId,
        conversation.workspaceId,
      );
      if (current) {
        const descendants: AiDescendantSelection = {
          mode: conversation.currentDocumentDescendantMode as
            | 'none'
            | 'all'
            | 'selected',
          pageIds: conversation.currentDocumentSelectedPageIds,
        };
        roots.push({
          source: {
            ...current,
            position: 0,
            available: true,
            hasChildren: await this.hasChildren(conversation.pageId),
            descendants,
          },
          descendants,
          origin: 'current_document',
        });
      }
    }
    descriptors.forEach((source, index) => {
      if (!source.available || excluded.has(source.pageId)) return;
      const descendants =
        source.sourceType === 'page'
          ? this.normalizeSelection(inputs[index].descendants)
          : this.emptySelection();
      roots.push({ source, descendants, origin: 'explicit' });
    });
    const expanded = await this.expandRoots(
      roots,
      conversation.spaceId,
      conversation.workspaceId,
      user,
      excluded,
      false,
    );
    if (expanded.length > AI_CONTEXT_LIMITS.resolvedSources) {
      throw this.resolvedSourceLimit(expanded.length, roots);
    }
    const snapshots: Array<{
      runId: string;
      origin: 'current_document' | 'explicit';
      sourceType: string;
      sourceId: string;
      pageId: string;
      sourceTitle: string;
      sourceUrl: string | null;
      markdownSnapshot: string;
      citationHeadings: AiDocumentHeading[];
      contentSha256: string;
      position: number;
    }> = [];

    for (const item of expanded) {
      if (
        item.origin === 'current_document' &&
        dto.documentSnapshot === undefined
      ) {
        continue;
      }
      const markdown =
        item.origin === 'current_document' ? dto.documentSnapshot! : '';
      snapshots.push({
        runId,
        origin: item.origin,
        sourceType: item.source.sourceType,
        sourceId: item.source.sourceId,
        pageId: item.source.pageId,
        sourceTitle: item.source.title,
        sourceUrl: item.source.url,
        markdownSnapshot: markdown,
        citationHeadings:
          item.origin === 'current_document'
            ? (dto.documentHeadings ?? [])
            : [],
        contentSha256:
          item.origin === 'current_document' ? this.fingerprint(markdown) : '',
        position: snapshots.length,
      });
    }
    if (snapshots.length > 0) {
      await trx.insertInto('aiRunContextSources').values(snapshots).execute();
    }
  }

  async copyRunContext(
    trx: any,
    sourceRunId: string,
    targetRunId: string,
    assistantMessageId: string,
    user: User,
  ): Promise<void> {
    const sourceRun = await trx
      .selectFrom('aiRuns')
      .select(['spaceId', 'workspaceId'])
      .where('id', '=', sourceRunId)
      .executeTakeFirstOrThrow();
    const excluded = await this.contentPolicy.getExcludedPageIds(
      sourceRun.spaceId,
      sourceRun.workspaceId,
    );
    const dependencies = await trx
      .selectFrom('aiRunSourceDependencies')
      .selectAll()
      .where('runId', '=', sourceRunId)
      .execute();
    const excludedContextSourceIds = new Set(
      dependencies
        .filter((dependency: any) => excluded.has(dependency.pageId))
        .map((dependency: any) => dependency.contextSourceId)
        .filter(Boolean),
    );
    const readable = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      sourceRun.spaceId,
    );
    const sources = (
      await trx
        .selectFrom('aiRunContextSources')
        .selectAll()
        .where('runId', '=', sourceRunId)
        .orderBy('position', 'asc')
        .execute()
    ).filter(
      (source: any) =>
        !excluded.has(source.pageId) &&
        readable.readablePageIds.has(source.pageId) &&
        !excludedContextSourceIds.has(source.id),
    );
    const sourceIdMap = new Map<string, string>();
    for (const [position, source] of sources.entries()) {
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
          citationHeadings: source.citationHeadings,
          contentSha256: source.contentSha256,
          position,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      sourceIdMap.set(source.id, inserted.id);
    }
    const allowedDependencies = dependencies.filter(
      (dependency: any) =>
        !excluded.has(dependency.pageId) &&
        readable.readablePageIds.has(dependency.pageId) &&
        (!dependency.contextSourceId ||
          sourceIdMap.has(dependency.contextSourceId)),
    );
    if (allowedDependencies.length > 0) {
      await trx
        .insertInto('aiRunSourceDependencies')
        .values(
          allowedDependencies.map((dependency: any) => ({
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
    const excluded = await this.contentPolicy.getExcludedPageIds(
      run.spaceId,
      run.workspaceId,
    );
    const allowedPageIds = new Set(
      [...readable.readablePageIds].filter((pageId) => !excluded.has(pageId)),
    );
    const resolved: AiResolvedRunContextSource[] = [];
    let remaining = maxChars;
    for (const row of rows) {
      if (!allowedPageIds.has(row.pageId)) continue;
      let markdown = row.markdownSnapshot;
      let title = row.sourceTitle;
      let dependencies = [row.pageId];
      let citationHeadings = this.normalizeCitationHeadings(
        row.citationHeadings,
      );
      if (row.origin === 'explicit' && row.contentSha256 === '') {
        const snapshot = await this.resolveSnapshot(
          row,
          user,
          run.workspaceId,
          run.spaceId,
          allowedPageIds,
          Math.max(0, remaining),
        );
        markdown = snapshot.markdown;
        title = snapshot.title;
        dependencies = snapshot.dependencyPageIds;
        citationHeadings = snapshot.citationHeadings;
      }
      const bounded = markdown.slice(0, Math.max(0, remaining));
      remaining -= bounded.length;
      const stored = await this.persistResolvedSnapshot(
        run,
        row,
        title,
        bounded,
        dependencies,
        citationHeadings,
      );
      const sourceUrl = row.sourceUrl ?? (await this.buildSourceUrl(row));
      resolved.push({
        sourceType: row.sourceType as AiContextSourceType,
        sourceId: row.sourceId,
        pageId: row.pageId,
        sourceTitle: title,
        sourceUrl,
        excerpt: bounded.slice(0, 1000),
        markdown: bounded,
        position: row.position,
        contextSourceId: stored.id,
        dependencyPageIds: dependencies,
        origin: row.origin as 'current_document' | 'explicit',
        citationHeadings,
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
    citationHeadings: AiDocumentHeading[],
  ): Promise<AiRunContextSource> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('aiRunContextSources')
        .set({
          sourceTitle: title,
          markdownSnapshot: markdown,
          contentSha256: this.fingerprint(markdown),
          citationHeadings,
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
    citationHeadings: AiDocumentHeading[];
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
        citationHeadings: this.extractCitationHeadings(page.content),
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
      citationHeadings: this.extractCitationHeadings(row.content),
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
      citationHeadings: [],
    };
  }

  private normalizeCitationHeadings(value: unknown): AiDocumentHeading[] {
    if (!Array.isArray(value)) return [];
    const headings = value
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        title: typeof item.title === 'string' ? item.title.slice(0, 500) : '',
        level: Math.min(6, Math.max(1, Number(item.level) || 1)),
        position: Math.max(0, Number(item.position) || 0),
      }))
      .filter(
        (item) =>
          item.id.length > 0 &&
          item.id.length <= 128 &&
          /^[A-Za-z0-9_-]+$/.test(item.id),
      );
    const counts = new Map<string, number>();
    headings.forEach((heading) =>
      counts.set(heading.id, (counts.get(heading.id) ?? 0) + 1),
    );
    return headings
      .filter((heading) => counts.get(heading.id) === 1)
      .slice(0, 500);
  }

  private extractCitationHeadings(content: unknown): AiDocumentHeading[] {
    if (!content || typeof content !== 'object') return [];
    const headings: AiDocumentHeading[] = [];
    let position = 0;
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const node = value as {
        type?: string;
        attrs?: Record<string, unknown>;
        content?: unknown[];
        text?: string;
      };
      const start = position;
      position += 1;
      if (node.type === 'heading') {
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
        if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
          headings.push({
            id,
            title: this.proseMirrorText(node).slice(0, 500),
            level: Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)),
            position: start,
          });
        }
      }
      node.content?.forEach(visit);
      position += 1;
    };
    visit(content);
    const counts = new Map<string, number>();
    headings.forEach((heading) =>
      counts.set(heading.id, (counts.get(heading.id) ?? 0) + 1),
    );
    return headings
      .filter((heading) => counts.get(heading.id) === 1)
      .slice(0, 500);
  }

  private proseMirrorText(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const node = value as { text?: string; content?: unknown[] };
    return [
      node.text ?? '',
      ...(node.content?.map((item) => this.proseMirrorText(item)) ?? []),
    ]
      .join('')
      .trim();
  }

  private async buildSourceUrl(
    row: AiRunContextSource,
  ): Promise<string | null> {
    const page = await this.db
      .selectFrom('pages as p')
      .innerJoin('spaces as s', 's.id', 'p.spaceId')
      .select(['p.slugId', 's.slug as spaceSlug'])
      .where('p.id', '=', row.pageId)
      .where('p.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!page) return null;
    const route = row.sourceType === 'database' ? 'db' : 'p';
    return `/s/${encodeURIComponent(page.spaceSlug)}/${route}/${encodeURIComponent(page.slugId)}`;
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
    const inputs = rows.map((row) => ({
      sourceType: row.sourceType as AiContextSourceType,
      sourceId: row.sourceId,
      descendants: {
        mode: row.descendantMode as 'none' | 'all' | 'selected',
        pageIds: row.selectedDescendantPageIds,
      },
    }));
    const sources = await this.resolveDescriptors(
      inputs,
      conversation.spaceId,
      conversation.workspaceId,
      user,
      false,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      conversation.spaceId,
      conversation.workspaceId,
    );
    const currentDocumentDescendants: AiDescendantSelection = {
      mode: conversation.currentDocumentDescendantMode as
        | 'none'
        | 'all'
        | 'selected',
      pageIds: conversation.currentDocumentSelectedPageIds,
    };
    const includeCurrentDocument =
      conversation.includeCurrentDocument && !excluded.has(conversation.pageId);
    const roots: AiContextRoot[] = [];
    if (includeCurrentDocument) {
      const current = await this.resolveDescriptor(
        { sourceType: 'page', sourceId: conversation.pageId },
        conversation.spaceId,
        conversation.workspaceId,
      );
      if (current) {
        roots.push({
          source: {
            ...current,
            position: 0,
            available: true,
            hasChildren: await this.hasChildren(conversation.pageId),
            descendants: currentDocumentDescendants,
          },
          descendants: currentDocumentDescendants,
          origin: 'current_document',
        });
      }
    }
    sources.forEach((source, index) => {
      const descendants =
        source.sourceType === 'page'
          ? this.normalizeSelection(inputs[index]?.descendants)
          : this.emptySelection();
      source.descendants = descendants;
      if (source.available && !excluded.has(source.pageId)) {
        roots.push({ source, descendants, origin: 'explicit' });
      } else {
        source.available = false;
      }
    });
    const expanded = await this.expandRoots(
      roots,
      conversation.spaceId,
      conversation.workspaceId,
      user,
      excluded,
      false,
    );
    return {
      conversationId: conversation.id,
      revision: conversation.contextRevision,
      fingerprint: conversation.contextFingerprint,
      includeCurrentDocument,
      currentDocumentDescendants,
      sources,
      resolvedSourceCount: expanded.length,
      limits: {
        manualRoots: AI_CONTEXT_LIMITS.manualRoots,
        resolvedSources: AI_CONTEXT_LIMITS.resolvedSources,
      },
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
          icon: descriptor?.icon ?? null,
          breadcrumbs: [],
          url: null,
          position,
          available: false,
          hasChildren: false,
          descendants: this.normalizeSelection(input.descendants),
        });
        continue;
      }
      descriptors.push({
        ...descriptor,
        position,
        available: true,
        hasChildren:
          descriptor.sourceType === 'page'
            ? await this.hasChildren(descriptor.pageId)
            : false,
        descendants:
          descriptor.sourceType === 'page'
            ? this.normalizeSelection(input.descendants)
            : this.emptySelection(),
      });
    }
    return descriptors;
  }

  private async resolveDescriptor(
    input: AiContextSourceInputDto,
    spaceId: string,
    workspaceId: string,
  ): Promise<Omit<
    AiContextSource,
    'position' | 'available' | 'hasChildren' | 'descendants'
  > | null> {
    if (input.sourceType === 'page') {
      const page = await this.db
        .selectFrom('pages')
        .select(['id', 'title', 'icon'])
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
            icon: page.icon ?? null,
            breadcrumbs: [],
            url: null,
          }
        : null;
    }
    if (input.sourceType === 'database') {
      const database = await this.db
        .selectFrom('databases')
        .select(['id', 'name', 'pageId', 'icon'])
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
            icon: database.icon ?? null,
            breadcrumbs: [],
            url: null,
          }
        : null;
    }
    const row = await this.db
      .selectFrom('databaseRows as r')
      .innerJoin('databases as d', 'd.id', 'r.databaseId')
      .innerJoin('pages as p', 'p.id', 'r.pageId')
      .select(['r.id', 'r.pageId', 'p.title', 'p.icon'])
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
          icon: row.icon ?? null,
          breadcrumbs: [],
          url: null,
        }
      : null;
  }

  private emptySelection(): AiDescendantSelection {
    return { mode: 'none', pageIds: [] };
  }

  private normalizeSelection(
    value?: AiDescendantSelectionDto | AiDescendantSelection,
  ): AiDescendantSelection {
    if (!value || !['none', 'all', 'selected'].includes(value.mode)) {
      return this.emptySelection();
    }
    if (value.mode !== 'selected') {
      return { mode: value.mode, pageIds: [] };
    }
    return {
      mode: 'selected',
      pageIds: [...new Set(value.pageIds ?? [])].sort(),
    };
  }

  private async hasChildren(pageId: string): Promise<boolean> {
    const child = await this.db
      .selectFrom('pages')
      .select('id')
      .where('parentPageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return Boolean(child);
  }

  private async inputsForPageIds(
    pageIds: string[],
  ): Promise<AiContextSourceInputDto[]> {
    if (pageIds.length === 0) return [];
    const [databases, rows] = await Promise.all([
      this.db
        .selectFrom('databases')
        .select(['id', 'pageId'])
        .where('pageId', 'in', pageIds)
        .where('deletedAt', 'is', null)
        .execute(),
      this.db
        .selectFrom('databaseRows')
        .select(['id', 'pageId'])
        .where('pageId', 'in', pageIds)
        .where('archivedAt', 'is', null)
        .execute(),
    ]);
    const databaseByPageId = new Map(
      databases
        .filter((database) => Boolean(database.pageId))
        .map((database) => [database.pageId!, database.id]),
    );
    const rowByPageId = new Map(rows.map((row) => [row.pageId, row.id]));
    return pageIds.map((pageId) => {
      const databaseId = databaseByPageId.get(pageId);
      if (databaseId) {
        return { sourceType: 'database', sourceId: databaseId };
      }
      const rowId = rowByPageId.get(pageId);
      if (rowId) {
        return { sourceType: 'database_row', sourceId: rowId };
      }
      return { sourceType: 'page', sourceId: pageId };
    });
  }

  private async expandRoots(
    roots: AiContextRoot[],
    spaceId: string,
    workspaceId: string,
    user: User,
    excluded: Set<string>,
    strict: boolean,
  ): Promise<
    Array<{
      source: AiContextSource;
      origin: 'current_document' | 'explicit';
    }>
  > {
    const readable = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      spaceId,
    );
    const result: Array<{
      source: AiContextSource;
      origin: 'current_document' | 'explicit';
    }> = [];
    const seen = new Set<string>();
    for (const root of roots) {
      if (
        excluded.has(root.source.pageId) ||
        !readable.readablePageIds.has(root.source.pageId)
      ) {
        if (strict) {
          throw new BadRequestException({
            code: excluded.has(root.source.pageId)
              ? 'ai_context_source_excluded'
              : 'context_source_unavailable',
            message: 'An AI context source is unavailable',
          });
        }
        continue;
      }
      if (!seen.has(root.source.pageId)) {
        seen.add(root.source.pageId);
        result.push({ source: root.source, origin: root.origin });
      }
      if (
        root.source.sourceType !== 'page' ||
        root.descendants.mode === 'none'
      ) {
        continue;
      }
      const tree = await this.pageRepo.getPageAndDescendants(
        root.source.pageId,
        { includeContent: false },
      );
      const validDescendants = tree
        .filter(
          (page) =>
            page.id !== root.source.pageId &&
            page.spaceId === spaceId &&
            page.workspaceId === workspaceId,
        )
        .map((page) => page.id);
      const validSet = new Set(validDescendants);
      let selectedIds =
        root.descendants.mode === 'all'
          ? validDescendants
          : root.descendants.pageIds;
      if (
        root.descendants.mode === 'selected' &&
        selectedIds.some((pageId) => !validSet.has(pageId))
      ) {
        if (strict) {
          throw new BadRequestException({
            code: 'ai_context_descendant_invalid',
            message: 'A selected page is not a descendant of its context root',
          });
        }
        selectedIds = selectedIds.filter((pageId) => validSet.has(pageId));
      }
      const blockedSelected = selectedIds.filter(
        (pageId) =>
          excluded.has(pageId) || !readable.readablePageIds.has(pageId),
      );
      if (
        strict &&
        root.descendants.mode === 'selected' &&
        blockedSelected.length > 0
      ) {
        throw new BadRequestException({
          code: blockedSelected.some((pageId) => excluded.has(pageId))
            ? 'ai_context_source_excluded'
            : 'context_source_unavailable',
          message: 'A selected descendant is unavailable',
        });
      }
      selectedIds = selectedIds.filter(
        (pageId) =>
          !excluded.has(pageId) && readable.readablePageIds.has(pageId),
      );
      const uniqueIds = selectedIds.filter((pageId) => !seen.has(pageId));
      uniqueIds.forEach((pageId) => seen.add(pageId));
      const inputs = await this.inputsForPageIds(uniqueIds);
      const descriptors = await this.resolveDescriptors(
        inputs,
        spaceId,
        workspaceId,
        user,
        false,
      );
      descriptors.forEach((source) => {
        if (source.available) result.push({ source, origin: 'explicit' });
      });
      if (result.length > AI_CONTEXT_LIMITS.resolvedSources) {
        return result;
      }
    }
    return result;
  }

  private resolvedSourceLimit(
    resolvedCount: number,
    roots: AiContextRoot[],
  ): BadRequestException {
    return new BadRequestException({
      code: 'ai_context_resolved_source_limit',
      message: 'AI context expands beyond the resolved source limit',
      limit: AI_CONTEXT_LIMITS.resolvedSources,
      resolvedCount,
      rootPageIds: roots
        .filter((root) => root.descendants.mode !== 'none')
        .map((root) => root.source.pageId),
    });
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
    const excluded = await this.contentPolicy.getExcludedPageIds(
      spaceId,
      workspaceId,
    );
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) =>
          !row.pageId ||
          !readable.readablePageIds.has(row.pageId) ||
          excluded.has(row.pageId),
      )
    ) {
      throw this.contextUnavailable();
    }
  }

  private fingerprint(value: unknown): string {
    return hashCanonicalJson(value);
  }

  private contextUnavailable(): BadRequestException {
    return new BadRequestException({
      code: 'context_source_unavailable',
      message: 'An AI context source is unavailable',
    });
  }
}
