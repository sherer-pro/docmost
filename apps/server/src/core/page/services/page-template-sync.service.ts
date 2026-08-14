import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { v7 as uuid7 } from 'uuid';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageTemplatePolicyService } from '../transclusion/page-template-policy.service';
import { PublishPageTemplateDto } from '../dto/page-template.dto';
import { executeTx } from '@docmost/db/utils';
import { PageHistoryRecorderService } from './page-history-recorder.service';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';
import { createTemplateInstanceContent } from '@docmost/editor-ext/server';
import { rewriteAttachmentsForUnsync } from '../transclusion/utils/transclusion-unsync.util';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';
import { PageTemplatePublicationService } from './page-template-publication.service';

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

  async publish(pageId: string, dto: PublishPageTemplateDto, user: User) {
    const template = await this.requireManagedSyncedTemplate(pageId, user);
    if (template.templateArchivedAt) {
      throw new ConflictException({
        code: 'page_template_archived',
        message: 'Archived templates cannot be published',
      });
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
      revision: this.publication.serializeRevision(result.revision),
      syncRun: this.publication.serializeSyncRun(result.run),
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
        this.publication.serializeRevision(revision, true),
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
    return {
      items: runs.map((run) => this.publication.serializeSyncRun(run)),
    };
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
      try {
        const current = await this.content.getLiveContent(page.id, actor);
        const next = createTemplateInstanceContent(
          publishedForInstance,
          current,
        );
        const baseHash = hashProseMirrorJson(current as any);
        const nextHash = hashProseMirrorJson(next as any);
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
        const operation = await this.operations.beginOperation(
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
        const errorCode = this.operations.errorCode(error);
        if (errorCode === 'page_template_revision_stale') {
          await this.markSyncItemCompleted(item.id);
          return;
        }
        if (errorCode !== 'page_embed_stale') break;
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

  async recalculateSyncRun(runId: string, leaseToken: string): Promise<void> {
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

  async finishSyncRun(
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
