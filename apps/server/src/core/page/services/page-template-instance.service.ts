import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { v7 as uuid7 } from 'uuid';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { strictJsonToNode } from '../../../collaboration/collaboration.util';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { hashPageTemplateInstanceContent } from '../../../common/helpers/prosemirror/page-template-content-hash';
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
  CreateIndependentPageCopyDto,
  CreatePageTemplateDto,
  DetachSyncedTemplateDto,
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
  PageTemplatePaginationDto,
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
import {
  PageAccessEffect,
  PageAccessPrincipalType,
} from '../../../common/helpers/types/permission';

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
    const canCreateIndependentCopy = await this.resolveCanCreateIndependentCopy(
      page,
      instance,
      user,
    );
    const legacyOperation = instance
      ? null
      : await this.db
          .selectFrom('pageTemplateOperations')
          .select(['sourcePageId'])
          .where('workspaceId', '=', user.workspaceId)
          .where('operationKind', '=', 'snapshot')
          .where('idempotencyKey', 'not like', 'create-template:%')
          .where('idempotencyKey', 'not like', 'independent-copy:%')
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
        provenanceState: 'invalid',
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          this.isDetachableStatus(instance?.status) &&
          pageAccess.capabilities.canWrite,
        canCreateIndependentCopy,
        lastErrorCode: this.safeErrorCode(instance?.lastErrorCode),
      };
    }

    const source = await this.pageRepo.findById(sourcePageId, {
      includeSpace: true,
    });
    if (!source || source.deletedAt) {
      return {
        createdFromTemplate: true,
        kind: instance?.instanceKind ?? 'regular',
        status: instance?.status ?? 'snapshot',
        appliedRevision: instance?.appliedRevision ?? null,
        latestRevision: latestRevision?.revision ?? null,
        provenanceState: 'source_missing',
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          this.isDetachableStatus(instance?.status) &&
          pageAccess.capabilities.canWrite,
        canCreateIndependentCopy,
        lastErrorCode:
          this.safeErrorCode(instance?.lastErrorCode) ??
          'page_template_source_missing',
      };
    }
    if (
      source.workspaceId !== page.workspaceId ||
      source.spaceId !== page.spaceId
    ) {
      return {
        createdFromTemplate: true,
        kind: instance?.instanceKind ?? 'regular',
        status: instance?.status ?? 'snapshot',
        appliedRevision: instance?.appliedRevision ?? null,
        latestRevision: latestRevision?.revision ?? null,
        provenanceState: 'invalid',
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          this.isDetachableStatus(instance?.status) &&
          pageAccess.capabilities.canWrite,
        canCreateIndependentCopy,
        lastErrorCode:
          this.safeErrorCode(instance?.lastErrorCode) ??
          'page_template_source_invalid',
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
        provenanceState: 'restricted',
        sourceTemplate: null,
        canReadTemplate: false,
        canDetach:
          this.isDetachableStatus(instance?.status) &&
          pageAccess.capabilities.canWrite,
        canCreateIndependentCopy,
        lastErrorCode: this.safeErrorCode(instance?.lastErrorCode),
      };
    }

    return {
      createdFromTemplate: true,
      kind: instance?.instanceKind ?? 'regular',
      status: instance?.status ?? 'snapshot',
      appliedRevision: instance?.appliedRevision ?? null,
      latestRevision: latestRevision?.revision ?? null,
      provenanceState: 'linked',
      canReadTemplate: true,
      canDetach:
        this.isDetachableStatus(instance?.status) &&
        pageAccess.capabilities.canWrite,
      canCreateIndependentCopy,
      lastErrorCode: this.safeErrorCode(instance?.lastErrorCode),
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
    const cursor = this.operations.decodePageCursor(dto.cursor);
    const { capabilities } = await this.resolveCapabilities(dto.spaceId, user);
    const enabled = capabilities.enabled;
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
        'page.workspaceId',
        'page.parentPageId',
        'page.deletedAt',
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
      .orderBy('page.id', 'desc');
    if (dto.kind) {
      query = query.where('page.templateKind', '=', dto.kind);
    }
    if (dto.archiveState === 'active') {
      query = query.where('page.templateArchivedAt', 'is', null);
    } else if (dto.archiveState === 'archived') {
      query = query.where('page.templateArchivedAt', 'is not', null);
    } else if (!dto.includeArchived) {
      query = query.where('page.templateArchivedAt', 'is', null);
    }
    if (dto.query?.trim()) {
      query = query.where('page.title', 'ilike', `%${dto.query.trim()}%`);
    }
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('page.updatedAt', '<', cursor.updatedAt),
          eb.and([
            eb('page.updatedAt', '=', cursor.updatedAt),
            eb('page.id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const visibleEntries: Array<{
      candidate: any;
      page: Page;
      access: any;
    }> = [];
    let lastScannedCandidate: any = null;
    const candidateWindow = await query.limit(candidateLimit).execute();
    const pages = candidateWindow.filter(
      (candidate): candidate is (typeof candidateWindow)[number] =>
        !candidate.deletedAt,
    ) as unknown as Page[];
    const pageById = new Map(pages.map((page) => [page.id, page] as const));
    const accessByPageId =
      await this.pageAccessService.getEffectiveAccessForPages(pages, user);
    for (const candidate of candidateWindow) {
      lastScannedCandidate = candidate;
      const page = pageById.get(candidate.id);
      if (!page) continue;
      const access = accessByPageId.get(page.id);
      if (!access) continue;
      if (!access.capabilities.canRead) continue;
      visibleEntries.push({ candidate, page, access });
      if (visibleEntries.length > limit) break;
    }
    const returnedEntries = visibleEntries.slice(0, limit);
    const candidates = returnedEntries.map((entry) => entry.candidate);
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
              .where('status', 'in', ['snapshot', 'active', 'syncing', 'error'])
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
      { usage: number; active: number; failed: number }
    >();
    for (const row of instanceRows) {
      if (!row.templatePageId) continue;
      const counts = instanceCounts.get(row.templatePageId) ?? {
        usage: 0,
        active: 0,
        failed: 0,
      };
      counts.usage += Number(row.count);
      if (row.status !== 'snapshot') counts.active += Number(row.count);
      if (row.status === 'error') counts.failed += Number(row.count);
      instanceCounts.set(row.templatePageId, counts);
    }
    const items = returnedEntries.map(({ candidate, page, access }) => ({
      ...candidate,
      kind: candidate.templateKind,
      archivedAt: candidate.templateArchivedAt,
      archiveState: candidate.templateArchivedAt ? 'archived' : 'active',
      publishedRevision: revisionByTemplate.get(candidate.id)?.revision ?? null,
      draftChanged:
        !revisionByTemplate.has(candidate.id) ||
        candidate.updatedAt >
          (revisionByTemplate.get(candidate.id)?.publishedAt ?? new Date(0)),
      activeInstanceCount: instanceCounts.get(candidate.id)?.active ?? 0,
      usageCount: instanceCounts.get(candidate.id)?.usage ?? 0,
      failedInstanceCount: instanceCounts.get(candidate.id)?.failed ?? 0,
      favorite: favoritePageIds.has(page.id),
      recent: recentPageIds.has(page.id),
      actions: {
        use:
          !candidate.templateArchivedAt &&
          (candidate.templateKind === 'regular'
            ? capabilities.useRegular
            : capabilities.useSynced && revisionByTemplate.has(candidate.id)),
        manage: access.capabilities.canWrite && capabilities.manageTemplate,
        archive:
          access.capabilities.canWrite &&
          capabilities.manageTemplate &&
          !candidate.templateArchivedAt,
        restore:
          access.capabilities.canWrite &&
          capabilities.manageTemplate &&
          Boolean(candidate.templateArchivedAt),
      },
    }));
    return {
      items,
      nextCursor:
        visibleEntries.length > limit
          ? this.operations.encodePageCursor(returnedEntries.at(-1)!.candidate)
          : candidateWindow.length === candidateLimit && lastScannedCandidate
            ? this.operations.encodePageCursor(lastScannedCandidate)
            : null,
      capabilities,
    };
  }

  async getCapabilities(spaceId: string, user: User) {
    const { capabilities } = await this.resolveCapabilities(spaceId, user);
    return { capabilities };
  }

  async createTemplate(
    dto: CreatePageTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.operations.assertIdempotencyKey(idempotencyKey);
    const operationKey = `create-template:${idempotencyKey}`;
    const completedOperation = await this.operations.findCompletedOperation(
      'snapshot',
      operationKey,
      user,
      dto,
    );
    if (completedOperation?.resultPageId) {
      const completedPage = await this.replayCreatedPageOperation(
        completedOperation,
        user,
        'Completed template result not found',
      );
      return { page: completedPage, idempotent: true };
    }
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
      await this.assertTemplateSourceIsNotLinked(source.id);
    }
    const proposedTargetPageId = uuid7();
    const operation = await this.operations.beginOperation(
      'snapshot',
      operationKey,
      user,
      dto,
      {
        ...(source ? { sourcePageId: source.id } : {}),
        resultPageId: proposedTargetPageId,
      },
    );
    if (operation.status === 'completed' && operation.resultPageId) {
      const existing = await this.replayCreatedPageOperation(
        operation,
        user,
        'Completed template result not found',
      );
      return { page: existing, idempotent: true };
    }
    const targetPageId = operation.resultPageId as string;
    const recoveredPage = await this.pageRepo.findById(targetPageId);
    if (recoveredPage && !recoveredPage.deletedAt) {
      const completed = await this.operations.completeOperation(
        operation.id,
        { resultPageId: targetPageId },
        operation.leaseToken,
      );
      if (!completed) {
        throw this.conflict(
          'page_template_operation_lease_lost',
          'The page template operation lease was lost',
        );
      }
      await this.finalizeCreatedPageOperation(operation, recoveredPage, user);
      return { page: recoveredPage, idempotent: true };
    }
    const rewritten = operation.stagedContent
      ? {
          content: operation.stagedContent,
          copies: this.operations.readAttachmentMapping(
            operation.attachmentMapping,
          ),
        }
      : await (async () => {
          const sourceContent = source
            ? await this.content.getLiveContent(source.id, user)
            : { type: 'doc', content: [{ type: 'paragraph' }] };
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
          const staged = source
            ? rewriteAttachmentsForUnsync(normalized, () => uuid7())
            : { content: normalized, copies: [] };
          await this.operations.stageCreatedPageContent(
            operation.id,
            operation.leaseToken,
            staged.content,
            staged.copies,
          );
          return staged;
        })();
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
        await this.operations.completeOperationInTransaction(
          trx,
          operation.id,
          operation.leaseToken,
          {
            resultPageId: targetPageId,
            attachmentMapping: rewritten.copies as any,
          },
        );
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
      await this.finalizeCreatedPageOperation(operation, page, user);
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
    }
  }

  async listDestinations(dto: PageTemplateDestinationsDto, user: User) {
    const limit = dto.limit ?? 20;
    const candidateLimit = Math.min(limit * 5 + 1, 251);
    const cursor = this.operations.decodePageCursor(dto.cursor);
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    let query = this.db
      .selectFrom('pages as page')
      .select(['page.id', 'page.updatedAt'])
      .where('page.workspaceId', '=', user.workspaceId)
      .where('page.spaceId', '=', dto.spaceId)
      .where('page.deletedAt', 'is', null)
      .where('page.templateKind', 'is', null);
    query = this.excludeDatabasePages(query)
      .orderBy('page.updatedAt', 'desc')
      .orderBy('page.id', 'desc');
    if (dto.pageId) {
      query = query.where('page.id', '=', dto.pageId);
    }
    if (dto.query?.trim()) {
      query = query.where('page.title', 'ilike', `%${dto.query.trim()}%`);
    }
    if (dto.purpose === 'source') {
      query = query.where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('pageTemplateInstances as sourceInstance')
              .select('sourceInstance.id')
              .whereRef('sourceInstance.childPageId', '=', 'page.id')
              .where('sourceInstance.instanceKind', '=', 'synced')
              .where('sourceInstance.status', 'in', [
                'active',
                'syncing',
                'error',
              ]),
          ),
        ),
      );
    }
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('page.updatedAt', '<', cursor.updatedAt),
          eb.and([
            eb('page.updatedAt', '=', cursor.updatedAt),
            eb('page.id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const visibleEntries: Array<{ candidate: any; page: Page }> = [];
    let lastScannedCandidate: any = null;
    const candidateWindow = await query.limit(candidateLimit).execute();
    const pages = (
      await Promise.all(
        candidateWindow.map(({ id }) => this.pageRepo.findById(id)),
      )
    ).filter((page): page is Page => Boolean(page && !page.deletedAt));
    const pageById = new Map(pages.map((page) => [page.id, page] as const));
    const accessByPageId =
      await this.pageAccessService.getEffectiveAccessForPages(pages, user);
    for (const candidate of candidateWindow) {
      lastScannedCandidate = candidate;
      const page = pageById.get(candidate.id);
      if (!page) continue;
      const capabilities = accessByPageId.get(page.id)?.capabilities;
      const visible =
        dto.purpose === 'source'
          ? capabilities?.canRead === true
          : capabilities?.canCreateChild === true;
      if (!visible) continue;
      visibleEntries.push({ candidate, page });
      if (visibleEntries.length > limit) break;
    }
    const returnedEntries = visibleEntries.slice(0, limit);
    const items = returnedEntries.map(({ page }) => ({
      id: page.id,
      slugId: page.slugId,
      title: page.title ?? null,
      icon: page.icon ?? null,
      parentPageId: page.parentPageId ?? null,
    }));
    return {
      rootAllowed:
        dto.purpose === 'source'
          ? false
          : ability.can(SpaceCaslAction.Create, SpaceCaslSubject.Page),
      items,
      nextCursor:
        visibleEntries.length > limit
          ? this.operations.encodePageCursor(returnedEntries.at(-1)!.candidate)
          : candidateWindow.length === candidateLimit && lastScannedCandidate
            ? this.operations.encodePageCursor(lastScannedCandidate)
            : null,
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

  private async replayCreatedPageOperation(
    operation: any,
    user: User,
    notFoundMessage: string,
  ): Promise<Page> {
    const page = operation.resultPageId
      ? await this.pageRepo.findById(operation.resultPageId)
      : null;
    if (!page || page.deletedAt || page.workspaceId !== user.workspaceId) {
      throw new NotFoundException(notFoundMessage);
    }
    await this.pageAccessService.assertCanReadPage(page, user);
    await this.finalizeCreatedPageOperation(operation, page, user);
    return page;
  }

  private async assertTemplateSourceIsNotLinked(pageId: string): Promise<void> {
    const linkedInstance = await this.db
      .selectFrom('pageTemplateInstances')
      .select('id')
      .where('childPageId', '=', pageId)
      .where('instanceKind', '=', 'synced')
      .where('status', 'in', ['active', 'syncing', 'error'])
      .executeTakeFirst();
    if (linkedInstance) {
      throw this.conflict(
        'page_template_linked_source_forbidden',
        'A linked synchronized page cannot be used as a template source',
      );
    }
  }

  private async finalizeCreatedPageOperation(
    operation: any,
    page: Page,
    user: User,
  ): Promise<void> {
    if (operation.afterContentHash) return;
    const leaseToken = await this.operations.claimCreatedPageFinalization(
      operation.id,
    );
    if (!leaseToken) return;
    try {
      await this.pageService.finalizeCreatedPage(page, user.id);
      const completed = await this.operations.completeCreatedPageFinalization(
        operation.id,
        leaseToken,
        page.content,
      );
      if (!completed) {
        throw this.conflict(
          'page_template_finalization_lease_lost',
          'The created page finalization lease was lost',
        );
      }
    } catch (error) {
      await this.operations.releaseCreatedPageFinalization(
        operation.id,
        leaseToken,
      );
      throw error;
    }
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
      const completedPage = await this.replayCreatedPageOperation(
        completedOperation,
        user,
        'Completed template result not found',
      );
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
      const existing = await this.replayCreatedPageOperation(
        operation,
        user,
        'Completed template result not found',
      );
      return { page: existing, idempotent: true };
    }

    const targetPageId = operation.resultPageId as string;
    const recoveredPage = await this.pageRepo.findById(targetPageId);
    if (recoveredPage && !recoveredPage.deletedAt) {
      const completed = await this.operations.completeOperation(
        operation.id,
        { resultPageId: targetPageId },
        operation.leaseToken,
      );
      if (!completed) {
        throw this.conflict(
          'page_template_operation_lease_lost',
          'The page template operation lease was lost',
        );
      }
      await this.finalizeCreatedPageOperation(operation, recoveredPage, user);
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
        const lockedSource = await this.pageRepo.findById(source.id, {
          withLock: true,
          trx,
        });
        if (
          !lockedSource ||
          lockedSource.deletedAt ||
          lockedSource.workspaceId !== user.workspaceId ||
          lockedSource.spaceId !== dto.spaceId ||
          lockedSource.templateKind !== templateKind
        ) {
          throw this.conflict(
            'page_template_source_changed',
            'The template source changed while the page was being created',
          );
        }
        if (lockedSource.templateArchivedAt) {
          throw this.conflict(
            'page_template_archived',
            'Archived templates cannot be used',
          );
        }
        if (templateKind === 'synced') {
          const lockedRevision = await trx
            .selectFrom('pageTemplateRevisions')
            .select(['id', 'revision', 'contentHash'])
            .where('templatePageId', '=', lockedSource.id)
            .orderBy('revision', 'desc')
            .executeTakeFirst();
          if (
            !lockedRevision ||
            lockedRevision.id !== publishedRevision?.id ||
            lockedRevision.revision !== publishedRevision?.revision ||
            lockedRevision.contentHash !== publishedRevision?.contentHash
          ) {
            throw this.conflict(
              'page_template_source_changed',
              'The published template changed while the page was being created',
            );
          }
        }
        await this.operations.completeOperationInTransaction(
          trx,
          operation.id,
          operation.leaseToken,
          {
            resultPageId: targetPageId,
            attachmentMapping: rewritten.copies as any,
          },
        );
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
      await this.finalizeCreatedPageOperation(operation, page, user);
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

  async listUsages(pageId: string, dto: PageTemplatePaginationDto, user: User) {
    const template = await this.requireManagedTemplate(pageId, user);
    const limit = dto.limit ?? 20;
    const cursor = this.decodeUsageCursor(dto.cursor);
    const workspaceBypass = this.pageAccessService.isWorkspaceBypassUser(
      user,
      template.workspaceId,
    );
    const readablePredicate = workspaceBypass
      ? sql<boolean>`true`
      : this.buildUsageReadablePredicate(user.id);
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const counts = await trx
          .selectFrom('pageTemplateInstances as instance')
          .innerJoin('pages as child', 'child.id', 'instance.childPageId')
          .select((eb) => [
            eb.fn.countAll<number>().as('totalCount'),
            sql<number>`count(*) filter (where ${readablePredicate})`.as(
              'readableCount',
            ),
          ])
          .where('instance.templatePageId', '=', template.id)
          .where('instance.workspaceId', '=', template.workspaceId)
          .where('child.workspaceId', '=', template.workspaceId)
          .where('instance.status', 'in', [
            'snapshot',
            'active',
            'syncing',
            'error',
          ])
          .where('child.deletedAt', 'is', null)
          .executeTakeFirst();
        const totalCount = Number(counts?.totalCount ?? 0);
        const readableCount = Number(counts?.readableCount ?? 0);
        if (readableCount === 0) {
          return {
            totalCount,
            hiddenCount: totalCount,
            items: [],
            nextCursor: null,
          };
        }

        const query = trx
          .selectFrom('pageTemplateInstances as instance')
          .innerJoin('pages as child', 'child.id', 'instance.childPageId')
          .select([
            'instance.childPageId',
            'instance.status',
            'instance.appliedRevision',
            'instance.lastErrorCode',
            'child.slugId',
            'child.title',
            'child.icon',
            'child.updatedAt',
            'child.workspaceId',
            'child.spaceId',
            'child.parentPageId',
            'child.deletedAt',
          ])
          .where('instance.templatePageId', '=', template.id)
          .where('instance.status', 'in', [
            'snapshot',
            'active',
            'syncing',
            'error',
          ])
          .where('child.deletedAt', 'is', null)
          .where('instance.workspaceId', '=', template.workspaceId)
          .where('child.workspaceId', '=', template.workspaceId)
          .where(readablePredicate)
          .$if(Boolean(cursor), (builder) =>
            builder.where((eb) =>
              eb.or([
                eb('child.updatedAt', '<', cursor!.updatedAt),
                eb.and([
                  eb('child.updatedAt', '=', cursor!.updatedAt),
                  eb('child.id', '<', cursor!.id),
                ]),
              ]),
            ),
          )
          .orderBy('child.updatedAt', 'desc')
          .orderBy('child.id', 'desc')
          .limit(limit + 1);
        const rows = await query.execute();
        const hasMore = rows.length > limit;
        const scannedRows = rows.slice(0, limit);
        const items = scannedRows.map((row) => ({
          childPageId: row.childPageId,
          status: row.status,
          appliedRevision: row.appliedRevision,
          lastErrorCode: this.safeErrorCode(row.lastErrorCode),
          slugId: row.slugId,
          title: row.title,
          icon: row.icon,
          updatedAt: row.updatedAt,
        }));
        return {
          totalCount,
          hiddenCount: totalCount - readableCount,
          items,
          nextCursor: hasMore
            ? this.encodeUsageCursor(scannedRows.at(-1)!)
            : null,
        };
      });
  }

  private buildUsageReadablePredicate(userId: string) {
    return sql<boolean>`(
      exists (
        select 1
        from page_access_rules as usage_user_allow
        where usage_user_allow.page_id = ${sql.ref('child.id')}
          and usage_user_allow.principal_type = ${PageAccessPrincipalType.USER}
          and usage_user_allow.user_id = ${userId}
          and usage_user_allow.effect = ${PageAccessEffect.ALLOW}
      )
      or (
        not exists (
          select 1
          from page_access_rules as usage_user_rule
          where usage_user_rule.page_id = ${sql.ref('child.id')}
            and usage_user_rule.principal_type = ${PageAccessPrincipalType.USER}
            and usage_user_rule.user_id = ${userId}
        )
        and (
          (
            exists (
              select 1
              from page_access_rules as usage_group_allow
              inner join group_users as usage_group_allow_member
                on usage_group_allow_member.group_id = usage_group_allow.group_id
              where usage_group_allow.page_id = ${sql.ref('child.id')}
                and usage_group_allow.principal_type = ${PageAccessPrincipalType.GROUP}
                and usage_group_allow_member.user_id = ${userId}
                and usage_group_allow.effect = ${PageAccessEffect.ALLOW}
            )
            and not exists (
              select 1
              from page_access_rules as usage_group_deny
              inner join group_users as usage_group_deny_member
                on usage_group_deny_member.group_id = usage_group_deny.group_id
              where usage_group_deny.page_id = ${sql.ref('child.id')}
                and usage_group_deny.principal_type = ${PageAccessPrincipalType.GROUP}
                and usage_group_deny_member.user_id = ${userId}
                and usage_group_deny.effect = ${PageAccessEffect.DENY}
            )
          )
          or (
            not exists (
              select 1
              from page_access_rules as usage_group_rule
              inner join group_users as usage_group_rule_member
                on usage_group_rule_member.group_id = usage_group_rule.group_id
              where usage_group_rule.page_id = ${sql.ref('child.id')}
                and usage_group_rule.principal_type = ${PageAccessPrincipalType.GROUP}
                and usage_group_rule_member.user_id = ${userId}
            )
            and exists (
              select 1
              from space_members as usage_space_member
              where usage_space_member.space_id = ${sql.ref('child.spaceId')}
                and (
                  usage_space_member.user_id = ${userId}
                  or exists (
                    select 1
                    from group_users as usage_space_group_member
                    where usage_space_group_member.group_id = usage_space_member.group_id
                      and usage_space_group_member.user_id = ${userId}
                  )
                )
            )
          )
        )
      )
    )`;
  }

  private encodeUsageCursor(row: {
    childPageId: string;
    updatedAt: Date | string;
  }): string {
    return Buffer.from(
      JSON.stringify({
        version: 1,
        updatedAt: new Date(row.updatedAt).toISOString(),
        id: row.childPageId,
      }),
    ).toString('base64url');
  }

  private decodeUsageCursor(
    cursor?: string,
  ): { updatedAt: Date; id: string } | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const updatedAt =
        typeof parsed.updatedAt === 'string'
          ? new Date(parsed.updatedAt)
          : new Date(Number.NaN);
      if (
        parsed.version !== 1 ||
        typeof parsed.id !== 'string' ||
        parsed.id.length === 0 ||
        Number.isNaN(updatedAt.getTime())
      ) {
        throw new Error('invalid');
      }
      return { updatedAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
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
    return {
      pageId: template.id,
      archived: true,
      archiveState: 'archived' as const,
    };
  }

  async restore(pageId: string, user: User) {
    const template = await this.requireManagedTemplate(pageId, user);
    if (template.templateArchivedAt) {
      await this.pageRepo.updatePage(
        {
          templateArchivedAt: null,
          lastUpdatedById: user.id,
          updatedAt: new Date(),
        },
        template.id,
      );
    }
    return {
      pageId: template.id,
      archived: false,
      archiveState: 'active' as const,
    };
  }

  async createIndependentCopy(
    pageId: string,
    dto: CreateIndependentPageCopyDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.operations.assertIdempotencyKey(idempotencyKey);
    const operationKey = `independent-copy:${idempotencyKey}`;
    const request = { pageId, ...dto };
    const completedOperation = await this.operations.findCompletedOperation(
      'snapshot',
      operationKey,
      user,
      request,
    );
    if (completedOperation?.resultPageId) {
      const completedPage = await this.replayCreatedPageOperation(
        completedOperation,
        user,
        'Completed independent copy not found',
      );
      return { page: completedPage, idempotent: true };
    }
    const source = await this.content.requirePlainDocument(
      pageId,
      user.workspaceId,
    );
    await this.pageAccessService.assertCanReadPage(source, user);
    const instance = await this.db
      .selectFrom('pageTemplateInstances')
      .selectAll()
      .where('childPageId', '=', source.id)
      .where('instanceKind', '=', 'synced')
      .where('status', 'in', ['active', 'syncing', 'error'])
      .executeTakeFirst();
    if (!instance) {
      throw this.conflict(
        'page_template_linked_instance_required',
        'Only a linked synchronized page can be copied independently',
      );
    }

    const parentPageId =
      dto.parentPageId === undefined
        ? (source.parentPageId ?? undefined)
        : (dto.parentPageId ?? undefined);
    await this.content.assertCanCreate(source.spaceId, parentPageId, user);

    const proposedTargetPageId = uuid7();
    const operation = await this.operations.beginOperation(
      'snapshot',
      operationKey,
      user,
      request,
      { sourcePageId: source.id, resultPageId: proposedTargetPageId },
    );
    if (operation.status === 'completed' && operation.resultPageId) {
      const existing = await this.replayCreatedPageOperation(
        operation,
        user,
        'Completed independent copy not found',
      );
      return { page: existing, idempotent: true };
    }

    const targetPageId = operation.resultPageId as string;
    const recoveredPage = await this.pageRepo.findById(targetPageId);
    if (recoveredPage && !recoveredPage.deletedAt) {
      const completed = await this.operations.completeOperation(
        operation.id,
        { resultPageId: targetPageId },
        operation.leaseToken,
      );
      if (!completed) {
        throw this.conflict(
          'page_template_operation_lease_lost',
          'The page template operation lease was lost',
        );
      }
      await this.finalizeCreatedPageOperation(operation, recoveredPage, user);
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
            detachTemplateContent(
              await this.content.getLiveContent(source.id, user),
            ),
            source.id,
            targetPageId,
            operation.attachmentMapping,
          );
      strictJsonToNode(rewritten.content as any);
      const attachmentRows = await this.content.copyAttachments(
        rewritten.copies,
        source,
        targetPageId,
        source.spaceId,
        user,
        copiedPaths,
        false,
      );
      graphLease = await this.pageEmbedService.prepareBulkPageReferences(
        [
          {
            id: targetPageId,
            workspaceId: source.workspaceId,
            spaceId: source.spaceId,
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
        const lockedSource = await this.pageRepo.findById(source.id, {
          withLock: true,
          trx,
        });
        const lockedInstance = await trx
          .selectFrom('pageTemplateInstances')
          .select('id')
          .where('id', '=', instance.id)
          .where('childPageId', '=', source.id)
          .where('instanceKind', '=', 'synced')
          .where('status', 'in', ['active', 'syncing', 'error'])
          .forUpdate()
          .executeTakeFirst();
        if (
          !lockedSource ||
          lockedSource.deletedAt ||
          lockedSource.workspaceId !== source.workspaceId ||
          lockedSource.spaceId !== source.spaceId ||
          !lockedInstance
        ) {
          throw this.conflict(
            'page_template_linked_instance_changed',
            'The synchronized template link changed while the copy was being created',
          );
        }
        await this.operations.completeOperationInTransaction(
          trx,
          operation.id,
          operation.leaseToken,
          {
            resultPageId: targetPageId,
            attachmentMapping: rewritten.copies as any,
          },
        );
        const createdPage = await this.pageService.create(
          user.id,
          user.workspaceId,
          {
            title: dto.title ?? source.title ?? undefined,
            icon: source.icon ?? undefined,
            parentPageId,
            spaceId: source.spaceId,
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
        return createdPage;
      });
      await this.finalizeCreatedPageOperation(operation, page, user);
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
        instance.status !== 'detached' ||
        this.containsNodeType(current, 'templateManagedBlock') ||
        this.containsNodeType(current, 'templateField')
      ) {
        throw this.conflict(
          'page_template_detach_incomplete',
          'The detach operation did not finish cleanly',
        );
      }
      return {
        pageId: page.id,
        detached: true,
        afterContentHash: existingOperation.afterContentHash,
        idempotent: true,
      };
    }
    const currentContentHash = hashPageTemplateInstanceContent(current);
    if (currentContentHash !== dto.baseContentHash) {
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
      currentContentHash,
      operation.id,
      operation.leaseToken,
      user,
    );
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

  private async resolveCapabilities(spaceId: string, user: User) {
    const [effective, ability] = await Promise.all([
      this.policy.resolveForUser(user.workspaceId, spaceId, user.id),
      this.spaceAbility.createForUser(user, spaceId),
    ]);
    const enabled =
      effective.systemEnabled &&
      effective.workspaceEnabled &&
      effective.templatesEnabled;
    return {
      effective,
      capabilities: {
        enabled,
        createTemplate:
          enabled &&
          effective.allowCreateTemplate &&
          effective.allowedActions.includes('create_template') &&
          ability.can(SpaceCaslAction.Create, SpaceCaslSubject.Page),
        manageTemplate:
          enabled &&
          effective.allowCreateTemplate &&
          effective.allowedActions.includes('manage_template'),
        useRegular:
          enabled &&
          effective.allowRegularTemplate &&
          effective.allowedActions.includes('use_regular_template'),
        useSynced:
          enabled &&
          effective.allowSyncedTemplate &&
          effective.allowedActions.includes('use_synced_template'),
      },
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

  private isDetachableStatus(status: string | null | undefined): boolean {
    return status === 'active' || status === 'syncing' || status === 'error';
  }

  private async resolveCanCreateIndependentCopy(
    page: Page,
    instance: any,
    user: User,
  ): Promise<boolean> {
    if (
      instance?.instanceKind !== 'synced' ||
      !this.isDetachableStatus(instance.status)
    ) {
      return false;
    }
    try {
      await this.content.assertCanCreate(
        page.spaceId,
        page.parentPageId ?? undefined,
        user,
      );
      return true;
    } catch {
      return false;
    }
  }

  private safeErrorCode(value: unknown): string | null {
    return typeof value === 'string' &&
      value.length <= 120 &&
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)
      ? value
      : null;
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
