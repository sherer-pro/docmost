import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { v7 as uuid7 } from 'uuid';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { hashPageTemplateInstanceContent } from '../../../common/helpers/prosemirror/page-template-content-hash';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageTemplatePolicyService } from '../transclusion/page-template-policy.service';
import {
  PageTemplatePaginationDto,
  PublishPageTemplateDto,
} from '../dto/page-template.dto';
import { executeTx } from '@docmost/db/utils';
import { PageHistoryRecorderService } from './page-history-recorder.service';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';
import { createTemplateInstanceContent } from '@docmost/editor-ext/server';
import { rewriteAttachmentsForUnsync } from '../transclusion/utils/transclusion-unsync.util';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';
import { PageTemplatePublicationService } from './page-template-publication.service';

const SYNC_ITEM_INSERT_BATCH_SIZE = 500;

@Injectable()
export class PageTemplateSyncService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly policy: PageTemplatePolicyService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    private readonly content: PageTemplateContentService,
    private readonly operations: PageTemplateOperationService,
    private readonly publication: PageTemplatePublicationService,
    @Optional() private readonly queueOutbox?: QueueOutboxService,
  ) {}

  async preflightPublish(pageId: string, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const liveDraft = await this.content.getLiveContent(template.id, user);
    const draft = this.publication.normalizeDraftForPublication(liveDraft);
    return this.buildPublishPreflight(template, user, true, draft);
  }

  async publish(
    pageId: string,
    dto: PublishPageTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.operations.assertIdempotencyKey(idempotencyKey);
    const operationKey = `publish:${pageId}:${idempotencyKey}`;
    const request = { pageId, ...dto };
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    if (template.templateArchivedAt) {
      throw new ConflictException({
        code: 'page_template_archived',
        message: 'Archived templates cannot be published',
      });
    }
    const completedOperation = await this.operations.findCompletedOperation(
      'template_sync',
      operationKey,
      user,
      request,
    );
    if (completedOperation) {
      const completedResult = await this.readPublishedOperationResult(
        completedOperation.stagedContent,
        pageId,
      );
      if (completedResult) {
        return this.serializePublishedResult(completedResult, true);
      }
      throw this.conflict(
        'page_template_publish_result_missing',
        'The completed publication result is unavailable',
      );
    }
    const draft = this.publication.normalizeDraftForPublication(
      await this.content.getLiveContent(template.id, user),
    );
    const draftHash = hashProseMirrorJson(draft as any);
    if (draftHash !== dto.draftHash) {
      throw this.conflict(
        'page_template_draft_changed',
        'The template draft changed after the publication preview',
      );
    }
    const existingPublished = await this.findLatestPublishedResult(
      template.id,
      draftHash,
    );
    if (existingPublished) {
      throw this.conflict(
        'page_template_no_changes',
        'The template draft has no changes to publish',
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
    }

    const operation = await this.operations.beginOperation(
      'template_sync',
      operationKey,
      user,
      request,
      { sourcePageId: template.id },
    );
    if (operation.status === 'completed') {
      const completedResult = await this.readPublishedOperationResult(
        operation.stagedContent,
        template.id,
      );
      if (completedResult) {
        return this.serializePublishedResult(completedResult, true);
      }
      throw this.conflict(
        'page_template_publish_result_missing',
        'The completed publication result is unavailable',
      );
    }

    let result: { revision: any; run: any; noOp: boolean };
    try {
      const fencedDraft = this.publication.normalizeDraftForPublication(
        await this.content.getLiveContent(template.id, user),
      );
      const fencedDraftHash = hashProseMirrorJson(fencedDraft as any);
      result = await executeTx(this.db, async (trx) => {
        if (fencedDraftHash !== draftHash) {
          throw this.conflict(
            'page_template_draft_changed',
            'The template draft changed after the publication preview',
          );
        }
        const lockedTemplate = await this.pageRepo.findById(template.id, {
          withLock: true,
          trx,
        });
        if (
          !lockedTemplate ||
          lockedTemplate.deletedAt ||
          lockedTemplate.workspaceId !== template.workspaceId ||
          lockedTemplate.spaceId !== template.spaceId ||
          lockedTemplate.templateKind !== 'synced' ||
          lockedTemplate.templateArchivedAt
        ) {
          throw this.conflict(
            'page_template_publish_conflict',
            'The template is no longer publishable',
          );
        }
        const latest = await trx
          .selectFrom('pageTemplateRevisions')
          .selectAll()
          .where('templatePageId', '=', template.id)
          .orderBy('revision', 'desc')
          .executeTakeFirst();
        if (latest?.contentHash === draftHash) {
          throw this.conflict(
            'page_template_no_changes',
            'The template draft has no changes to publish',
          );
        }
        if (dto.confirmationToken) {
          const confirmation = await trx
            .selectFrom('pageTemplatePublishConfirmations')
            .selectAll()
            .where('id', '=', dto.confirmationToken)
            .where('templatePageId', '=', template.id)
            .where('requestedById', '=', user.id)
            .where('draftHash', '=', draftHash)
            .where('consumedAt', 'is', null)
            .where('expiresAt', '>', new Date())
            .forUpdate()
            .executeTakeFirst();
          if (
            !confirmation ||
            !this.publication.isConfirmationBasisValid(
              confirmation.removedFieldIds,
              latest,
              fencedDraft,
            )
          ) {
            throw this.conflict(
              'page_template_confirmation_invalid',
              'The destructive confirmation is stale; rerun the publication preview',
            );
          }
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
          if (!consumed) {
            throw this.conflict(
              'page_template_confirmation_invalid',
              'The destructive confirmation is stale; rerun the publication preview',
            );
          }
        }
        const revisionNumber = Number(latest?.revision ?? 0) + 1;
        const revision = await trx
          .insertInto('pageTemplateRevisions')
          .values({
            workspaceId: template.workspaceId,
            spaceId: template.spaceId,
            templatePageId: template.id,
            revision: revisionNumber,
            content: fencedDraft as any,
            contentHash: draftHash,
            publishedById: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        const runSeed = await trx
          .insertInto('pageTemplateSyncRuns')
          .values({
            workspaceId: template.workspaceId,
            spaceId: template.spaceId,
            templatePageId: template.id,
            revisionId: revision.id,
            revision: revisionNumber,
            requestedById: user.id,
            status: 'pending',
            totalCount: 0,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        let totalCount = 0;
        let lastInstanceId: string | null = null;
        while (true) {
          let instanceQuery = trx
            .selectFrom('pageTemplateInstances as instance')
            .innerJoin('pages as child', 'child.id', 'instance.childPageId')
            .select(['instance.id', 'instance.childPageId'])
            .where('instance.templatePageId', '=', template.id)
            .where('instance.instanceKind', '=', 'synced')
            .where('instance.status', 'in', ['active', 'syncing', 'error'])
            .where('child.deletedAt', 'is', null);
          if (lastInstanceId) {
            instanceQuery = instanceQuery.where(
              'instance.id',
              '>',
              lastInstanceId,
            );
          }
          const instances = await instanceQuery
            .orderBy('instance.id', 'asc')
            .limit(SYNC_ITEM_INSERT_BATCH_SIZE)
            .execute();
          if (instances.length === 0) break;
          await trx
            .insertInto('pageTemplateSyncItems')
            .values(
              instances.map((instance) => ({
                runId: runSeed.id,
                instanceId: instance.id,
                childPageId: instance.childPageId,
              })),
            )
            .execute();
          await trx
            .updateTable('pageTemplateInstances')
            .set({
              status: 'syncing',
              lastErrorCode: null,
              updatedAt: new Date(),
            })
            .where(
              'id',
              'in',
              instances.map((instance) => instance.id),
            )
            .where('status', 'in', ['active', 'syncing', 'error'])
            .execute();
          totalCount += instances.length;
          lastInstanceId = instances.at(-1)!.id;
          if (instances.length < SYNC_ITEM_INSERT_BATCH_SIZE) break;
        }
        const run = await trx
          .updateTable('pageTemplateSyncRuns')
          .set({
            status: totalCount > 0 ? 'pending' : 'completed',
            totalCount,
            completedAt: totalCount > 0 ? null : new Date(),
            updatedAt: new Date(),
          })
          .where('id', '=', runSeed.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        if (totalCount > 0) {
          if (!this.queueOutbox) {
            throw new Error('page_template_sync_outbox_unavailable');
          }
          await this.queueOutbox.enqueuePageTemplateSync(
            { runId: run.id },
            revision.id,
            trx,
          );
        }
        await this.completePublishOperationInTransaction(
          trx,
          operation,
          draftHash,
          revision,
          run,
          false,
        );
        return { revision, run, noOp: false };
      });
    } catch (error) {
      await this.operations.failOperation(
        operation.id,
        this.operations.errorCode(error),
        operation.leaseToken,
      );
      throw error;
    }
    if (!result.noOp && result.run.status === 'pending') {
      this.queueOutbox!.kick();
    }
    return this.serializePublishedResult(result, false);
  }

  async listRevisions(
    pageId: string,
    dto: PageTemplatePaginationDto,
    user: User,
  ) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const limit = dto.limit ?? 20;
    const cursor = this.operations.decodeRevisionCursor(dto.cursor);
    let query = this.db
      .selectFrom('pageTemplateRevisions')
      .selectAll()
      .where('templatePageId', '=', template.id);
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('revision', '<', cursor.revision),
          eb.and([
            eb('revision', '=', cursor.revision),
            eb('id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const revisions = await query
      .orderBy('revision', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    const items = revisions.slice(0, limit);
    return {
      items: items.map((revision) =>
        this.publication.serializeRevision(revision, true),
      ),
      nextCursor:
        revisions.length > limit
          ? this.operations.encodeRevisionCursor(items.at(-1)!)
          : null,
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
    return {
      items: runs.map((run) => this.publication.serializeSyncRun(run)),
    };
  }

  async catchUpRestoredInstances(pageIds: string[], user: User): Promise<void> {
    if (pageIds.length === 0) return;
    let enqueued = false;
    await executeTx(this.db, async (trx) => {
      const instances = await trx
        .selectFrom('pageTemplateInstances as instance')
        .innerJoin('pages as child', 'child.id', 'instance.childPageId')
        .innerJoin(
          'pages as template',
          'template.id',
          'instance.templatePageId',
        )
        .select([
          'instance.id',
          'instance.childPageId',
          'instance.templatePageId',
          'instance.workspaceId',
          'instance.spaceId',
          'instance.appliedRevision',
        ])
        .where('instance.workspaceId', '=', user.workspaceId)
        .where('instance.instanceKind', '=', 'synced')
        .where('instance.status', 'in', ['active', 'syncing', 'error'])
        .where('child.deletedAt', 'is', null)
        .where('template.deletedAt', 'is', null)
        .where('template.templateKind', '=', 'synced')
        .whereRef('template.workspaceId', '=', 'instance.workspaceId')
        .whereRef('template.spaceId', '=', 'instance.spaceId')
        .where(
          sql<boolean>`${sql.ref('instance.childPageId')} = any(${pageIds}::uuid[])`,
        )
        .forUpdate()
        .execute();
      const templateIds = [
        ...new Set(
          instances
            .map((instance) => instance.templatePageId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (templateIds.length === 0) return;
      const revisions = await trx
        .selectFrom('pageTemplateRevisions')
        .selectAll()
        .where(
          sql<boolean>`${sql.ref('templatePageId')} = any(${templateIds}::uuid[])`,
        )
        .orderBy('templatePageId', 'asc')
        .orderBy('revision', 'desc')
        .execute();
      const latestByTemplate = new Map<string, any>();
      for (const revision of revisions) {
        if (!latestByTemplate.has(revision.templatePageId)) {
          latestByTemplate.set(revision.templatePageId, revision);
        }
      }
      const groups = new Map<
        string,
        { revision: any; instances: typeof instances }
      >();
      for (const instance of instances) {
        if (!instance.templatePageId) continue;
        const revision = latestByTemplate.get(instance.templatePageId);
        if (!revision || (instance.appliedRevision ?? 0) >= revision.revision) {
          continue;
        }
        const group = groups.get(revision.id) ?? {
          revision,
          instances: [],
        };
        group.instances.push(instance);
        groups.set(revision.id, group);
      }
      for (const { revision, instances: staleInstances } of groups.values()) {
        const first = staleInstances[0];
        const run = await trx
          .insertInto('pageTemplateSyncRuns')
          .values({
            workspaceId: first.workspaceId,
            spaceId: first.spaceId,
            templatePageId: first.templatePageId!,
            revisionId: revision.id,
            revision: revision.revision,
            requestedById: user.id,
            status: 'pending',
            totalCount: staleInstances.length,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        for (
          let offset = 0;
          offset < staleInstances.length;
          offset += SYNC_ITEM_INSERT_BATCH_SIZE
        ) {
          const batch = staleInstances.slice(
            offset,
            offset + SYNC_ITEM_INSERT_BATCH_SIZE,
          );
          await trx
            .insertInto('pageTemplateSyncItems')
            .values(
              batch.map((instance) => ({
                runId: run.id,
                instanceId: instance.id,
                childPageId: instance.childPageId,
              })),
            )
            .execute();
          await trx
            .updateTable('pageTemplateInstances')
            .set({
              status: 'syncing',
              lastErrorCode: null,
              updatedAt: new Date(),
            })
            .where(
              'id',
              'in',
              batch.map((instance) => instance.id),
            )
            .where('status', 'in', ['active', 'syncing', 'error'])
            .execute();
        }
        if (!this.queueOutbox) {
          throw new Error('page_template_sync_outbox_unavailable');
        }
        await this.queueOutbox.enqueuePageTemplateSync(
          { runId: run.id },
          revision.id,
          trx,
        );
        enqueued = true;
      }
    });
    if (enqueued) this.queueOutbox!.kick();
  }

  async retrySyncRun(pageId: string, runId: string, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    const dispatchId = uuid7();
    await executeTx(this.db, async (trx) => {
      const run = await trx
        .selectFrom('pageTemplateSyncRuns')
        .selectAll()
        .where('id', '=', runId)
        .where('templatePageId', '=', template.id)
        .forUpdate()
        .executeTakeFirst();
      if (!run) {
        throw new NotFoundException('Template synchronization run not found');
      }
      if (run.status !== 'partial' && run.status !== 'failed') {
        throw this.conflict(
          'page_template_sync_retry_not_available',
          'This synchronization run cannot be retried',
        );
      }
      const itemCounts = await trx
        .selectFrom('pageTemplateSyncItems')
        .select('status')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('runId', '=', run.id)
        .groupBy('status')
        .execute();
      const countFor = (status: string) =>
        Number(itemCounts.find((item) => item.status === status)?.count ?? 0);
      const completedCount = countFor('completed');
      const retryableCount =
        countFor('pending') + countFor('running') + countFor('failed');
      if (retryableCount === 0) {
        throw this.conflict(
          'page_template_sync_retry_not_available',
          'This synchronization run cannot be retried',
        );
      }
      await trx
        .updateTable('pageTemplateInstances')
        .set({
          status: 'syncing',
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(
          'id',
          'in',
          trx
            .selectFrom('pageTemplateSyncItems')
            .select('instanceId')
            .where('runId', '=', run.id)
            .where('status', 'in', ['pending', 'running', 'failed']),
        )
        .where('status', 'in', ['active', 'syncing', 'error'])
        .where((eb) =>
          eb.or([
            eb('appliedRevision', 'is', null),
            eb('appliedRevision', '<', run.revision),
          ]),
        )
        .execute();
      await trx
        .updateTable('pageTemplateSyncItems')
        .set({
          status: 'pending',
          attemptCount: 0,
          errorCode: null,
          updatedAt: new Date(),
        })
        .where('runId', '=', run.id)
        .where('status', 'in', ['pending', 'running', 'failed'])
        .execute();
      const retried = await trx
        .updateTable('pageTemplateSyncRuns')
        .set({
          status: 'pending',
          processedCount: completedCount,
          succeededCount: completedCount,
          failedCount: 0,
          errorCode: null,
          startedAt: null,
          completedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', run.id)
        .where('status', 'in', ['partial', 'failed'])
        .returning('id')
        .executeTakeFirst();
      if (!retried) {
        throw this.conflict(
          'page_template_sync_retry_not_available',
          'This synchronization run cannot be retried',
        );
      }
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
    return { accepted: true, runId };
  }

  async processSyncItem(
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
        run.revision,
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
      let operation: any;
      try {
        const current = await this.content.getLiveContent(page.id, actor);
        const next = createTemplateInstanceContent(
          publishedForInstance,
          current,
        );
        const baseHash = hashPageTemplateInstanceContent(current);
        const nextHash = hashPageTemplateInstanceContent(next);
        if (baseHash === nextHash) {
          const revisionApplied = await this.markInstanceRevisionApplied(
            instance.id,
            run.revision,
          );
          await this.markSyncItemCompleted(item.id);
          if (revisionApplied) {
            await this.pageHistoryRecorder.enqueuePageEvent({
              pageId: page.id,
              changeType: 'page.template.synced',
              changeData: {
                templateId: run.templatePageId,
                templateRevision: run.revision,
              },
              actorId: actor.id,
            });
          }
          return;
        }
        operation = await this.operations.beginOperation(
          'template_sync',
          `template-sync:${run.id}:${instance.id}:${run.leaseToken ?? 'unleased'}:${attempt}`,
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
        await this.content.applyMutation(
          page.id,
          current,
          next,
          baseHash,
          operation.id,
          operation.leaseToken,
          actor,
          run.revision,
        );
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
        if (
          operation?.leaseToken &&
          (await this.operations.ownsOperationLease(
            operation.id,
            operation.leaseToken,
          ))
        ) {
          await this.operations.failOperation(
            operation.id,
            this.operations.errorCode(error),
            operation.leaseToken,
          );
        }
        const errorCode = this.operations.errorCode(error);
        if (errorCode === 'page_template_revision_stale') {
          await this.markSyncItemCompleted(item.id);
          return;
        }
        if (errorCode !== 'page_template_stale') {
          break;
        }
      }
    }
    await this.markSyncItemFailed(
      item.id,
      instance.id,
      this.operations.errorCode(lastError),
      run.revision,
    );
  }

  private async markInstanceRevisionApplied(
    instanceId: string,
    revision: number,
  ): Promise<boolean> {
    const applied = await this.db
      .updateTable('pageTemplateInstances')
      .set({
        appliedRevision: revision,
        status: 'active',
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where('id', '=', instanceId)
      .where('status', 'in', ['active', 'syncing', 'error'])
      .where((eb) =>
        eb.or([
          eb('appliedRevision', 'is', null),
          eb('appliedRevision', '<', revision),
        ]),
      )
      .returning('id')
      .executeTakeFirst();
    return Boolean(applied);
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
      const attachmentRows = await this.content.copyAttachments(
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
    revision: number,
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
        .where('status', 'in', ['active', 'syncing', 'error'])
        .where((eb) =>
          eb.or([
            eb('appliedRevision', 'is', null),
            eb('appliedRevision', '<', revision),
          ]),
        )
        .execute();
    });
  }

  async updateSyncRunProgress(
    runId: string,
    leaseToken: string,
  ): Promise<boolean> {
    return this.writeSyncRunProgress(runId, leaseToken, false);
  }

  async recalculateSyncRun(runId: string, leaseToken: string): Promise<void> {
    await this.writeSyncRunProgress(runId, leaseToken, true);
  }

  private async writeSyncRunProgress(
    runId: string,
    leaseToken: string,
    finalize: boolean,
  ): Promise<boolean> {
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
    const terminalStatus =
      failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed';
    const updated = await this.db
      .updateTable('pageTemplateSyncRuns')
      .set({
        status: finalize ? terminalStatus : 'running',
        processedCount: processed,
        succeededCount: succeeded,
        failedCount: failed,
        errorCode:
          finalize && failed > 0 ? 'page_template_sync_partial_failure' : null,
        completedAt: finalize ? new Date() : null,
        ...(finalize ? { leaseToken: null, leaseExpiresAt: null } : {}),
        updatedAt: new Date(),
      })
      .where('id', '=', runId)
      .where('leaseToken', '=', leaseToken)
      .returning('id')
      .executeTakeFirst();
    return Boolean(updated);
  }

  async finishSyncRun(
    runId: string,
    leaseToken: string,
    status: 'failed',
    errorCode: string,
  ): Promise<void> {
    await executeTx(this.db, async (trx) => {
      const finished = await trx
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
        .returning('id')
        .executeTakeFirst();
      if (!finished) return;
      await trx
        .updateTable('pageTemplateInstances')
        .set({
          status: 'error',
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        })
        .where(
          'id',
          'in',
          trx
            .selectFrom('pageTemplateSyncItems')
            .select('instanceId')
            .where('runId', '=', runId)
            .where('status', 'in', ['pending', 'running']),
        )
        .where('status', 'in', ['active', 'syncing', 'error'])
        .execute();
    });
  }

  private async findLatestPublishedResult(
    templatePageId: string,
    draftHash: string,
  ): Promise<{ revision: any; run: any; noOp: true } | null> {
    const revision = await this.db
      .selectFrom('pageTemplateRevisions')
      .selectAll()
      .where('templatePageId', '=', templatePageId)
      .orderBy('revision', 'desc')
      .executeTakeFirst();
    if (!revision || revision.contentHash !== draftHash) return null;
    const run = await this.db
      .selectFrom('pageTemplateSyncRuns')
      .selectAll()
      .where('revisionId', '=', revision.id)
      .executeTakeFirst();
    return run ? { revision, run, noOp: true } : null;
  }

  private publishOperationSnapshot(
    revision: any,
    run: any,
    noOp: boolean,
  ): Record<string, unknown> {
    return {
      type: 'page_template_publish_result',
      revisionId: revision.id,
      syncRunId: run.id,
      noOp,
    };
  }

  private async readPublishedOperationResult(
    value: unknown,
    templatePageId: string,
  ): Promise<{ revision: any; run: any; noOp: boolean } | null> {
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as Record<string, unknown>;
    if (
      snapshot.type !== 'page_template_publish_result' ||
      typeof snapshot.revisionId !== 'string' ||
      typeof snapshot.syncRunId !== 'string'
    ) {
      return null;
    }
    const [revision, run] = await Promise.all([
      this.db
        .selectFrom('pageTemplateRevisions')
        .selectAll()
        .where('id', '=', snapshot.revisionId)
        .where('templatePageId', '=', templatePageId)
        .executeTakeFirst(),
      this.db
        .selectFrom('pageTemplateSyncRuns')
        .selectAll()
        .where('id', '=', snapshot.syncRunId)
        .where('templatePageId', '=', templatePageId)
        .executeTakeFirst(),
    ]);
    if (!revision || !run || run.revisionId !== revision.id) return null;
    return { revision, run, noOp: snapshot.noOp === true };
  }

  private async completePublishOperationInTransaction(
    trx: any,
    operation: any,
    draftHash: string,
    revision: any,
    run: any,
    noOp: boolean,
  ): Promise<void> {
    const completed = await trx
      .updateTable('pageTemplateOperations')
      .set({
        status: 'completed',
        afterContentHash: draftHash,
        stagedContent: this.publishOperationSnapshot(
          revision,
          run,
          noOp,
        ) as any,
        errorCode: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', operation.id)
      .where('status', '=', 'pending')
      .where('leaseToken', '=', operation.leaseToken)
      .returning('id')
      .executeTakeFirst();
    if (!completed) {
      throw this.conflict(
        'page_template_operation_lease_lost',
        'The page template operation lease was lost',
      );
    }
  }

  private serializePublishedResult(
    result: { revision: any; run: any; noOp: boolean },
    idempotent: boolean,
  ) {
    return {
      revision: this.publication.serializeRevision(result.revision),
      syncRun: this.publication.serializeSyncRun(result.run),
      idempotent,
      noOp: result.noOp,
    };
  }

  private buildPublishPreflight(
    template: Page,
    user: User,
    issueConfirmation: boolean,
    suppliedDraft?: unknown,
  ) {
    return this.publication.buildPublishPreflight(
      template,
      user,
      issueConfirmation,
      (pageId, actor) => this.content.getLiveContent(pageId, actor),
      suppliedDraft,
    );
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

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
