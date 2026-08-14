import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { v7 as uuid7 } from 'uuid';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
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
  CreateFromTemplateDto,
  CreatePageTemplateDto,
  DetachSyncedTemplateDto,
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
} from '../dto/page-template.dto';
import { PageService } from './page.service';
import { executeTx } from '@docmost/db/utils';
import type { PageEmbedGraphLease } from '../transclusion/page-embed-graph-lock.service';
import { PageHistoryRecorderService } from './page-history-recorder.service';
import type { TemplateKind } from '@docmost/api-contract';
import {
  createTemplateInstanceContent,
  detachTemplateContent,
  normalizeTemplateDraft,
} from '@docmost/editor-ext/server';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';

@Injectable()
export class PageTemplateInstanceService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    private readonly policy: PageTemplatePolicyService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly transclusionService: TransclusionService,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    private readonly content: PageTemplateContentService,
    private readonly operations: PageTemplateOperationService,
  ) {}

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
    const offset = this.operations.decodeCursor(dto.cursor);
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
      .where('page.deletedAt', 'is', null);
    query = this.excludeDatabasePages(query)
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
          ? this.operations.encodeCursor(offset + consumed)
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
    await this.content.assertCanCreate(dto.spaceId, undefined, user);
    const source = dto.sourcePageId
      ? await this.content.requirePlainDocument(
          dto.sourcePageId,
          user.workspaceId,
        )
      : null;
    if (source) {
      await this.pageAccessService.assertCanReadPage(source, user);
      if (source.spaceId !== dto.spaceId) {
        throw new NotFoundException('Source page not found');
      }
    }
    const sourceContent = source
      ? await this.content.getLiveContent(source.id, user)
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
        ? await this.content.copyAttachments(
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
      .where('page.templateKind', 'is', null);
    query = this.excludeDatabasePages(query)
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

  private excludeDatabasePages(query: any) {
    return query
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
      );
  }

  async createFromTemplate(
    dto: CreateFromTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.operations.assertIdempotencyKey(idempotencyKey);
    const completedOperation = await this.operations.findCompletedOperation(
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
    const source = await this.content.requireTemplateSource(
      dto.templatePageId,
      user,
    );
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
    await this.content.assertCanCreate(dto.spaceId, dto.parentPageId, user);
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
    const operation = await this.operations.beginOperation(
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
      await this.operations.completeOperation(
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
            copies: this.operations.readAttachmentMapping(
              operation.attachmentMapping,
            ),
          }
        : await this.operations.stageMaterializedContent(
            operation.id,
            operation.leaseToken,
            templateKind === 'synced'
              ? createTemplateInstanceContent(publishedRevision!.content)
              : await this.content.getLiveContent(source.id, user),
            source.id,
            targetPageId,
            operation.attachmentMapping,
          );
      const attachmentRows = await this.content.copyAttachments(
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
      await this.operations.assertOperationLease(
        operation.id,
        operation.leaseToken,
      );
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
      await this.operations.completeOperation(
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
      const ownsLease = await this.operations.ownsOperationLease(
        operation.id,
        operation.leaseToken,
      );
      if (ownsLease) {
        await this.operations.failOperation(
          operation.id,
          this.operations.errorCode(error),
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
      await this.operations.releaseGraphLease(graphLease);
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
    this.operations.assertIdempotencyKey(idempotencyKey);
    const page = await this.content.requirePlainDocument(
      pageId,
      user.workspaceId,
    );
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
    const current = await this.content.getLiveContent(page.id, user);
    const existingOperation = await this.operations.findOperation(
      'template_detach',
      idempotencyKey,
      user,
    );
    if (existingOperation?.status === 'completed') {
      if (
        existingOperation.requestHash !==
        this.operations.hashRequest({ pageId, ...dto })
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
    const operation = await this.operations.beginOperation(
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
    const result = await this.content.applyMutation(
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
  private async requireManagedTemplate(
    pageId: string,
    user: User,
  ): Promise<Page> {
    const template = await this.content.requireTemplateSource(pageId, user);
    await this.pageAccessService.assertCanWritePage(template, user);
    await this.policy.assertAction(
      template.workspaceId,
      template.spaceId,
      user.id,
      'manage_template',
    );
    return template;
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

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
