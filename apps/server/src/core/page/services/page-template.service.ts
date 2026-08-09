import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { v7 as uuid7, validate as isUuid } from 'uuid';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { strictJsonToNode } from '../../../collaboration/collaboration.util';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageEmbedService } from '../transclusion/page-embed.service';
import { PageTemplatePolicyService } from '../transclusion/page-template-policy.service';
import { TransclusionService } from '../transclusion/transclusion.service';
import { materializePageContent } from '../transclusion/utils/page-embed-materialize.util';
import { rewriteAttachmentsForUnsync } from '../transclusion/utils/transclusion-unsync.util';
import {
  CreatePageTemplateDto,
  CreateFromTemplateDto,
  DetachPageEmbedDto,
  InsertPageEmbedDto,
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
} from '../dto/page-template.dto';
import { PageService } from './page.service';
import { executeTx } from '@docmost/db/utils';
import type { PageEmbedGraphLease } from '../transclusion/page-embed-graph-lock.service';
import { getAttachmentIds } from '../../../common/helpers/prosemirror/utils';
import { PageHistoryRecorderService } from './page-history-recorder.service';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';
import { MAX_PAGE_TREE_DEPTH } from '../../../common/config/page-tree.constants';
import type { TemplateKind } from '@docmost/api-contract';
import {
  collectTemplateFields,
  createTemplateInstanceContent,
  detachTemplateContent,
  isTemplateFieldFilled,
  normalizeTemplateDraft,
  summarizeTemplateDiff,
} from '@docmost/editor-ext';
import {
  DetachSyncedTemplateDto,
  PublishPageTemplateDto,
} from '../dto/page-template.dto';

type OperationKind =
  | 'snapshot'
  | 'embed_insert'
  | 'embed_detach'
  | 'template_sync'
  | 'template_detach'
  | 'legacy_embed_migration';
const OPERATION_LEASE_MS = 5 * 60 * 1000;
const PUBLISH_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

type LegacyAttachmentCopyPlan = {
  source: Page;
  copies: Array<{ oldAttachmentId: string; newAttachmentId: string }>;
};

type LegacyMigrationIssue = {
  referenceNodeId: string;
  sourcePageId: string | null;
  errorCode: string;
};

@Injectable()
export class PageTemplateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PageTemplateService.name);
  private readonly activeSyncRuns = new Set<string>();
  private syncResumeTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    private readonly collaborationGateway: CollaborationGateway,
    private readonly policy: PageTemplatePolicyService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly transclusionService: TransclusionService,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    @Optional() private readonly queueOutbox?: QueueOutboxService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.migrateLegacyPageEmbeds();
    void this.resumePendingSyncRuns();
    this.syncResumeTimer = setInterval(
      () => void this.resumePendingSyncRuns(),
      15_000,
    );
    this.syncResumeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.syncResumeTimer) clearInterval(this.syncResumeTimer);
  }

  async getProvenance(pageId: string, user: User) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    const pageAccess = await this.pageAccessService.getEffectiveAccess(
      page,
      user,
    );
    if (!pageAccess.capabilities.canRead) throw new ForbiddenException();

    const instance = await this.db
      .selectFrom('pageTemplateInstances')
      .selectAll()
      .where('childPageId', '=', page.id)
      .executeTakeFirst();
    const legacyOperation = instance
      ? null
      : await this.db
          .selectFrom('pageTemplateOperations')
          .select(['sourcePageId'])
          .where('workspaceId', '=', user.workspaceId)
          .where('operationKind', '=', 'snapshot')
          .where('status', '=', 'completed')
          .where('resultPageId', '=', page.id)
          .orderBy('createdAt', 'asc')
          .executeTakeFirst();
    if (!instance && !legacyOperation) {
      return { createdFromTemplate: false, sourceTemplate: null };
    }

    const sourcePageId =
      instance?.templatePageId ?? legacyOperation?.sourcePageId;
    const latestRevision = sourcePageId
      ? await this.db
          .selectFrom('pageTemplateRevisions')
          .select((eb) => eb.fn.max<number>('revision').as('revision'))
          .where('templatePageId', '=', sourcePageId)
          .executeTakeFirst()
      : null;
    if (!sourcePageId) {
      return {
        createdFromTemplate: true,
        kind: instance?.instanceKind ?? 'regular',
        status: instance?.status ?? 'snapshot',
        appliedRevision: instance?.appliedRevision ?? null,
        latestRevision: latestRevision?.revision ?? null,
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          instance?.status === 'active' && pageAccess.capabilities.canWrite,
      };
    }

    const source = await this.pageRepo.findById(sourcePageId, {
      includeSpace: true,
    });
    if (
      !source ||
      source.deletedAt ||
      source.workspaceId !== page.workspaceId ||
      source.spaceId !== page.spaceId
    ) {
      return {
        createdFromTemplate: true,
        kind: instance?.instanceKind ?? 'regular',
        status: instance?.status ?? 'snapshot',
        appliedRevision: instance?.appliedRevision ?? null,
        latestRevision: latestRevision?.revision ?? null,
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          instance?.status === 'active' && pageAccess.capabilities.canWrite,
      };
    }

    const sourceAccess = await this.pageAccessService.getEffectiveAccess(
      source,
      user,
    );
    if (!sourceAccess.capabilities.canRead) {
      return {
        createdFromTemplate: true,
        kind: instance?.instanceKind ?? 'regular',
        status: instance?.status ?? 'snapshot',
        appliedRevision: instance?.appliedRevision ?? null,
        latestRevision: latestRevision?.revision ?? null,
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          instance?.status === 'active' && pageAccess.capabilities.canWrite,
      };
    }

    return {
      createdFromTemplate: true,
      kind: instance?.instanceKind ?? 'regular',
      status: instance?.status ?? 'snapshot',
      appliedRevision: instance?.appliedRevision ?? null,
      latestRevision: latestRevision?.revision ?? null,
      canReadTemplate: true,
      canDetach:
        instance?.status === 'active' && pageAccess.capabilities.canWrite,
      sourceTemplate: {
        id: source.id,
        slugId: source.slugId,
        title: source.title,
        icon: source.icon,
        spaceSlug:
          (source as typeof source & { space?: { slug?: string } }).space
            ?.slug ?? null,
      },
    };
  }

  async discover(dto: PageTemplateDiscoveryDto, user: User) {
    const limit = dto.limit ?? 20;
    const candidateLimit = Math.min(limit * 5 + 1, 251);
    const offset = this.decodeCursor(dto.cursor);
    const effective = await this.policy.resolveForUser(
      user.workspaceId,
      dto.spaceId,
      user.id,
    );
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    const enabled =
      effective.systemEnabled &&
      effective.workspaceEnabled &&
      effective.templatesEnabled;
    const capabilities = {
      enabled,
      createTemplate:
        enabled &&
        effective.allowCreateTemplate &&
        effective.allowedActions.includes('create_template') &&
        ability.can(SpaceCaslAction.Create, SpaceCaslSubject.Page),
      useRegular:
        enabled &&
        effective.allowRegularTemplate &&
        effective.allowedActions.includes('use_regular_template'),
      useSynced:
        enabled &&
        effective.allowSyncedTemplate &&
        effective.allowedActions.includes('use_synced_template'),
    };
    if (!enabled) {
      return { items: [], nextCursor: null, capabilities };
    }

    let query = this.db
      .selectFrom('pages as page')
      .innerJoin('spaces as space', 'space.id', 'page.spaceId')
      .select([
        'page.id',
        'page.slugId',
        'page.title',
        'page.icon',
        'page.spaceId',
        'page.updatedAt',
        'page.templateKind',
        'page.templateArchivedAt',
        'space.name as spaceName',
        'space.slug as spaceSlug',
      ])
      .where('page.workspaceId', '=', user.workspaceId)
      .where('page.spaceId', '=', dto.spaceId)
      .where('page.templateKind', 'is not', null)
      .where('page.deletedAt', 'is', null)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'page.id')
              .where('databases.deletedAt', 'is', null),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'page.id')
              .where('databaseRows.archivedAt', 'is', null),
          ),
        ),
      )
      .orderBy('page.updatedAt', 'desc')
      .orderBy('page.id', 'desc')
      .offset(offset)
      .limit(candidateLimit);
    if (dto.kind) {
      query = query.where('page.templateKind', '=', dto.kind);
    }
    if (!dto.includeArchived) {
      query = query.where('page.templateArchivedAt', 'is', null);
    }
    if (dto.query?.trim()) {
      query = query.where('page.title', 'ilike', `%${dto.query.trim()}%`);
    }
    const candidates = await query.execute();
    const candidateIds = candidates.map((candidate) => candidate.id);
    const [favoriteRows, recentPages, revisionRows, instanceRows] =
      await Promise.all([
        candidates.length > 0
          ? this.db
              .selectFrom('favorites')
              .select('pageId')
              .where('userId', '=', user.id)
              .where(
                'pageId',
                'in',
                candidates.map((candidate) => candidate.id),
              )
              .execute()
          : [],
        this.pageRepo.getRecentPagesInSpace(dto.spaceId, {
          limit: 50,
          query: undefined,
          adminView: false,
        }),
        candidateIds.length > 0
          ? this.db
              .selectFrom('pageTemplateRevisions')
              .select(['templatePageId'])
              .select((eb) => eb.fn.max<number>('revision').as('revision'))
              .select((eb) => eb.fn.max<Date>('createdAt').as('publishedAt'))
              .where('templatePageId', 'in', candidateIds)
              .groupBy('templatePageId')
              .execute()
          : [],
        candidateIds.length > 0
          ? this.db
              .selectFrom('pageTemplateInstances')
              .select(['templatePageId', 'status'])
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('templatePageId', 'in', candidateIds)
              .where('status', 'in', ['active', 'syncing', 'error'])
              .groupBy(['templatePageId', 'status'])
              .execute()
          : [],
      ]);
    const favoritePageIds = new Set(favoriteRows.map((row) => row.pageId));
    const recentPageIds = new Set(recentPages.items.map((page) => page.id));
    const revisionByTemplate = new Map(
      revisionRows.map((row) => [row.templatePageId, row] as const),
    );
    const instanceCounts = new Map<
      string,
      { active: number; failed: number }
    >();
    for (const row of instanceRows) {
      if (!row.templatePageId) continue;
      const counts = instanceCounts.get(row.templatePageId) ?? {
        active: 0,
        failed: 0,
      };
      counts.active += Number(row.count);
      if (row.status === 'error') counts.failed += Number(row.count);
      instanceCounts.set(row.templatePageId, counts);
    }
    const items: any[] = [];
    let consumed = 0;
    for (const candidate of candidates) {
      if (items.length >= limit) break;
      consumed += 1;
      const page = await this.pageRepo.findById(candidate.id);
      if (!page) continue;
      const access = await this.pageAccessService.getEffectiveAccess(
        page,
        user,
      );
      if (!access.capabilities.canRead) continue;
      items.push({
        ...candidate,
        kind: candidate.templateKind,
        archivedAt: candidate.templateArchivedAt,
        publishedRevision:
          revisionByTemplate.get(candidate.id)?.revision ?? null,
        draftChanged:
          !revisionByTemplate.has(candidate.id) ||
          candidate.updatedAt >
            (revisionByTemplate.get(candidate.id)?.publishedAt ?? new Date(0)),
        activeInstanceCount: instanceCounts.get(candidate.id)?.active ?? 0,
        failedInstanceCount: instanceCounts.get(candidate.id)?.failed ?? 0,
        favorite: favoritePageIds.has(page.id),
        recent: recentPageIds.has(page.id),
        actions: {
          use:
            candidate.templateKind === 'regular'
              ? capabilities.useRegular
              : capabilities.useSynced &&
                revisionByTemplate.has(candidate.id) &&
                !candidate.templateArchivedAt,
          manage:
            access.capabilities.canWrite &&
            effective.allowCreateTemplate &&
            effective.allowedActions.includes('manage_template'),
        },
      });
    }
    return {
      items,
      nextCursor:
        candidates.length > consumed || candidates.length === candidateLimit
          ? this.encodeCursor(offset + consumed)
          : null,
      capabilities,
    };
  }

  async createTemplate(dto: CreatePageTemplateDto, user: User) {
    await this.policy.assertAction(
      user.workspaceId,
      dto.spaceId,
      user.id,
      'create_template',
    );
    await this.assertCanCreate(dto.spaceId, undefined, user);
    const source = dto.sourcePageId
      ? await this.requirePlainDocument(dto.sourcePageId, user.workspaceId)
      : null;
    if (source) {
      await this.pageAccessService.assertCanReadPage(source, user);
      if (source.spaceId !== dto.spaceId) {
        throw new NotFoundException('Source page not found');
      }
    }
    const sourceContent = source
      ? await this.getLiveContent(source.id, user)
      : { type: 'doc', content: [{ type: 'paragraph' }] };
    const targetPageId = uuid7();
    const materialized = source
      ? materializePageContent(sourceContent, {
          sourcePageId: source.id,
          targetPageId,
        })
      : sourceContent;
    const normalized =
      dto.kind === 'synced'
        ? normalizeTemplateDraft(materialized, uuid7)
        : materialized;
    const rewritten = source
      ? rewriteAttachmentsForUnsync(normalized, () => uuid7())
      : { content: normalized, copies: [] };
    const content = rewritten.content;
    strictJsonToNode(content as any);
    const copiedPaths: string[] = [];
    try {
      const attachmentRows = source
        ? await this.copyAttachments(
            rewritten.copies,
            source,
            targetPageId,
            dto.spaceId,
            user,
            copiedPaths,
            false,
          )
        : [];
      const page = await executeTx(this.db, async (trx) => {
        const created = await this.pageService.create(
          user.id,
          user.workspaceId,
          {
            spaceId: dto.spaceId,
            title: dto.title ?? source?.title ?? undefined,
            icon: source?.icon ?? undefined,
            content,
            format: 'json',
          },
          {
            pageId: targetPageId,
            templateKind: dto.kind,
            trx,
            deferSideEffects: true,
          },
        );
        for (const row of attachmentRows) {
          await this.attachmentRepo.insertAttachment(row, trx);
        }
        await this.transclusionService.insertTransclusionsForPages(
          [
            {
              id: created.id,
              workspaceId: created.workspaceId,
              content: created.content,
            },
          ],
          trx,
        );
        await this.transclusionService.insertReferencesForPages(
          [
            {
              id: created.id,
              workspaceId: created.workspaceId,
              content: created.content,
            },
          ],
          trx,
        );
        return created;
      });
      await this.pageService.finalizeCreatedPage(page, user.id);
      return { page };
    } catch (error) {
      await Promise.allSettled(
        copiedPaths.map((path) => this.storageService.delete(path)),
      );
      throw error;
    }
  }

  async listDestinations(dto: PageTemplateDestinationsDto, user: User) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    let query = this.db
      .selectFrom('pages as page')
      .select('page.id')
      .where('page.workspaceId', '=', user.workspaceId)
      .where('page.spaceId', '=', dto.spaceId)
      .where('page.deletedAt', 'is', null)
      .where('page.templateKind', 'is', null)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'page.id')
              .where('databases.deletedAt', 'is', null),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'page.id')
              .where('databaseRows.archivedAt', 'is', null),
          ),
        ),
      )
      .orderBy('page.updatedAt', 'desc')
      .orderBy('page.id', 'desc')
      .limit(Math.min((dto.limit ?? 20) * 5, 250));
    if (dto.query?.trim()) {
      query = query.where('page.title', 'ilike', `%${dto.query.trim()}%`);
    }
    const candidates = await query.execute();
    const pages = (
      await Promise.all(candidates.map(({ id }) => this.pageRepo.findById(id)))
    ).filter((page): page is Page => Boolean(page && !page.deletedAt));
    const accessByPageId =
      await this.pageAccessService.getEffectiveAccessForPages(pages, user);
    return {
      rootAllowed: ability.can(SpaceCaslAction.Create, SpaceCaslSubject.Page),
      items: pages
        .filter(
          (page) =>
            accessByPageId.get(page.id)?.capabilities.canCreateChild === true,
        )
        .slice(0, dto.limit ?? 20)
        .map((page) => ({
          id: page.id,
          slugId: page.slugId,
          title: page.title ?? null,
          icon: page.icon ?? null,
          parentPageId: page.parentPageId ?? null,
        })),
    };
  }

  async createFromTemplate(
    dto: CreateFromTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    const completedOperation = await this.findCompletedOperation(
      'snapshot',
      idempotencyKey,
      user,
      dto,
    );
    if (completedOperation?.resultPageId) {
      const completedPage = await this.pageRepo.findById(
        completedOperation.resultPageId,
      );
      if (!completedPage || completedPage.deletedAt) {
        throw new NotFoundException('Completed template result not found');
      }
      await this.pageAccessService.assertCanReadPage(completedPage, user);
      return { page: completedPage, idempotent: true };
    }
    const source = await this.requireTemplateSource(dto.templatePageId, user);
    if (source.spaceId !== dto.spaceId) {
      throw new NotFoundException('Template not found');
    }
    if (source.templateArchivedAt) {
      throw new ConflictException({
        code: 'page_template_archived',
        message: 'Archived templates cannot be used',
      });
    }
    const templateKind = source.templateKind as TemplateKind;
    await this.policy.assertAction(
      source.workspaceId,
      source.spaceId,
      user.id,
      templateKind === 'regular'
        ? 'use_regular_template'
        : 'use_synced_template',
    );
    await this.assertCanCreate(dto.spaceId, dto.parentPageId, user);
    await this.policy.assertAction(
      user.workspaceId,
      dto.spaceId,
      user.id,
      templateKind === 'regular'
        ? 'use_regular_template'
        : 'use_synced_template',
    );
    const publishedRevision =
      templateKind === 'synced'
        ? await this.db
            .selectFrom('pageTemplateRevisions')
            .selectAll()
            .where('templatePageId', '=', source.id)
            .orderBy('revision', 'desc')
            .executeTakeFirst()
        : null;
    if (templateKind === 'synced' && !publishedRevision) {
      throw new ConflictException({
        code: 'page_template_not_published',
        message: 'Publish the synchronized template before using it',
      });
    }

    const proposedTargetPageId = uuid7();
    const operation = await this.beginOperation(
      'snapshot',
      idempotencyKey,
      user,
      dto,
      { sourcePageId: source.id, resultPageId: proposedTargetPageId },
    );
    if (operation.status === 'completed' && operation.resultPageId) {
      const existing = await this.pageRepo.findById(operation.resultPageId);
      if (existing) return { page: existing, idempotent: true };
    }

    const targetPageId = operation.resultPageId as string;
    const recoveredPage = await this.pageRepo.findById(targetPageId);
    if (recoveredPage && !recoveredPage.deletedAt) {
      await this.completeOperation(
        operation.id,
        { resultPageId: targetPageId },
        operation.leaseToken,
      );
      return { page: recoveredPage, idempotent: true };
    }
    const copiedPaths: string[] = [];
    let graphLease: PageEmbedGraphLease | undefined;
    try {
      const rewritten = operation.stagedContent
        ? {
            content: operation.stagedContent,
            copies: this.readAttachmentMapping(operation.attachmentMapping),
          }
        : await this.stageMaterializedContent(
            operation.id,
            operation.leaseToken,
            templateKind === 'synced'
              ? createTemplateInstanceContent(publishedRevision!.content)
              : await this.getLiveContent(source.id, user),
            source.id,
            targetPageId,
            operation.attachmentMapping,
          );
      const attachmentRows = await this.copyAttachments(
        rewritten.copies,
        source,
        targetPageId,
        dto.spaceId,
        user,
        copiedPaths,
        false,
      );
      strictJsonToNode(rewritten.content as any);
      graphLease = await this.pageEmbedService.prepareBulkPageReferences(
        [
          {
            id: targetPageId,
            workspaceId: user.workspaceId,
            spaceId: dto.spaceId,
            content: rewritten.content,
          },
        ],
        user,
        'snapshot',
      );
      await this.assertOperationLease(operation.id, operation.leaseToken);
      const page = await executeTx(this.db, async (trx) => {
        const createdPage = await this.pageService.create(
          user.id,
          user.workspaceId,
          {
            title: dto.title ?? source.title ?? undefined,
            icon: source.icon ?? undefined,
            parentPageId: dto.parentPageId,
            spaceId: dto.spaceId,
            content: rewritten.content as object,
            format: 'json',
          },
          {
            pageId: targetPageId,
            templateKind: null,
            trx,
            deferSideEffects: true,
          },
        );
        for (const row of attachmentRows) {
          await this.attachmentRepo.insertAttachment(row, trx);
        }
        await this.transclusionService.insertTransclusionsForPages(
          [
            {
              id: createdPage.id,
              workspaceId: createdPage.workspaceId,
              content: createdPage.content,
            },
          ],
          trx,
        );
        await this.transclusionService.insertReferencesForPages(
          [
            {
              id: createdPage.id,
              workspaceId: createdPage.workspaceId,
              content: createdPage.content,
            },
          ],
          trx,
        );
        await this.pageEmbedService.insertPageReferencesForPages(
          [
            {
              id: createdPage.id,
              workspaceId: createdPage.workspaceId,
              spaceId: createdPage.spaceId,
              content: createdPage.content,
            },
          ],
          trx,
          graphLease,
        );
        const templateInstance = await trx
          .insertInto('pageTemplateInstances')
          .values({
            workspaceId: user.workspaceId,
            spaceId: dto.spaceId,
            templatePageId: source.id,
            childPageId: createdPage.id,
            instanceKind: templateKind,
            createdRevision: publishedRevision?.revision ?? null,
            appliedRevision: publishedRevision?.revision ?? null,
            status: templateKind === 'synced' ? 'active' : 'snapshot',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (templateKind === 'synced' && rewritten.copies.length > 0) {
          await trx
            .insertInto('pageTemplateAttachmentMappings')
            .values(
              rewritten.copies.map((copy) => ({
                instanceId: templateInstance.id,
                sourceAttachmentId: copy.oldAttachmentId,
                childAttachmentId: copy.newAttachmentId,
              })),
            )
            .execute();
        }
        return createdPage;
      });
      await this.completeOperation(
        operation.id,
        {
          resultPageId: page.id,
          attachmentMapping: rewritten.copies as any,
        },
        operation.leaseToken,
      );
      await this.pageService.finalizeCreatedPage(page, user.id);
      return { page, idempotent: false };
    } catch (error) {
      const ownsLease = await this.ownsOperationLease(
        operation.id,
        operation.leaseToken,
      );
      if (ownsLease) {
        await this.failOperation(
          operation.id,
          this.errorCode(error),
          operation.leaseToken,
        );
        await this.db
          .deleteFrom('pages')
          .where('id', '=', targetPageId)
          .where('creatorId', '=', user.id)
          .execute();
        await Promise.allSettled(
          copiedPaths.map((path) => this.storageService.delete(path)),
        );
      }
      throw error;
    } finally {
      await this.releaseGraphLease(graphLease);
    }
  }

  async listUsages(pageId: string, user: User) {
    const template = await this.requireManagedTemplate(pageId, user);
    const rows = await this.db
      .selectFrom('pageTemplateInstances as instance')
      .innerJoin('pages as child', 'child.id', 'instance.childPageId')
      .select([
        'instance.childPageId',
        'instance.status',
        'instance.appliedRevision',
        'child.slugId',
        'child.title',
        'child.icon',
        'child.updatedAt',
      ])
      .where('instance.templatePageId', '=', template.id)
      .where('child.deletedAt', 'is', null)
      .orderBy('child.updatedAt', 'desc')
      .execute();
    const pages = (
      await Promise.all(
        rows.map((row) => this.pageRepo.findById(row.childPageId)),
      )
    ).filter((page): page is Page => Boolean(page));
    const access = await this.pageAccessService.getEffectiveAccessForPages(
      pages,
      user,
    );
    const readableIds = new Set(
      pages
        .filter((page) => access.get(page.id)?.capabilities.canRead === true)
        .map((page) => page.id),
    );
    return {
      totalCount: rows.length,
      hiddenCount: rows.filter((row) => !readableIds.has(row.childPageId))
        .length,
      items: rows.filter((row) => readableIds.has(row.childPageId)),
    };
  }

  async preflightPublish(pageId: string, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const liveDraft = await this.getLiveContent(template.id, user);
    const draft = this.normalizeDraftForPublication(liveDraft);
    return this.buildPublishPreflight(template, user, true, draft);
  }

  async publish(pageId: string, dto: PublishPageTemplateDto, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    if (template.templateArchivedAt) {
      throw new ConflictException({
        code: 'page_template_archived',
        message: 'Archived templates cannot be published',
      });
    }
    const draft = this.normalizeDraftForPublication(
      await this.getLiveContent(template.id, user),
    );
    const draftHash = hashProseMirrorJson(draft as any);
    if (draftHash !== dto.draftHash) {
      throw this.conflict(
        'page_template_draft_changed',
        'The template draft changed after the publication preview',
      );
    }
    const preflight = await this.buildPublishPreflight(
      template,
      user,
      false,
      draft,
    );
    if (preflight.requiresDestructiveConfirmation) {
      if (!dto.confirmationToken) {
        throw this.conflict(
          'page_template_destructive_confirmation_required',
          'Removing populated template fields requires confirmation',
        );
      }
      const confirmation = await this.db
        .selectFrom('pageTemplatePublishConfirmations')
        .selectAll()
        .where('id', '=', dto.confirmationToken)
        .where('templatePageId', '=', template.id)
        .where('requestedById', '=', user.id)
        .where('draftHash', '=', draftHash)
        .where('consumedAt', 'is', null)
        .where('expiresAt', '>', new Date())
        .executeTakeFirst();
      if (!confirmation) {
        throw this.conflict(
          'page_template_confirmation_invalid',
          'The destructive confirmation is missing, expired, or stale',
        );
      }
    }

    const result = await executeTx(this.db, async (trx) => {
      const lockedTemplate = await this.pageRepo.findById(template.id, {
        withLock: true,
        trx,
      });
      if (
        !lockedTemplate ||
        lockedTemplate.templateKind !== 'synced' ||
        lockedTemplate.templateArchivedAt
      ) {
        throw this.conflict(
          'page_template_publish_conflict',
          'The template is no longer publishable',
        );
      }
      if (dto.confirmationToken) {
        const consumed = await trx
          .updateTable('pageTemplatePublishConfirmations')
          .set({ consumedAt: new Date() })
          .where('id', '=', dto.confirmationToken)
          .where('templatePageId', '=', template.id)
          .where('requestedById', '=', user.id)
          .where('draftHash', '=', draftHash)
          .where('consumedAt', 'is', null)
          .where('expiresAt', '>', new Date())
          .returning('id')
          .executeTakeFirst();
        if (preflight.requiresDestructiveConfirmation && !consumed) {
          throw this.conflict(
            'page_template_confirmation_invalid',
            'The destructive confirmation is missing, expired, or stale',
          );
        }
      }
      const latest = await trx
        .selectFrom('pageTemplateRevisions')
        .select((eb) => eb.fn.max<number>('revision').as('revision'))
        .where('templatePageId', '=', template.id)
        .executeTakeFirst();
      const revisionNumber = Number(latest?.revision ?? 0) + 1;
      const revision = await trx
        .insertInto('pageTemplateRevisions')
        .values({
          workspaceId: template.workspaceId,
          spaceId: template.spaceId,
          templatePageId: template.id,
          revision: revisionNumber,
          content: draft as any,
          contentHash: draftHash,
          publishedById: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const instances = await trx
        .selectFrom('pageTemplateInstances')
        .select(['id', 'childPageId'])
        .where('templatePageId', '=', template.id)
        .where('instanceKind', '=', 'synced')
        .where('status', 'in', ['active', 'syncing', 'error'])
        .execute();
      const run = await trx
        .insertInto('pageTemplateSyncRuns')
        .values({
          workspaceId: template.workspaceId,
          spaceId: template.spaceId,
          templatePageId: template.id,
          revisionId: revision.id,
          revision: revisionNumber,
          requestedById: user.id,
          status: instances.length > 0 ? 'pending' : 'completed',
          totalCount: instances.length,
          completedAt: instances.length > 0 ? null : new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (instances.length > 0) {
        await trx
          .insertInto('pageTemplateSyncItems')
          .values(
            instances.map((instance) => ({
              runId: run.id,
              instanceId: instance.id,
              childPageId: instance.childPageId,
            })),
          )
          .execute();
        if (!this.queueOutbox) {
          throw new Error('page_template_sync_outbox_unavailable');
        }
        await this.queueOutbox.enqueuePageTemplateSync(
          { runId: run.id },
          revision.id,
          trx,
        );
      }
      return { revision, run };
    });
    if (result.run.status === 'pending') {
      this.queueOutbox!.kick();
    }
    return {
      revision: this.serializeRevision(result.revision),
      syncRun: this.serializeSyncRun(result.run),
    };
  }

  async listRevisions(pageId: string, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const revisions = await this.db
      .selectFrom('pageTemplateRevisions')
      .selectAll()
      .where('templatePageId', '=', template.id)
      .orderBy('revision', 'desc')
      .execute();
    return {
      items: revisions.map((revision) =>
        this.serializeRevision(revision, true),
      ),
    };
  }

  async listSyncRuns(pageId: string, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const runs = await this.db
      .selectFrom('pageTemplateSyncRuns')
      .selectAll()
      .where('templatePageId', '=', template.id)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .execute();
    return { items: runs.map((run) => this.serializeSyncRun(run)) };
  }

  async retrySyncRun(pageId: string, runId: string, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const run = await this.db
      .selectFrom('pageTemplateSyncRuns')
      .selectAll()
      .where('id', '=', runId)
      .where('templatePageId', '=', template.id)
      .executeTakeFirst();
    if (!run)
      throw new NotFoundException('Template synchronization run not found');
    const dispatchId = uuid7();
    await executeTx(this.db, async (trx) => {
      await trx
        .updateTable('pageTemplateSyncItems')
        .set({ status: 'pending', errorCode: null, updatedAt: new Date() })
        .where('runId', '=', run.id)
        .where('status', '=', 'failed')
        .execute();
      await trx
        .updateTable('pageTemplateSyncRuns')
        .set({
          status: 'pending',
          errorCode: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', run.id)
        .execute();
      if (!this.queueOutbox) {
        throw new Error('page_template_sync_outbox_unavailable');
      }
      await this.queueOutbox.enqueuePageTemplateSync(
        { runId: run.id },
        dispatchId,
        trx,
      );
    });
    this.queueOutbox!.kick();
    return { accepted: true, runId: run.id };
  }

  async processSyncRunFromOutbox(runId: string): Promise<void> {
    await this.processSyncRun(runId);
  }

  async archive(pageId: string, user: User) {
    const template = await this.requireManagedTemplate(pageId, user);
    if (!template.templateArchivedAt) {
      await this.pageRepo.updatePage(
        {
          templateArchivedAt: new Date(),
          lastUpdatedById: user.id,
          updatedAt: new Date(),
        },
        template.id,
      );
    }
    return { pageId: template.id, archived: true };
  }

  async detachTemplate(
    pageId: string,
    dto: DetachSyncedTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    if (!dto.confirmed) {
      throw new BadRequestException({
        code: 'page_template_detach_confirmation_required',
        message: 'Detaching a synchronized page requires confirmation',
      });
    }
    this.assertIdempotencyKey(idempotencyKey);
    const page = await this.requirePlainDocument(pageId, user.workspaceId);
    await this.pageAccessService.assertCanWritePage(page, user);
    const instance = await this.db
      .selectFrom('pageTemplateInstances')
      .selectAll()
      .where('childPageId', '=', page.id)
      .where('instanceKind', '=', 'synced')
      .executeTakeFirst();
    if (!instance)
      throw new NotFoundException('Synchronized template link not found');
    if (instance.status === 'detached') {
      return { pageId: page.id, detached: true, idempotent: true };
    }
    const current = await this.getLiveContent(page.id, user);
    const existingOperation = await this.findOperation(
      'template_detach',
      idempotencyKey,
      user,
    );
    if (existingOperation?.status === 'completed') {
      if (
        existingOperation.requestHash !== this.hashRequest({ pageId, ...dto })
      ) {
        throw this.conflict(
          'page_template_idempotency_conflict',
          'Idempotency key was used for a different request',
        );
      }
      if (
        this.containsNodeType(current, 'templateManagedBlock') ||
        this.containsNodeType(current, 'templateField')
      ) {
        throw this.conflict(
          'page_template_detach_incomplete',
          'The detach operation did not finish cleanly',
        );
      }
      await this.db
        .updateTable('pageTemplateInstances')
        .set({
          status: 'detached',
          templatePageId: null,
          detachedAt: new Date(),
          detachedById: user.id,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where('id', '=', instance.id)
        .where('status', '!=', 'detached')
        .execute();
      await this.pageHistoryRecorder.enqueuePageEvent({
        pageId: page.id,
        changeType: 'page.template.detached',
        changeData: { templateKind: 'synced' },
        actorId: user.id,
      });
      return {
        pageId: page.id,
        detached: true,
        afterContentHash: existingOperation.afterContentHash,
        idempotent: true,
      };
    }
    if (hashProseMirrorJson(current as any) !== dto.baseContentHash) {
      throw this.conflict('page_template_stale', 'The document changed');
    }
    const operation = await this.beginOperation(
      'template_detach',
      idempotencyKey,
      user,
      { pageId, ...dto },
      {
        sourcePageId: instance.templatePageId ?? undefined,
        consumerPageId: page.id,
        baseContentHash: dto.baseContentHash,
      },
    );
    if (operation.status === 'completed' && instance.status === 'detached') {
      return { pageId: page.id, detached: true, idempotent: true };
    }
    const next = detachTemplateContent(current);
    const result = await this.applyMutation(
      page.id,
      current,
      next,
      dto.baseContentHash,
      operation.id,
      operation.leaseToken,
      user,
    );
    await this.db
      .updateTable('pageTemplateInstances')
      .set({
        status: 'detached',
        templatePageId: null,
        detachedAt: new Date(),
        detachedById: user.id,
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where('id', '=', instance.id)
      .where('status', '!=', 'detached')
      .execute();
    await this.pageHistoryRecorder.enqueuePageEvent({
      pageId: page.id,
      changeType: 'page.template.detached',
      changeData: { templateKind: 'synced' },
      actorId: user.id,
    });
    return {
      pageId: page.id,
      detached: true,
      afterContentHash: result.afterHash,
      idempotent: false,
    };
  }

  async insertPageEmbed(
    dto: InsertPageEmbedDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    const completedOperation = await this.findCompletedOperation(
      'embed_insert',
      idempotencyKey,
      user,
      dto,
    );
    if (completedOperation) {
      const completedConsumer = await this.requirePlainDocument(
        dto.consumerPageId,
        user.workspaceId,
      );
      await this.pageAccessService.assertCanWritePage(completedConsumer, user);
      return {
        referenceNodeId: completedOperation.referenceNodeId,
        afterContentHash: completedOperation.afterContentHash,
        idempotent: true,
      };
    }
    const [consumer, source] = await Promise.all([
      this.requirePlainDocument(dto.consumerPageId, user.workspaceId),
      this.requireTemplateSource(dto.sourcePageId, user),
    ]);
    if (consumer.spaceId !== source.spaceId) {
      throw new NotFoundException('Template not found');
    }
    await this.pageAccessService.assertCanWritePage(consumer, user);
    await this.policy.assertAction(
      user.workspaceId,
      consumer.spaceId,
      user.id,
      'use_synced_template',
    );
    await this.policy.assertAction(
      user.workspaceId,
      source.spaceId,
      user.id,
      'use_synced_template',
    );

    const referenceNodeId = uuid7();
    const operation = await this.beginOperation(
      'embed_insert',
      idempotencyKey,
      user,
      dto,
      {
        sourcePageId: source.id,
        consumerPageId: consumer.id,
        referenceNodeId,
        baseContentHash: dto.baseContentHash,
      },
    );
    if (operation.status === 'completed') {
      return {
        referenceNodeId: operation.referenceNodeId,
        afterContentHash: operation.afterContentHash,
        idempotent: true,
      };
    }

    try {
      const current = await this.getLiveContent(consumer.id, user);
      const recovered = this.findPageEmbed(current, operation.referenceNodeId);
      if (recovered?.sourcePageId === source.id) {
        const afterContentHash = hashProseMirrorJson(current as any);
        await this.completeOperation(
          operation.id,
          { afterContentHash },
          operation.leaseToken,
        );
        return {
          referenceNodeId: operation.referenceNodeId,
          afterContentHash,
          idempotent: true,
        };
      }
      if (hashProseMirrorJson(current as any) !== dto.baseContentHash) {
        throw this.conflict('page_embed_stale', 'The document changed');
      }
      const doc = strictJsonToNode(current as any);
      if (dto.to < dto.from || dto.to > doc.content.size) {
        throw this.conflict(
          'page_embed_stale',
          'The insertion position is stale',
        );
      }
      const node = doc.type.schema.nodes.pageEmbed.create({
        id: operation.referenceNodeId,
        sourcePageId: source.id,
      });
      const next = new Transform(doc)
        .replaceWith(dto.from, dto.to, node)
        .doc.toJSON();
      await this.pageEmbedService.assertGraphValid(
        user.workspaceId,
        consumer.id,
        this.collectPageSources(next),
      );
      await this.assertOperationLease(operation.id, operation.leaseToken);
      const result = await this.applyMutation(
        consumer.id,
        current,
        next,
        dto.baseContentHash,
        operation.id,
        operation.leaseToken,
        user,
      );
      await this.completeOperation(
        operation.id,
        {
          afterContentHash: result.afterHash,
        },
        operation.leaseToken,
      );
      return {
        referenceNodeId: operation.referenceNodeId,
        afterContentHash: result.afterHash,
        idempotent: false,
      };
    } catch (error) {
      if (await this.ownsOperationLease(operation.id, operation.leaseToken)) {
        await this.failOperation(
          operation.id,
          this.errorCode(error),
          operation.leaseToken,
        );
      }
      throw error;
    }
  }

  async detachPageEmbed(
    dto: DetachPageEmbedDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    const consumer = await this.requirePlainDocument(
      dto.consumerPageId,
      user.workspaceId,
    );
    await this.pageAccessService.assertCanWritePage(consumer, user);
    const current = await this.getLiveContent(consumer.id, user);
    const currentHash = hashProseMirrorJson(current as any);
    const located = this.findPageEmbed(current, dto.referenceNodeId);
    const existingOperation = await this.findOperation(
      'embed_detach',
      idempotencyKey,
      user,
    );
    if (!located) {
      const completed =
        existingOperation?.status === 'completed'
          ? existingOperation
          : await this.findCompletedDetach(
              consumer.id,
              dto.referenceNodeId,
              user,
            );
      if (completed) {
        return {
          referenceNodeId: dto.referenceNodeId,
          afterContentHash: completed.afterContentHash,
          idempotent: true,
        };
      }
      if (
        existingOperation &&
        ['pending', 'failed'].includes(existingOperation.status)
      ) {
        await this.completeOperation(existingOperation.id, {
          afterContentHash: currentHash,
        });
        return {
          referenceNodeId: dto.referenceNodeId,
          afterContentHash: currentHash,
          idempotent: true,
        };
      }
    }
    if (currentHash !== dto.baseContentHash || !located) {
      throw this.conflict('page_embed_stale', 'The document changed');
    }
    const source = await this.findReadablePlainDocument(
      located.sourcePageId,
      user,
    );
    const operation = await this.beginOperation(
      'embed_detach',
      idempotencyKey,
      user,
      dto,
      {
        sourcePageId: located.sourcePageId,
        consumerPageId: consumer.id,
        referenceNodeId: dto.referenceNodeId,
        baseContentHash: dto.baseContentHash,
      },
    );
    if (operation.status === 'completed') {
      return {
        referenceNodeId: dto.referenceNodeId,
        afterContentHash: operation.afterContentHash,
        idempotent: true,
      };
    }

    const copiedPaths: string[] = [];
    const insertedAttachmentIds: string[] = [];
    try {
      const consumerDoc = strictJsonToNode(current as any);
      let next: unknown;
      let copies: Array<{
        oldAttachmentId: string;
        newAttachmentId: string;
      }> = [];
      if (source) {
        const rewritten = operation.stagedContent
          ? {
              content: operation.stagedContent,
              copies: this.readAttachmentMapping(operation.attachmentMapping),
            }
          : await this.stageMaterializedContent(
              operation.id,
              operation.leaseToken,
              await this.getLiveContent(source.id, user),
              source.id,
              consumer.id,
              operation.attachmentMapping,
            );
        copies = rewritten.copies;
        const sourceDoc = strictJsonToNode(rewritten.content as any);
        const slice = new Slice(Fragment.from(sourceDoc.content), 0, 0);
        next = new Transform(consumerDoc)
          .replace(located.position, located.position + located.nodeSize, slice)
          .doc.toJSON();
      } else {
        next = new Transform(consumerDoc)
          .delete(located.position, located.position + located.nodeSize)
          .doc.toJSON();
      }
      await this.pageEmbedService.assertGraphValid(
        user.workspaceId,
        consumer.id,
        this.collectPageSources(next),
      );
      const rows = await this.copyAttachments(
        copies,
        source!,
        consumer.id,
        consumer.spaceId,
        user,
        copiedPaths,
        false,
      );
      const alreadyPersisted = new Set(
        (
          await this.attachmentRepo.findByIds(
            rows.map((row) => row.id as string),
          )
        )
          .filter((attachment) => attachment.pageId === consumer.id)
          .map((attachment) => attachment.id),
      );
      for (const row of rows) {
        if (alreadyPersisted.has(row.id)) continue;
        await this.attachmentRepo.insertAttachment(row);
        insertedAttachmentIds.push(row.id!);
      }
      await this.assertOperationLease(operation.id, operation.leaseToken);
      const result = await this.applyMutation(
        consumer.id,
        current,
        next,
        dto.baseContentHash,
        operation.id,
        operation.leaseToken,
        user,
      );
      await this.completeOperation(
        operation.id,
        {
          afterContentHash: result.afterHash,
          attachmentMapping: copies as any,
        },
        operation.leaseToken,
      );
      return {
        referenceNodeId: dto.referenceNodeId,
        afterContentHash: result.afterHash,
        idempotent: false,
      };
    } catch (error) {
      const ownsLease = await this.ownsOperationLease(
        operation.id,
        operation.leaseToken,
      );
      if (ownsLease) {
        await this.failOperation(
          operation.id,
          this.errorCode(error),
          operation.leaseToken,
        );
        await Promise.allSettled(
          insertedAttachmentIds.map((id) =>
            this.attachmentRepo.deleteAttachmentById(id),
          ),
        );
        await Promise.allSettled(
          copiedPaths.map((path) => this.storageService.delete(path)),
        );
      }
      const completed = await this.findCompletedDetach(
        consumer.id,
        dto.referenceNodeId,
        user,
      );
      if (completed && completed.id !== operation.id) {
        return {
          referenceNodeId: dto.referenceNodeId,
          afterContentHash: completed.afterContentHash,
          idempotent: true,
        };
      }
      throw error;
    }
  }

  private async buildPublishPreflight(
    template: Page,
    user: User,
    issueConfirmation: boolean,
    suppliedDraft?: unknown,
  ) {
    const draft = this.normalizeDraftForPublication(
      suppliedDraft ?? (await this.getLiveContent(template.id, user)),
    );
    const draftHash = hashProseMirrorJson(draft as any);
    const latest = await this.db
      .selectFrom('pageTemplateRevisions')
      .selectAll()
      .where('templatePageId', '=', template.id)
      .orderBy('revision', 'desc')
      .executeTakeFirst();
    const diff = summarizeTemplateDiff(
      latest?.content ?? { type: 'doc', content: [] },
      draft,
    );
    const removedFieldIds = new Set(
      diff.removedFields.map((field) => field.fieldId),
    );
    const instances = await this.db
      .selectFrom('pageTemplateInstances as instance')
      .innerJoin('pages as child', 'child.id', 'instance.childPageId')
      .select(['instance.id', 'instance.childPageId', 'child.content'])
      .where('instance.templatePageId', '=', template.id)
      .where('instance.instanceKind', '=', 'synced')
      .where('instance.status', 'in', ['active', 'syncing', 'error'])
      .where('child.deletedAt', 'is', null)
      .execute();
    let filledRemovedFieldInstanceCount = 0;
    for (const instance of instances) {
      const liveContent = await this.getLiveContent(
        instance.childPageId,
        user,
      ).catch(() => instance.content);
      const fields = collectTemplateFields(liveContent);
      if (
        [...removedFieldIds].some((fieldId) =>
          isTemplateFieldFilled(fields.get(fieldId)),
        )
      ) {
        filledRemovedFieldInstanceCount += 1;
      }
    }
    let confirmationToken: string | null = null;
    let confirmationExpiresAt: Date | null = null;
    const requiresDestructiveConfirmation =
      removedFieldIds.size > 0 && instances.length > 0;
    if (issueConfirmation && requiresDestructiveConfirmation) {
      confirmationExpiresAt = new Date(
        Date.now() + PUBLISH_CONFIRMATION_TTL_MS,
      );
      const confirmation = await this.db
        .insertInto('pageTemplatePublishConfirmations')
        .values({
          templatePageId: template.id,
          requestedById: user.id,
          draftHash,
          removedFieldIds: [...removedFieldIds] as any,
          filledInstanceCount: filledRemovedFieldInstanceCount,
          expiresAt: confirmationExpiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      confirmationToken = confirmation.id;
    }
    return {
      draftHash,
      nextRevision: Number(latest?.revision ?? 0) + 1,
      diff,
      activeInstanceCount: instances.length,
      filledRemovedFieldInstanceCount,
      requiresDestructiveConfirmation,
      confirmationToken,
      confirmationExpiresAt: confirmationExpiresAt?.toISOString() ?? null,
    };
  }

  private async requireManagedTemplate(
    pageId: string,
    user: User,
  ): Promise<Page> {
    const template = await this.requireTemplateSource(pageId, user);
    await this.pageAccessService.assertCanWritePage(template, user);
    await this.policy.assertAction(
      template.workspaceId,
      template.spaceId,
      user.id,
      'manage_template',
    );
    return template;
  }

  private async requireManagedSyncedTemplate(
    pageId: string,
    user: User,
  ): Promise<Page> {
    const template = await this.requireManagedTemplate(pageId, user);
    if (template.templateKind !== 'synced') {
      throw new BadRequestException({
        code: 'page_template_synced_required',
        message: 'This action requires a synchronized template',
      });
    }
    return template;
  }

  private serializeRevision(revision: any, includeContent = false) {
    return {
      id: revision.id,
      templatePageId: revision.templatePageId,
      revision: revision.revision,
      contentHash: revision.contentHash,
      publishedById: revision.publishedById,
      createdAt: new Date(revision.createdAt).toISOString(),
      ...(includeContent ? { content: revision.content } : {}),
    };
  }

  private normalizeDraftForPublication(content: unknown): unknown {
    const seed = this.hashRequest(content);
    let index = 0;
    return normalizeTemplateDraft(content, () => {
      const hex = createHash('sha256')
        .update(`${seed}:${index++}`)
        .digest('hex')
        .slice(0, 32);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });
  }

  private serializeSyncRun(run: any) {
    return {
      id: run.id,
      templatePageId: run.templatePageId,
      revision: run.revision,
      status: run.status,
      totalCount: Number(run.totalCount),
      processedCount: Number(run.processedCount),
      succeededCount: Number(run.succeededCount),
      failedCount: Number(run.failedCount),
      errorCode: run.errorCode,
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      completedAt: run.completedAt
        ? new Date(run.completedAt).toISOString()
        : null,
      createdAt: new Date(run.createdAt).toISOString(),
    };
  }

  private async migrateLegacyPageEmbeds(): Promise<void> {
    const candidates = await this.findLegacyPageEmbedCandidates();
    if (candidates.length === 0) return;

    let migrated = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        if (
          await this.migrateLegacyPageEmbedsForPage(candidate.referencePageId)
        ) {
          migrated += 1;
        }
      } catch (error) {
        failed += 1;
        await this.recordLegacyMigrationFailure(
          candidate.referencePageId,
          error,
        ).catch((journalError) => {
          this.logger.error(
            `Legacy page embed failure journal write failed; pageId=${candidate.referencePageId}; code=${this.errorCode(journalError)}`,
          );
        });
        this.logger.error(
          `Legacy page embed migration failed; pageId=${candidate.referencePageId}; code=${this.errorCode(error)}`,
        );
      }
    }

    const remainingCount = (await this.findLegacyPageEmbedCandidates()).length;
    if (remainingCount > 0 || failed > 0) {
      this.logger.error(
        `Legacy page embed migration incomplete; migrated=${migrated}; failed=${failed}; remaining=${remainingCount}`,
      );
      throw new Error('legacy_page_embed_migration_incomplete');
    }
    this.logger.log(`Legacy page embed migration completed; pages=${migrated}`);
  }

  private async findLegacyPageEmbedCandidates(): Promise<
    Array<{ referencePageId: string }>
  > {
    const result = await sql<{ referencePageId: string }>`
      select distinct reference_page_id as "referencePageId"
      from page_transclusion_references
      where reference_kind = 'page'
      union
      select id as "referencePageId"
      from pages
      where deleted_at is null
        and content::text like '%"type": "pageEmbed"%'
    `.execute(this.db);
    return result.rows;
  }

  private async recordLegacyMigrationFailure(
    pageId: string,
    error: unknown,
  ): Promise<void> {
    const page = await this.pageRepo.findById(pageId);
    if (!page) return;
    await this.db
      .insertInto('pageTemplateLegacyMigrationErrors')
      .values({
        workspaceId: page.workspaceId,
        consumerPageId: page.id,
        sourcePageId: null,
        referenceNodeId: `migration:${page.id}`,
        errorCode: this.errorCode(error),
      })
      .onConflict((conflict) =>
        conflict.columns(['consumerPageId', 'referenceNodeId']).doUpdateSet({
          errorCode: this.errorCode(error),
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  private async migrateLegacyPageEmbedsForPage(
    pageId: string,
  ): Promise<boolean> {
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt) {
      await this.deleteLegacyPageReferences(pageId);
      return false;
    }
    const actor = await this.findLegacyMigrationActor(page);
    if (!actor) {
      throw this.conflict(
        'page_embed_migration_actor_unavailable',
        'No workspace user is available for the migration',
      );
    }
    const current = await this.getLiveContent(page.id, actor).catch(
      () => page.content,
    );
    if (!this.containsNodeType(current, 'pageEmbed')) {
      await this.deleteLegacyPageReferences(page.id);
      return false;
    }

    const baseContentHash = hashProseMirrorJson(current as any);
    const operation = await this.beginOperation(
      'legacy_embed_migration',
      `legacy-page-embeds:${page.id}:${baseContentHash}`,
      actor,
      { pageId: page.id, baseContentHash },
      { consumerPageId: page.id, baseContentHash },
    );
    if (operation.status === 'completed') {
      await this.deleteLegacyPageReferences(page.id);
      return false;
    }

    const resolved = await this.resolveLegacyPageEmbeds(
      current,
      page,
      actor,
      new Set([page.id]),
      [],
    );
    strictJsonToNode(resolved.content as any);
    const mappings = resolved.attachmentPlans.flatMap((plan) => plan.copies);
    await this.db
      .updateTable('pageTemplateOperations')
      .set({
        attachmentMapping: mappings as any,
        leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where('id', '=', operation.id)
      .where('status', '=', 'pending')
      .where('leaseToken', '=', operation.leaseToken)
      .executeTakeFirstOrThrow();

    const copiedPaths: string[] = [];
    const insertedAttachmentIds: string[] = [];
    try {
      for (const plan of resolved.attachmentPlans) {
        const rows = await this.copyAttachments(
          plan.copies,
          plan.source,
          page.id,
          page.spaceId,
          actor,
          copiedPaths,
          false,
        );
        for (const row of rows) {
          await this.attachmentRepo.insertAttachment(row);
          insertedAttachmentIds.push(row.id);
        }
      }
      await this.assertOperationLease(operation.id, operation.leaseToken);
      const result = await this.applyMutation(
        page.id,
        current,
        resolved.content,
        baseContentHash,
        operation.id,
        operation.leaseToken,
        actor,
        -1,
      );
      await this.completeOperation(
        operation.id,
        {
          afterContentHash: result.afterHash,
          attachmentMapping: mappings as any,
        },
        operation.leaseToken,
      );
      await this.recordLegacyMigrationIssues(page, resolved.issues);
      await this.pageHistoryRecorder.enqueuePageEvent({
        pageId: page.id,
        changeType: 'page.template.legacy-embeds-materialized',
        changeData: {
          migratedEmbedCount: resolved.migratedEmbedCount,
          unavailableEmbedCount: resolved.issues.length,
        },
        actorId: actor.id,
      });
      return true;
    } catch (error) {
      if (await this.ownsOperationLease(operation.id, operation.leaseToken)) {
        await this.failOperation(
          operation.id,
          this.errorCode(error),
          operation.leaseToken,
        );
        await Promise.allSettled(
          insertedAttachmentIds.map((id) =>
            this.attachmentRepo.deleteAttachmentById(id),
          ),
        );
        await Promise.allSettled(
          copiedPaths.map((path) => this.storageService.delete(path)),
        );
      }
      throw error;
    }
  }

  private async resolveLegacyPageEmbeds(
    input: unknown,
    target: Page,
    actor: User,
    ancestors: Set<string>,
    path: number[],
  ): Promise<{
    content: unknown;
    attachmentPlans: LegacyAttachmentCopyPlan[];
    issues: LegacyMigrationIssue[];
    migratedEmbedCount: number;
  }> {
    const maxDepth = this.pageEmbedService.getMaxDepth();
    const attachmentPlans: LegacyAttachmentCopyPlan[] = [];
    const issues: LegacyMigrationIssue[] = [];
    let migratedEmbedCount = 0;

    const visitNodes = async (nodes: any[], parentPath: number[]) => {
      const output: any[] = [];
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const nodePath = [...parentPath, index];
        if (node?.type !== 'pageEmbed') {
          const next = structuredClone(node);
          if (Array.isArray(next?.content)) {
            next.content = await visitNodes(next.content, nodePath);
          }
          output.push(next);
          continue;
        }

        migratedEmbedCount += 1;
        const rawSourcePageId = node.attrs?.sourcePageId;
        const sourcePageId =
          typeof rawSourcePageId === 'string' && isUuid(rawSourcePageId)
            ? rawSourcePageId
            : null;
        const referenceNodeId =
          typeof node.attrs?.id === 'string' && node.attrs.id.length > 0
            ? node.attrs.id
            : `legacy:${nodePath.join('.')}`;
        const depthExceeded = ancestors.size > maxDepth;
        const source =
          sourcePageId && !depthExceeded
            ? await this.pageRepo.findById(sourcePageId, {
                includeContent: true,
              })
            : null;
        const unavailableCode = !sourcePageId
          ? 'page_embed_invalid_source_page_id'
          : depthExceeded
            ? 'page_embed_depth_exceeded'
            : !source || source.deletedAt
              ? 'page_embed_source_unavailable'
              : source.workspaceId !== target.workspaceId ||
                  source.spaceId !== target.spaceId
                ? 'page_embed_source_scope_mismatch'
                : ancestors.has(source.id)
                  ? 'page_embed_cycle'
                  : null;
        if (unavailableCode) {
          issues.push({
            referenceNodeId,
            sourcePageId,
            errorCode: unavailableCode,
          });
          output.push(this.legacyUnavailableCallout());
          continue;
        }

        const sourceAccess = await this.pageAccessService
          .getEffectiveAccess(source!, actor)
          .catch(() => null);
        if (!sourceAccess?.capabilities.canRead) {
          issues.push({
            referenceNodeId,
            sourcePageId,
            errorCode: 'page_embed_source_no_access',
          });
          output.push(this.legacyUnavailableCallout());
          continue;
        }

        const audienceCompatible = await this.canMaterializeLegacySource(
          target,
          source!,
        );
        if (!audienceCompatible) {
          issues.push({
            referenceNodeId,
            sourcePageId,
            errorCode: 'page_embed_source_audience_mismatch',
          });
          output.push(this.legacyUnavailableCallout());
          continue;
        }

        const sourceContent = await this.getLiveContent(
          source!.id,
          actor,
        ).catch(() => source!.content);
        const materialized = materializePageContent(sourceContent, {
          sourcePageId: source!.id,
          targetPageId: target.id,
        });
        const rewritten = rewriteAttachmentsForUnsync(materialized, () =>
          uuid7(),
        );
        if (rewritten.copies.length > 0) {
          attachmentPlans.push({ source: source!, copies: rewritten.copies });
        }
        const nested = await this.resolveLegacyPageEmbeds(
          rewritten.content,
          target,
          actor,
          new Set([...ancestors, source!.id]),
          nodePath,
        );
        attachmentPlans.push(...nested.attachmentPlans);
        issues.push(...nested.issues);
        migratedEmbedCount += nested.migratedEmbedCount;
        const nestedDocument = nested.content as any;
        output.push(
          ...(Array.isArray(nestedDocument?.content)
            ? nestedDocument.content
            : [this.legacyUnavailableCallout()]),
        );
      }
      return output;
    };

    const document =
      input && typeof input === 'object'
        ? structuredClone(input as any)
        : { type: 'doc', content: [] };
    document.type = 'doc';
    document.content = await visitNodes(
      Array.isArray(document.content) ? document.content : [],
      path,
    );
    if (document.content.length === 0)
      document.content = [{ type: 'paragraph' }];
    return { content: document, attachmentPlans, issues, migratedEmbedCount };
  }

  private async canMaterializeLegacySource(
    target: Page,
    source: Page,
  ): Promise<boolean> {
    const publicAccess = await sql<{ isShared: boolean }>`
      with recursive page_ancestors as (
        select id, parent_page_id, workspace_id, space_id, 0 as level
        from pages
        where id = ${target.id}::uuid
          and deleted_at is null
        union all
        select p.id, p.parent_page_id, p.workspace_id, p.space_id, a.level + 1
        from pages p
        inner join page_ancestors a on a.parent_page_id = p.id
        where p.deleted_at is null
          and a.level < ${MAX_PAGE_TREE_DEPTH}
      )
      select exists (
        select 1
        from page_ancestors a
        inner join shares s on s.page_id = a.id
        where s.workspace_id = ${target.workspaceId}::uuid
          and s.space_id = ${target.spaceId}::uuid
          and a.workspace_id = s.workspace_id
          and a.space_id = s.space_id
          and (a.level = 0 or s.include_sub_pages = true)
      ) as "isShared"
    `.execute(this.db);
    if (publicAccess.rows[0]?.isShared) return false;

    const users = await this.db
      .selectFrom('users')
      .select('id')
      .where('workspaceId', '=', target.workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .execute();
    const candidateIds = users.map((candidate) => candidate.id);
    const [targetReaders, sourceReaders] = await Promise.all([
      this.pageAccessService.filterUsersWithPageReadAccess(
        target.id,
        candidateIds,
      ),
      this.pageAccessService.filterUsersWithPageReadAccess(
        source.id,
        candidateIds,
      ),
    ]);
    const sourceReaderIds = new Set(sourceReaders);
    return targetReaders.every((readerId) => sourceReaderIds.has(readerId));
  }

  private legacyUnavailableCallout() {
    return {
      type: 'callout',
      attrs: { type: 'info', icon: null },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Embedded page content was unavailable during migration.',
            },
          ],
        },
      ],
    };
  }

  private async findLegacyMigrationActor(page: Page): Promise<User | null> {
    const creator = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', page.creatorId)
      .where('workspaceId', '=', page.workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();
    if (creator) return creator;
    return (
      (await this.db
        .selectFrom('users')
        .selectAll()
        .where('workspaceId', '=', page.workspaceId)
        .where('deletedAt', 'is', null)
        .where('deactivatedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .executeTakeFirst()) ?? null
    );
  }

  private async recordLegacyMigrationIssues(
    page: Page,
    issues: LegacyMigrationIssue[],
  ): Promise<void> {
    if (issues.length === 0) return;
    await this.db
      .insertInto('pageTemplateLegacyMigrationErrors')
      .values(
        issues.map((issue) => ({
          workspaceId: page.workspaceId,
          consumerPageId: page.id,
          sourcePageId: issue.sourcePageId,
          referenceNodeId: issue.referenceNodeId,
          errorCode: issue.errorCode,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['consumerPageId', 'referenceNodeId']).doUpdateSet({
          sourcePageId: sql`excluded.source_page_id`,
          errorCode: sql`excluded.error_code`,
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  private async deleteLegacyPageReferences(pageId: string): Promise<void> {
    await this.db
      .deleteFrom('pageTransclusionReferences')
      .where('referencePageId', '=', pageId)
      .where('referenceKind', '=', 'page')
      .execute();
  }

  private containsNodeType(input: unknown, type: string): boolean {
    if (!input || typeof input !== 'object') return false;
    const node = input as any;
    if (node.type === type) return true;
    return Array.isArray(node.content)
      ? node.content.some((child: unknown) =>
          this.containsNodeType(child, type),
        )
      : false;
  }

  private async resumePendingSyncRuns(): Promise<void> {
    const runs = await this.db
      .selectFrom('pageTemplateSyncRuns')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([
            eb('status', '=', 'running'),
            eb.or([
              eb('leaseExpiresAt', 'is', null),
              eb('leaseExpiresAt', '<=', new Date()),
            ]),
          ]),
        ]),
      )
      .orderBy('createdAt', 'asc')
      .limit(10)
      .execute();
    for (const run of runs) void this.processSyncRun(run.id);
  }

  private async processSyncRun(runId: string): Promise<void> {
    if (this.activeSyncRuns.has(runId)) return;
    this.activeSyncRuns.add(runId);
    const leaseToken = uuid7();
    try {
      const claimed = await this.db
        .updateTable('pageTemplateSyncRuns')
        .set({
          status: 'running',
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', runId)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([
              eb('status', '=', 'running'),
              eb.or([
                eb('leaseExpiresAt', 'is', null),
                eb('leaseExpiresAt', '<=', new Date()),
              ]),
            ]),
          ]),
        )
        .returningAll()
        .executeTakeFirst();
      if (!claimed) return;
      await this.db
        .updateTable('pageTemplateSyncItems')
        .set({ status: 'pending', updatedAt: new Date() })
        .where('runId', '=', runId)
        .where('status', '=', 'running')
        .execute();
      const [revision, requestedActor] = await Promise.all([
        this.db
          .selectFrom('pageTemplateRevisions')
          .selectAll()
          .where('id', '=', claimed.revisionId)
          .executeTakeFirst(),
        claimed.requestedById
          ? this.db
              .selectFrom('users')
              .selectAll()
              .where('id', '=', claimed.requestedById)
              .where('workspaceId', '=', claimed.workspaceId)
              .executeTakeFirst()
          : null,
      ]);
      let actor = requestedActor;
      if (!actor && revision) {
        const template = await this.pageRepo.findById(claimed.templatePageId);
        if (template) actor = await this.findLegacyMigrationActor(template);
      }
      if (!revision || !actor) {
        await this.finishSyncRun(
          runId,
          leaseToken,
          'failed',
          'page_template_sync_actor_missing',
        );
        return;
      }
      const items = await this.db
        .selectFrom('pageTemplateSyncItems')
        .selectAll()
        .where('runId', '=', runId)
        .where('status', '=', 'pending')
        .orderBy('createdAt', 'asc')
        .execute();
      for (const item of items) {
        const renewed = await this.db
          .updateTable('pageTemplateSyncRuns')
          .set({
            leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
            updatedAt: new Date(),
          })
          .where('id', '=', runId)
          .where('leaseToken', '=', leaseToken)
          .returning('id')
          .executeTakeFirst();
        if (!renewed) return;
        await this.processSyncItem(claimed, revision, item, actor as User);
      }
      await this.recalculateSyncRun(runId, leaseToken);
    } catch (error) {
      this.logger.error(
        `Template synchronization run failed; runId=${runId}; code=${this.errorCode(error)}`,
      );
      await this.finishSyncRun(
        runId,
        leaseToken,
        'failed',
        this.errorCode(error),
      );
    } finally {
      this.activeSyncRuns.delete(runId);
    }
  }

  private async processSyncItem(
    run: any,
    revision: any,
    item: any,
    actor: User,
  ): Promise<void> {
    await this.db
      .updateTable('pageTemplateSyncItems')
      .set({
        status: 'running',
        attemptCount: (item.attemptCount ?? 0) + 1,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where('id', '=', item.id)
      .execute();
    const instance = await this.db
      .selectFrom('pageTemplateInstances')
      .selectAll()
      .where('id', '=', item.instanceId)
      .executeTakeFirst();
    if (
      !instance ||
      instance.status === 'detached' ||
      instance.templatePageId !== run.templatePageId
    ) {
      await this.markSyncItemCompleted(item.id);
      return;
    }
    if ((instance.appliedRevision ?? 0) >= run.revision) {
      await this.markSyncItemCompleted(item.id);
      return;
    }
    const page = await this.pageRepo.findById(item.childPageId);
    if (!page || page.deletedAt) {
      await this.markSyncItemFailed(
        item.id,
        instance.id,
        'page_template_child_missing',
      );
      return;
    }
    const publishedForInstance = await this.prepareInstanceRevisionContent(
      instance,
      page,
      revision.content,
      actor,
    );
    await this.db
      .updateTable('pageTemplateInstances')
      .set({ status: 'syncing', lastErrorCode: null, updatedAt: new Date() })
      .where('id', '=', instance.id)
      .where('status', '!=', 'detached')
      .execute();
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const current = await this.getLiveContent(page.id, actor);
        const next = createTemplateInstanceContent(
          publishedForInstance,
          current,
        );
        const baseHash = hashProseMirrorJson(current as any);
        const nextHash = hashProseMirrorJson(next as any);
        if (baseHash === nextHash) {
          await this.db
            .updateTable('pageTemplateInstances')
            .set({
              appliedRevision: run.revision,
              status: 'active',
              lastErrorCode: null,
              updatedAt: new Date(),
            })
            .where('id', '=', instance.id)
            .where('status', '!=', 'detached')
            .execute();
          await this.markSyncItemCompleted(item.id);
          await this.pageHistoryRecorder.enqueuePageEvent({
            pageId: page.id,
            changeType: 'page.template.synced',
            changeData: {
              templateId: run.templatePageId,
              templateRevision: run.revision,
            },
            actorId: actor.id,
          });
          return;
        }
        const operation = await this.beginOperation(
          'template_sync',
          `template-sync:${run.id}:${instance.id}:${attempt}`,
          actor,
          {
            runId: run.id,
            instanceId: instance.id,
            revision: run.revision,
            attempt,
          },
          {
            sourcePageId: run.templatePageId,
            consumerPageId: page.id,
            baseContentHash: baseHash,
          },
        );
        await this.applyMutation(
          page.id,
          current,
          next,
          baseHash,
          operation.id,
          operation.leaseToken,
          actor,
          run.revision,
        );
        await this.db
          .updateTable('pageTemplateInstances')
          .set({
            appliedRevision: run.revision,
            status: 'active',
            lastErrorCode: null,
            updatedAt: new Date(),
          })
          .where('id', '=', instance.id)
          .where('status', '!=', 'detached')
          .execute();
        await this.markSyncItemCompleted(item.id);
        await this.pageHistoryRecorder.enqueuePageEvent({
          pageId: page.id,
          changeType: 'page.template.synced',
          changeData: {
            templateId: run.templatePageId,
            templateRevision: run.revision,
          },
          actorId: actor.id,
        });
        return;
      } catch (error) {
        lastError = error;
        if (this.errorCode(error) !== 'page_embed_stale') break;
      }
    }
    await this.markSyncItemFailed(
      item.id,
      instance.id,
      this.errorCode(lastError),
    );
  }

  private async markSyncItemCompleted(itemId: string): Promise<void> {
    await this.db
      .updateTable('pageTemplateSyncItems')
      .set({ status: 'completed', errorCode: null, updatedAt: new Date() })
      .where('id', '=', itemId)
      .execute();
  }

  private async prepareInstanceRevisionContent(
    instance: any,
    childPage: Page,
    publishedContent: unknown,
    actor: User,
  ): Promise<unknown> {
    const mappings = await this.db
      .selectFrom('pageTemplateAttachmentMappings')
      .select(['sourceAttachmentId', 'childAttachmentId'])
      .where('instanceId', '=', instance.id)
      .execute();
    const mappedIds = new Map(
      mappings.map((mapping) => [
        mapping.sourceAttachmentId,
        mapping.childAttachmentId,
      ]),
    );
    const rewritten = rewriteAttachmentsForUnsync(
      publishedContent,
      (sourceAttachmentId) =>
        mappedIds.get(sourceAttachmentId ?? '') ?? uuid7(),
    );
    const newCopies = rewritten.copies.filter(
      (copy) => !mappedIds.has(copy.oldAttachmentId),
    );
    if (newCopies.length === 0) return rewritten.content;
    const source = instance.templatePageId
      ? await this.pageRepo.findById(instance.templatePageId)
      : null;
    if (!source || source.deletedAt) {
      throw this.conflict(
        'page_template_source_missing',
        'The template source is unavailable',
      );
    }
    const copiedPaths: string[] = [];
    try {
      const attachmentRows = await this.copyAttachments(
        newCopies,
        source,
        childPage.id,
        childPage.spaceId,
        actor,
        copiedPaths,
        false,
      );
      await executeTx(this.db, async (trx) => {
        for (const row of attachmentRows) {
          await this.attachmentRepo.insertAttachment(row, trx);
        }
        await trx
          .insertInto('pageTemplateAttachmentMappings')
          .values(
            newCopies.map((copy) => ({
              instanceId: instance.id,
              sourceAttachmentId: copy.oldAttachmentId,
              childAttachmentId: copy.newAttachmentId,
            })),
          )
          .onConflict((conflict) =>
            conflict.columns(['instanceId', 'sourceAttachmentId']).doNothing(),
          )
          .execute();
      });
      return rewritten.content;
    } catch (error) {
      await Promise.allSettled(
        copiedPaths.map((path) => this.storageService.delete(path)),
      );
      throw error;
    }
  }

  private async markSyncItemFailed(
    itemId: string,
    instanceId: string,
    errorCode: string,
  ): Promise<void> {
    await executeTx(this.db, async (trx) => {
      await trx
        .updateTable('pageTemplateSyncItems')
        .set({ status: 'failed', errorCode, updatedAt: new Date() })
        .where('id', '=', itemId)
        .execute();
      await trx
        .updateTable('pageTemplateInstances')
        .set({
          status: 'error',
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        })
        .where('id', '=', instanceId)
        .where('status', '!=', 'detached')
        .execute();
    });
  }

  private async recalculateSyncRun(
    runId: string,
    leaseToken: string,
  ): Promise<void> {
    const rows = await this.db
      .selectFrom('pageTemplateSyncItems')
      .select('status')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('runId', '=', runId)
      .groupBy('status')
      .execute();
    const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
    const succeeded = counts.get('completed') ?? 0;
    const failed = counts.get('failed') ?? 0;
    const processed = succeeded + failed;
    const status =
      failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed';
    await this.db
      .updateTable('pageTemplateSyncRuns')
      .set({
        status,
        processedCount: processed,
        succeededCount: succeeded,
        failedCount: failed,
        errorCode: failed > 0 ? 'page_template_sync_partial_failure' : null,
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', runId)
      .where('leaseToken', '=', leaseToken)
      .execute();
  }

  private async finishSyncRun(
    runId: string,
    leaseToken: string,
    status: 'failed',
    errorCode: string,
  ): Promise<void> {
    await this.db
      .updateTable('pageTemplateSyncRuns')
      .set({
        status,
        errorCode,
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', runId)
      .where('leaseToken', '=', leaseToken)
      .execute();
  }

  private async getLiveContent(pageId: string, user: User): Promise<any> {
    return this.collaborationGateway.handleYjsEvent(
      'getAiPageContent',
      `page.${pageId}`,
      { user },
    ) as Promise<any>;
  }

  private async applyMutation(
    pageId: string,
    originalContent: unknown,
    nextContent: unknown,
    baseContentHash: string,
    mutationId: string,
    operationLeaseToken: string,
    user: User,
    systemSyncRevision?: number,
  ): Promise<{ beforeHash: string; afterHash: string }> {
    return this.collaborationGateway.handleYjsEvent(
      'applyPageTemplateMutation',
      `page.${pageId}`,
      {
        originalContent,
        nextContent,
        baseContentHash,
        mutationId,
        operationLeaseToken,
        workspaceId: user.workspaceId,
        systemSyncRevision,
        user,
      },
    ) as Promise<{ beforeHash: string; afterHash: string }>;
  }

  private async requireTemplateSource(
    pageId: string,
    user: User,
  ): Promise<Page> {
    const page = await this.requirePlainDocument(pageId, user.workspaceId);
    await this.pageAccessService.assertCanReadPage(page, user);
    if (!page.templateKind) {
      throw new BadRequestException({
        code: 'page_template_marker_required',
        message: 'The source page is not a template',
      });
    }
    return page;
  }

  private async requirePlainDocument(
    pageId: string,
    workspaceId: string,
  ): Promise<Page> {
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    const [database, row] = await Promise.all([
      this.databaseRepo.findByPageId(page.id, workspaceId),
      this.databaseRowRepo.findActiveByPageId(page.id, workspaceId),
    ]);
    if (database || row) {
      throw new BadRequestException({
        code: 'page_template_document_only',
        message: 'Page templates support document pages only',
      });
    }
    return page;
  }

  private async findReadablePlainDocument(
    pageId: string,
    user: User,
  ): Promise<Page | null> {
    let page: Page;
    try {
      page = await this.requirePlainDocument(pageId, user.workspaceId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        return null;
      }
      throw error;
    }
    const access = await this.pageAccessService.getEffectiveAccess(page, user);
    return access.capabilities.canRead ? page : null;
  }

  private async assertCanCreate(
    spaceId: string,
    parentPageId: string | undefined,
    user: User,
  ): Promise<void> {
    if (parentPageId) {
      const parent = await this.requirePlainDocument(
        parentPageId,
        user.workspaceId,
      );
      if (parent.spaceId !== spaceId)
        throw new NotFoundException('Parent page not found');
      await this.pageAccessService.assertCanCreateChild(parent, user);
      return;
    }
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  private findPageEmbed(content: unknown, referenceNodeId: string) {
    const doc = strictJsonToNode(content as any);
    let result:
      | { position: number; nodeSize: number; sourcePageId: string }
      | undefined;
    doc.descendants((node, position) => {
      if (node.type.name !== 'pageEmbed' || node.attrs.id !== referenceNodeId) {
        return true;
      }
      result = {
        position,
        nodeSize: node.nodeSize,
        sourcePageId: node.attrs.sourcePageId,
      };
      return false;
    });
    return result;
  }

  private collectPageSources(content: unknown): string[] {
    const sources: string[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'pageEmbed' &&
        typeof node.attrs?.sourcePageId === 'string'
      ) {
        sources.push(node.attrs.sourcePageId);
      }
      if (Array.isArray(node.content)) node.content.forEach(visit);
    };
    visit(content);
    return sources;
  }

  private async copyAttachments(
    copies: Array<{ oldAttachmentId: string; newAttachmentId: string }>,
    source: Page,
    targetPageId: string,
    targetSpaceId: string,
    user: User,
    copiedPaths: string[],
    insertRows: boolean,
  ): Promise<any[]> {
    if (copies.length === 0) return [];
    const originals = await this.attachmentRepo.findByIds(
      copies.map((copy) => copy.oldAttachmentId),
    );
    const byId = new Map(
      originals
        .filter((attachment) => attachment.pageId === source.id)
        .map((attachment) => [attachment.id, attachment]),
    );
    const rows: any[] = [];
    for (const copy of copies) {
      const original = byId.get(copy.oldAttachmentId);
      if (!original) {
        throw this.conflict(
          'page_template_attachment_unavailable',
          'A referenced attachment is unavailable',
        );
      }
      const filePath = original.filePath
        .split(copy.oldAttachmentId)
        .join(copy.newAttachmentId);
      await this.storageService.copy(original.filePath, filePath);
      copiedPaths.push(filePath);
      const row = {
        id: copy.newAttachmentId,
        type: original.type,
        filePath,
        fileName: original.fileName,
        fileSize: original.fileSize,
        mimeType: original.mimeType,
        fileExt: original.fileExt,
        creatorId: user.id,
        workspaceId: user.workspaceId,
        pageId: targetPageId,
        spaceId: targetSpaceId,
        textContent: original.textContent,
      };
      rows.push(row);
      if (insertRows) await this.attachmentRepo.insertAttachment(row);
    }
    return rows;
  }

  private async beginOperation(
    kind: OperationKind,
    idempotencyKey: string,
    user: User,
    request: unknown,
    fields: Record<string, unknown>,
  ): Promise<any> {
    await this.reconcileExpiredOperations(user.workspaceId);
    const requestHash = this.hashRequest(request);
    const leaseExpiresAt = new Date(Date.now() + OPERATION_LEASE_MS);
    const leaseToken = uuid7();
    let inserted: any;
    try {
      inserted = await this.db
        .insertInto('pageTemplateOperations')
        .values({
          workspaceId: user.workspaceId,
          requestedById: user.id,
          operationKind: kind,
          idempotencyKey,
          requestHash,
          status: 'pending',
          leaseToken,
          leaseExpiresAt,
          ...(fields as any),
        })
        .onConflict((conflict) =>
          conflict
            .columns([
              'workspaceId',
              'requestedById',
              'operationKind',
              'idempotencyKey',
            ])
            .doNothing(),
        )
        .returningAll()
        .executeTakeFirst();
    } catch (error) {
      if (kind === 'embed_detach' && (error as any)?.code === '23505') {
        const active = await this.db
          .selectFrom('pageTemplateOperations')
          .selectAll()
          .where('workspaceId', '=', user.workspaceId)
          .where('operationKind', '=', 'embed_detach')
          .where('consumerPageId', '=', fields.consumerPageId as string)
          .where('referenceNodeId', '=', fields.referenceNodeId as string)
          .where('status', '=', 'pending')
          .executeTakeFirst();
        if (active) {
          const settled = await this.waitForOperationToSettle(active.id);
          if (settled?.status === 'completed') return settled;
          throw this.conflict(
            'page_template_operation_in_progress',
            'Another detach operation is still running',
          );
        }
      }
      throw error;
    }
    if (inserted) return inserted;
    const existing = await this.findOperation(kind, idempotencyKey, user);
    if (!existing || existing.requestHash !== requestHash) {
      throw this.conflict(
        'page_template_idempotency_conflict',
        'Idempotency key was used for a different request',
      );
    }
    if (existing.status === 'failed') {
      try {
        const claimed = await this.db
          .updateTable('pageTemplateOperations')
          .set({
            status: 'pending',
            errorCode: null,
            leaseToken,
            leaseExpiresAt,
            attemptCount: existing.attemptCount + 1,
            updatedAt: new Date(),
          })
          .where('id', '=', existing.id)
          .where('status', '=', 'failed')
          .returningAll()
          .executeTakeFirst();
        if (claimed) return claimed;
      } catch (error) {
        if (kind === 'embed_detach' && (error as any)?.code === '23505') {
          const active = await this.findActiveDetachOperation(
            user.workspaceId,
            fields,
          );
          if (active) {
            const settled = await this.waitForOperationToSettle(active.id);
            if (settled?.status === 'completed') return settled;
            throw this.conflict(
              'page_template_operation_in_progress',
              'Another detach operation is still running',
            );
          }
        }
        throw error;
      }
    }
    if (existing.status === 'pending') {
      if (
        existing.leaseToken &&
        (await this.recoverOperationResult(existing, existing.leaseToken))
      ) {
        return this.findOperation(kind, idempotencyKey, user);
      }
      const claimed = await this.db
        .updateTable('pageTemplateOperations')
        .set({
          leaseToken,
          leaseExpiresAt,
          attemptCount: existing.attemptCount + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', existing.id)
        .where('status', '=', 'pending')
        .where((eb) =>
          eb.or([
            eb('leaseExpiresAt', 'is', null),
            eb('leaseExpiresAt', '<=', new Date()),
          ]),
        )
        .returningAll()
        .executeTakeFirst();
      if (claimed) return claimed;
      throw this.conflict(
        'page_template_operation_in_progress',
        'An operation with this idempotency key is already running',
      );
    }
    return existing;
  }

  private findOperation(kind: OperationKind, key: string, user: User) {
    return this.db
      .selectFrom('pageTemplateOperations')
      .selectAll()
      .where('workspaceId', '=', user.workspaceId)
      .where('requestedById', '=', user.id)
      .where('operationKind', '=', kind)
      .where('idempotencyKey', '=', key)
      .executeTakeFirst();
  }

  private async findCompletedOperation(
    kind: OperationKind,
    key: string,
    user: User,
    request: unknown,
  ): Promise<any | undefined> {
    const operation = await this.findOperation(kind, key, user);
    if (!operation) return undefined;
    if (operation.requestHash !== this.hashRequest(request)) {
      throw this.conflict(
        'page_template_idempotency_conflict',
        'Idempotency key was used for a different request',
      );
    }
    return operation.status === 'completed' ? operation : undefined;
  }

  private findCompletedDetach(
    consumerPageId: string,
    referenceNodeId: string,
    user: User,
  ) {
    return this.db
      .selectFrom('pageTemplateOperations')
      .selectAll()
      .where('workspaceId', '=', user.workspaceId)
      .where('operationKind', '=', 'embed_detach')
      .where('consumerPageId', '=', consumerPageId)
      .where('referenceNodeId', '=', referenceNodeId)
      .where('status', '=', 'completed')
      .orderBy('updatedAt', 'desc')
      .executeTakeFirst();
  }

  private findActiveDetachOperation(
    workspaceId: string,
    fields: Record<string, unknown>,
  ) {
    return this.db
      .selectFrom('pageTemplateOperations')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('operationKind', '=', 'embed_detach')
      .where('consumerPageId', '=', fields.consumerPageId as string)
      .where('referenceNodeId', '=', fields.referenceNodeId as string)
      .where('status', '=', 'pending')
      .executeTakeFirst();
  }

  private async waitForOperationToSettle(
    operationId: string,
  ): Promise<any | undefined> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const operation = await this.db
        .selectFrom('pageTemplateOperations')
        .selectAll()
        .where('id', '=', operationId)
        .executeTakeFirst();
      if (!operation || operation.status !== 'pending') return operation;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  private async completeOperation(
    id: string,
    fields: Record<string, unknown>,
    leaseToken?: string | null,
  ): Promise<boolean> {
    let query = this.db
      .updateTable('pageTemplateOperations')
      .set({
        status: 'completed',
        errorCode: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
        ...(fields as any),
      })
      .where('id', '=', id)
      .where('status', 'in', ['pending', 'failed']);
    if (leaseToken) query = query.where('leaseToken', '=', leaseToken);
    return Boolean(await query.returning('id').executeTakeFirst());
  }

  private async failOperation(id: string, code: string, leaseToken?: string) {
    await this.db
      .updateTable('pageTemplateOperations')
      .set({
        status: 'failed',
        errorCode: code,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .$if(Boolean(leaseToken), (query) =>
        query.where('leaseToken', '=', leaseToken!),
      )
      .execute();
  }

  private async stageMaterializedContent(
    operationId: string,
    leaseToken: string,
    liveSource: unknown,
    sourcePageId: string,
    targetPageId: string,
    storedMapping: unknown,
  ) {
    const existingMapping = new Map(
      this.readAttachmentMapping(storedMapping).map((item) => [
        item.oldAttachmentId,
        item.newAttachmentId,
      ]),
    );
    const regenerated = materializePageContent(liveSource, {
      sourcePageId,
      targetPageId,
    });
    const rewritten = rewriteAttachmentsForUnsync(
      regenerated,
      (oldAttachmentId) =>
        existingMapping.get(oldAttachmentId ?? '') ?? uuid7(),
    );
    await this.db
      .updateTable('pageTemplateOperations')
      .set({
        stagedContent: rewritten.content as any,
        attachmentMapping: rewritten.copies as any,
        leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where('id', '=', operationId)
      .where('status', '=', 'pending')
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', new Date())
      .executeTakeFirstOrThrow();
    return rewritten;
  }

  private async assertOperationLease(
    operationId: string,
    leaseToken: string,
  ): Promise<void> {
    if (!(await this.ownsOperationLease(operationId, leaseToken))) {
      throw this.conflict(
        'page_template_operation_lease_lost',
        'The page template operation lease was lost',
      );
    }
  }

  private async ownsOperationLease(
    operationId: string,
    leaseToken: string | null | undefined,
  ): Promise<boolean> {
    if (!leaseToken) return false;
    const operation = await this.db
      .selectFrom('pageTemplateOperations')
      .select('id')
      .where('id', '=', operationId)
      .where('status', '=', 'pending')
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', new Date())
      .executeTakeFirst();
    return Boolean(operation);
  }

  private async reconcileExpiredOperations(workspaceId: string): Promise<void> {
    const expired = await this.db
      .selectFrom('pageTemplateOperations')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('status', '=', 'pending')
      .where((eb) =>
        eb.or([
          eb('leaseExpiresAt', 'is', null),
          eb('leaseExpiresAt', '<=', new Date()),
        ]),
      )
      .orderBy('updatedAt', 'asc')
      .limit(10)
      .execute();
    for (const operation of expired) {
      const cleanupToken = uuid7();
      const claimed = await this.db
        .updateTable('pageTemplateOperations')
        .set({
          leaseToken: cleanupToken,
          leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
          updatedAt: new Date(),
        })
        .where('id', '=', operation.id)
        .where('status', '=', 'pending')
        .where((eb) =>
          eb.or([
            eb('leaseExpiresAt', 'is', null),
            eb('leaseExpiresAt', '<=', new Date()),
          ]),
        )
        .returningAll()
        .executeTakeFirst();
      if (!claimed) continue;
      try {
        if (await this.recoverOperationResult(claimed, cleanupToken)) continue;
        await this.cleanupAbandonedOperation(claimed);
        await this.failOperation(
          claimed.id,
          'page_template_operation_abandoned',
          cleanupToken,
        );
      } catch {
        await this.failOperation(
          claimed.id,
          'page_template_operation_recovery_failed',
          cleanupToken,
        );
      }
    }
  }

  private async recoverOperationResult(
    operation: any,
    leaseToken: string,
  ): Promise<boolean> {
    const pageId =
      operation.operationKind === 'snapshot'
        ? operation.resultPageId
        : operation.consumerPageId;
    if (!pageId) return false;
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt) return false;
    if (operation.operationKind === 'snapshot') {
      return this.completeOperation(
        operation.id,
        { resultPageId: page.id },
        leaseToken,
      );
    }
    if (operation.operationKind === 'legacy_embed_migration') {
      if (this.containsNodeType(page.content, 'pageEmbed')) return false;
      return this.completeOperation(
        operation.id,
        { afterContentHash: hashProseMirrorJson(page.content as any) },
        leaseToken,
      );
    }
    if (operation.operationKind === 'template_detach') {
      const instance = await this.db
        .selectFrom('pageTemplateInstances')
        .select('status')
        .where('childPageId', '=', page.id)
        .executeTakeFirst();
      if (
        instance?.status !== 'detached' &&
        (this.containsNodeType(page.content, 'templateManagedBlock') ||
          this.containsNodeType(page.content, 'templateField'))
      ) {
        return false;
      }
      return this.completeOperation(
        operation.id,
        { afterContentHash: hashProseMirrorJson(page.content as any) },
        leaseToken,
      );
    }
    if (operation.operationKind === 'template_sync') return false;
    const occurrence = this.findPageEmbed(
      page.content,
      operation.referenceNodeId,
    );
    const completed =
      operation.operationKind === 'embed_insert'
        ? occurrence?.sourcePageId === operation.sourcePageId
        : !occurrence;
    if (!completed) return false;
    return this.completeOperation(
      operation.id,
      { afterContentHash: hashProseMirrorJson(page.content as any) },
      leaseToken,
    );
  }

  private async cleanupAbandonedOperation(operation: any): Promise<void> {
    const mapping = this.readAttachmentMapping(operation.attachmentMapping);
    if (mapping.length === 0) return;
    const targetPageId = operation.resultPageId ?? operation.consumerPageId;
    const targetPage = targetPageId
      ? await this.pageRepo.findById(targetPageId, { includeContent: true })
      : null;
    const referencedIds = new Set(
      targetPage ? getAttachmentIds(targetPage.content) : [],
    );
    const targetIds = mapping.map((item) => item.newAttachmentId);
    const targetRows = await this.attachmentRepo.findByIds(targetIds);
    const targetRowById = new Map(targetRows.map((row) => [row.id, row]));
    const sourceRows = await this.attachmentRepo.findByIds(
      mapping.map((item) => item.oldAttachmentId),
    );
    const sourceRowById = new Map(sourceRows.map((row) => [row.id, row]));
    for (const item of mapping) {
      if (referencedIds.has(item.newAttachmentId)) continue;
      const targetRow = targetRowById.get(item.newAttachmentId);
      const filePath =
        targetRow?.filePath ??
        sourceRowById
          .get(item.oldAttachmentId)
          ?.filePath.split(item.oldAttachmentId)
          .join(item.newAttachmentId);
      if (filePath) {
        await this.storageService.delete(filePath).catch(() => undefined);
      }
      if (targetRow && targetRow.pageId === targetPageId) {
        await this.attachmentRepo.deleteAttachmentById(targetRow.id);
      }
    }
  }

  private readAttachmentMapping(value: unknown): Array<{
    oldAttachmentId: string;
    newAttachmentId: string;
  }> {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is { oldAttachmentId: string; newAttachmentId: string } =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof item.oldAttachmentId === 'string' &&
            typeof item.newAttachmentId === 'string',
        ),
    );
  }

  private assertIdempotencyKey(key: string): void {
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'idempotency_key_required',
        message: 'A valid Idempotency-Key header is required',
      });
    }
  }

  private hashRequest(request: unknown): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(String(offset)).toString('base64url');
  }

  private decodeCursor(cursor?: string): number {
    if (!cursor) return 0;
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException('Invalid cursor');
    }
    return value;
  }

  private errorCode(error: unknown): string {
    const response =
      error && typeof error === 'object' && 'getResponse' in error
        ? (error as any).getResponse()
        : undefined;
    return (
      response?.code ??
      (error as Error)?.message ??
      'page_template_operation_failed'
    );
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private async releaseGraphLease(
    graphLease: PageEmbedGraphLease | undefined,
  ): Promise<void> {
    if (!graphLease) return;
    try {
      await graphLease.release();
    } catch {
      // Ownership is verified inside the transaction immediately before commit.
      // A release failure after commit must not turn a durable success into a retry.
    }
  }
}
