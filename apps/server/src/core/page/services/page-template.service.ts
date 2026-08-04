import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { v7 as uuid7 } from 'uuid';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { KyselyDB } from '@docmost/db/types/kysely.types';
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
  CreateFromTemplateDto,
  DetachPageEmbedDto,
  InsertPageEmbedDto,
  PageTemplateDiscoveryDto,
} from '../dto/page-template.dto';
import { PageService } from './page.service';
import { executeTx } from '@docmost/db/utils';
import type { PageEmbedGraphLease } from '../transclusion/page-embed-graph-lock.service';
import { getAttachmentIds } from '../../../common/helpers/prosemirror/utils';

type OperationKind = 'snapshot' | 'embed_insert' | 'embed_detach';
const OPERATION_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class PageTemplateService {
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
  ) {}

  async setTemplate(pageId: string, enabled: boolean, user: User) {
    const page = await this.requirePlainDocument(pageId, user.workspaceId);
    await this.pageAccessService.assertCanWritePage(page, user);
    if (page.isTemplate === enabled) {
      return { pageId: page.id, isTemplate: enabled };
    }
    if (enabled) {
      await this.policy.assertAction(
        page.workspaceId,
        page.spaceId,
        user.id,
        page.isTemplate ? 'manage_template' : 'create_template',
      );
    } else {
      const effective = await this.policy.resolveForUser(
        page.workspaceId,
        page.spaceId,
        user.id,
      );
      if (
        effective.systemEnabled &&
        effective.workspaceEnabled &&
        effective.templatesEnabled
      ) {
        await this.policy.assertAction(
          page.workspaceId,
          page.spaceId,
          user.id,
          'manage_template',
        );
      }
    }
    await this.pageRepo.updatePage(
      { isTemplate: enabled, lastUpdatedById: user.id, updatedAt: new Date() },
      page.id,
    );
    return { pageId: page.id, isTemplate: enabled };
  }

  async discover(dto: PageTemplateDiscoveryDto, user: User) {
    const limit = dto.limit ?? 20;
    const candidateLimit = Math.min(limit * 5 + 1, 251);
    const offset = this.decodeCursor(dto.cursor);
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
        'space.name as spaceName',
        'space.slug as spaceSlug',
      ])
      .where('page.workspaceId', '=', user.workspaceId)
      .where('page.isTemplate', '=', true)
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
    if (dto.spaceId) query = query.where('page.spaceId', '=', dto.spaceId);
    if (dto.query?.trim()) {
      query = query.where('page.title', 'ilike', `%${dto.query.trim()}%`);
    }
    const candidates = await query.execute();
    const [favoriteRows, recentPages] = await Promise.all([
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
      dto.spaceId
        ? this.pageRepo.getRecentPagesInSpace(dto.spaceId, {
            limit: 50,
            query: undefined,
            adminView: false,
          })
        : this.pageRepo.getRecentPages(user.id, {
            limit: 50,
            query: undefined,
            adminView: false,
          }),
    ]);
    const favoritePageIds = new Set(favoriteRows.map((row) => row.pageId));
    const recentPageIds = new Set(recentPages.items.map((page) => page.id));
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
      const effective = await this.policy.resolveForUser(
        user.workspaceId,
        page.spaceId,
        user.id,
      );
      if (
        !effective.systemEnabled ||
        !effective.workspaceEnabled ||
        !effective.templatesEnabled
      ) {
        continue;
      }
      items.push({
        ...candidate,
        favorite: favoritePageIds.has(page.id),
        recent: recentPageIds.has(page.id),
        actions: {
          snapshot:
            effective.allowSnapshot &&
            effective.allowedActions.includes('use_snapshot'),
          liveEmbed:
            effective.allowLiveEmbed &&
            effective.allowedActions.includes('use_live_embed'),
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
    await this.policy.assertAction(
      source.workspaceId,
      source.spaceId,
      user.id,
      'use_snapshot',
    );
    await this.assertCanCreate(dto.spaceId, dto.parentPageId, user);
    await this.policy.assertAction(
      user.workspaceId,
      dto.spaceId,
      user.id,
      'use_snapshot',
    );

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
            await this.getLiveContent(source.id, user),
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
            isTemplate: false,
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
    await this.pageAccessService.assertCanWritePage(consumer, user);
    await this.policy.assertAction(
      user.workspaceId,
      consumer.spaceId,
      user.id,
      'use_live_embed',
    );
    await this.policy.assertAction(
      user.workspaceId,
      source.spaceId,
      user.id,
      'use_live_embed',
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
    if (!page.isTemplate) {
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
