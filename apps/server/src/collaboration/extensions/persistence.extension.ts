import {
  afterUnloadDocumentPayload,
  beforeUnloadDocumentPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as Y from 'yjs';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { getPageId, jsonToText, tiptapExtensions } from '../collaboration.util';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import {
  extractMentions,
  extractPageMentions,
  extractUserMentions,
  getProsemirrorContent,
} from '../../common/helpers/prosemirror/utils';
import { isDeepStrictEqual } from 'node:util';
import {
  IPageBacklinkJob,
  IPageMentionNotificationJob,
} from '../../integrations/queue/constants/queue.interface';
import { Page } from '@docmost/db/types/entity.types';
import { CollabHistoryService } from '../services/collab-history.service';
import {
  HISTORY_FAST_INTERVAL,
  HISTORY_FAST_THRESHOLD,
  HISTORY_INTERVAL,
  HISTORY_MAX_INTERVAL,
} from '../constants';
import { TransclusionService } from '../../core/page/transclusion/transclusion.service';
import { PageEmbedService } from '../../core/page/transclusion/page-embed.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import { hashProseMirrorJson } from '../../common/helpers/prosemirror/ai-page-operation';
import type { PageEmbedGraphLease } from '../../core/page/transclusion/page-embed-graph-lock.service';
import { validateTemplateInstanceMutation } from '@docmost/editor-ext';

@Injectable()
export class PersistenceExtension implements Extension {
  private readonly logger = new Logger(PersistenceExtension.name);
  private contributors: Map<string, Set<string>> = new Map();
  private readonly dirtyDocuments = new Map<
    string,
    {
      data: onStoreDocumentPayload;
      retryIndex: number;
    }
  >();
  private readonly dirtyRetryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  private static readonly STORE_ATTEMPTS = 3;
  private static readonly STORE_RETRY_DELAYS_MS = [50, 150] as const;
  private static readonly DIRTY_RETRY_DELAYS_MS = [
    1_000, 2_000, 5_000, 10_000, 30_000,
  ] as const;

  constructor(
    private readonly pageRepo: PageRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE) private notificationQueue: Queue,
    private readonly collabHistory: CollabHistoryService,
    private readonly transclusionService: TransclusionService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onLoadDocument(data: onLoadDocumentPayload) {
    const { documentName, document } = data;
    const pageId = getPageId(documentName);

    if (!document.isEmpty('default')) {
      return;
    }

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
      includeYdoc: true,
    });

    if (!page) {
      this.logger.warn('page not found');
      return;
    }

    if (page.ydoc) {
      this.logger.debug(`ydoc loaded from db: ${pageId}`);

      const doc = new Y.Doc();
      const dbState = new Uint8Array(page.ydoc);

      Y.applyUpdate(doc, dbState);
      return doc;
    }

    // if no ydoc state in db convert json in page.content to Ydoc.
    if (page.content) {
      this.logger.debug(`converting json to ydoc: ${pageId}`);

      const ydoc = TiptapTransformer.toYdoc(
        page.content,
        'default',
        tiptapExtensions,
      );

      Y.encodeStateAsUpdate(ydoc);
      return ydoc;
    }

    this.logger.debug(`creating fresh ydoc: ${pageId}`);
    return new Y.Doc();
  }

  async onStoreDocument(data: onStoreDocumentPayload) {
    await this.storeDocument(data, false);
  }

  async beforeUnloadDocument(data: beforeUnloadDocumentPayload) {
    if (this.dirtyDocuments.has(data.documentName)) {
      throw new Error('collaboration_document_has_unpersisted_changes');
    }
  }

  discardUnpersistedDocument(documentName: string): void {
    if (!this.dirtyDocuments.has(documentName)) return;
    this.clearDocumentDirty(documentName);
    this.contributors.delete(documentName);
    this.logger.warn(
      `Discarded unpersisted collaboration state after lease loss; pageId=${getPageId(documentName)}`,
    );
  }

  private async storeDocument(
    data: onStoreDocumentPayload,
    backgroundRetry: boolean,
  ): Promise<void> {
    const { documentName, document, context } = data;

    const pageId = getPageId(documentName);

    const tiptapJson = TiptapTransformer.fromYdoc(document, 'default');
    const ydocState = Buffer.from(Y.encodeStateAsUpdate(document));

    let textContent = null;

    try {
      textContent = jsonToText(tiptapJson);
    } catch (err) {
      this.logger.warn('jsonToText' + err?.['message']);
    }

    let page: Page = null;
    const editingUserIds = this.peekContributors(documentName);
    const graphLease = context?.pageEmbedGraphLease as
      | PageEmbedGraphLease
      | undefined;

    let persistenceError: unknown = null;
    for (
      let attempt = 1;
      attempt <= PersistenceExtension.STORE_ATTEMPTS;
      attempt += 1
    ) {
      page = null;
      try {
        await executeTx(this.db, async (trx) => {
          const lockedPage = await this.pageRepo.findById(pageId, {
            withLock: true,
            includeContent: true,
            trx,
          });

          if (!lockedPage) {
            this.logger.error(`Page with id ${pageId} not found`);
            return;
          }

          if (isDeepStrictEqual(tiptapJson, lockedPage.content)) {
            return;
          }

          if (!context?.pageTemplateMutationId) {
            const syncedInstance = await trx
              .selectFrom('pageTemplateInstances')
              .select('id')
              .where('childPageId', '=', pageId)
              .where('instanceKind', '=', 'synced')
              .where('status', 'in', ['active', 'syncing', 'error'])
              .executeTakeFirst();
            if (
              syncedInstance &&
              !validateTemplateInstanceMutation(lockedPage.content, tiptapJson)
            ) {
              throw new ConflictException({
                code: 'page_template_managed_content_read_only',
                message:
                  'Template-managed blocks can only be changed in the source template',
              });
            }
          }

          const contributorIds = context?.pageTemplateSystemSyncRevision
            ? undefined
            : Array.from(
                new Set([
                  ...(lockedPage.contributorIds || []),
                  ...editingUserIds,
                  lockedPage.creatorId,
                ]),
              );

          await this.pageRepo.updatePage(
            {
              content: tiptapJson,
              textContent: textContent,
              ydoc: ydocState,
              lastUpdatedById: context.user.id,
              contributorIds: contributorIds,
            },
            pageId,
            trx,
          );

          await this.syncTransclusionState(
            pageId,
            lockedPage.workspaceId,
            tiptapJson,
            trx,
            context?.pageTemplateMutationId,
            graphLease,
          );

          if (context?.pageTemplateMutationId) {
            const completedOperation = await trx
              .updateTable('pageTemplateOperations')
              .set({
                status: 'completed',
                afterContentHash: hashProseMirrorJson(tiptapJson),
                errorCode: null,
                leaseToken: null,
                leaseExpiresAt: null,
                updatedAt: new Date(),
              })
              .where('id', '=', context.pageTemplateMutationId)
              .where('status', '=', 'pending')
              .where(
                'leaseToken',
                '=',
                context.pageTemplateOperationLeaseToken as string,
              )
              .where('leaseExpiresAt', '>', new Date())
              .returning('id')
              .executeTakeFirst();
            if (!completedOperation) {
              throw new ConflictException({
                code: 'page_template_operation_lease_lost',
                message: 'The page template operation lease was lost',
              });
            }
          }

          page = lockedPage;
          this.logger.debug(
            `Page updated: ${pageId} - SlugId: ${lockedPage.slugId}`,
          );
        });
        persistenceError = null;
        break;
      } catch (err) {
        persistenceError = err;
        page = null;
        const integrityCode = this.getContentIntegrityErrorCode(err);
        if (integrityCode && !context?.pageTemplateMutationId) {
          await this.restorePersistedDocument(document, pageId);
          document.broadcastStateless(
            JSON.stringify({
              type: 'page_content_integrity_error',
              code: integrityCode,
            }),
          );
          for (const socket of document.connections.keys()) {
            socket.close(4409, 'page_content_integrity_error');
          }
        }
        if (context?.pageTemplateMutationId || integrityCode) {
          this.removeContributors(documentName, editingUserIds);
          throw err;
        }

        const code = this.getDatabaseErrorCode(err) ?? 'unknown';
        this.logger.error(
          `Failed to update page ${pageId}; code=${code}; attempt=${attempt}/${PersistenceExtension.STORE_ATTEMPTS}`,
        );
        if (
          !this.isRetryableDatabaseError(err) ||
          attempt === PersistenceExtension.STORE_ATTEMPTS
        ) {
          break;
        }
        await this.sleep(
          PersistenceExtension.STORE_RETRY_DELAYS_MS[attempt - 1],
        );
      }
    }

    if (persistenceError) {
      this.markDocumentDirty(data, backgroundRetry);
      return;
    }

    this.clearDocumentDirty(documentName);
    this.removeContributors(documentName, editingUserIds);

    if (page && !context?.pageTemplateSystemSyncRevision) {
      await this.runSuccessSideEffects(
        documentName,
        page,
        tiptapJson,
        editingUserIds,
      );
    }

    if (backgroundRetry) {
      setTimeout(() => {
        void data.instance.unloadDocument(document);
      }, 0);
    }
  }

  private async runSuccessSideEffects(
    documentName: string,
    page: Page,
    tiptapJson: unknown,
    editingUserIds: string[],
  ): Promise<void> {
    const pageId = page.id;

    try {
      await this.collabHistory.addContributors(pageId, editingUserIds);
    } catch (error) {
      this.restoreContributors(documentName, editingUserIds);
      this.logSideEffectFailure('contributors', pageId, error);
    }

    const mentions = extractMentions(tiptapJson);
    const pageMentions = extractPageMentions(mentions);

    try {
      await this.generalQueue.add(QueueJob.PAGE_BACKLINKS, {
        pageId,
        workspaceId: page.workspaceId,
        mentions: pageMentions,
      } as IPageBacklinkJob);
    } catch (error) {
      this.logSideEffectFailure('backlinks', pageId, error);
    }

    const userMentions = extractUserMentions(mentions);
    const oldMentions = page.content ? extractMentions(page.content) : [];
    const oldMentionedUserIds = extractUserMentions(oldMentions).map(
      (m) => m.entityId,
    );

    if (userMentions.length > 0) {
      try {
        await this.notificationQueue.add(QueueJob.PAGE_MENTION_NOTIFICATION, {
          userMentions: userMentions.map((m) => ({
            userId: m.entityId,
            mentionId: m.id,
            creatorId: m.creatorId,
          })),
          oldMentionedUserIds,
          pageId,
          spaceId: page.spaceId,
          workspaceId: page.workspaceId,
        } as IPageMentionNotificationJob);
      } catch (error) {
        this.logSideEffectFailure('mentions', pageId, error);
      }
    }

    try {
      await this.eventEmitter.emitAsync(EventName.PAGE_UPDATED, {
        pageIds: [pageId],
        workspaceId: page.workspaceId,
      });
    } catch (error) {
      this.logSideEffectFailure('page_updated', pageId, error);
    }

    try {
      await this.enqueuePageHistory(page);
    } catch (error) {
      this.logSideEffectFailure('history', pageId, error);
    }
  }

  async onChange(data: onChangePayload) {
    const documentName = data.documentName;
    const userId = data.context?.user?.id;

    if (!userId) return;

    if (!this.contributors.has(documentName)) {
      this.contributors.set(documentName, new Set());
    }

    this.contributors.get(documentName).add(userId);
  }

  async afterUnloadDocument(data: afterUnloadDocumentPayload) {
    const documentName = data.documentName;
    if (this.dirtyDocuments.has(documentName)) return;
    this.contributors.delete(documentName);
  }

  private peekContributors(documentName: string): string[] {
    const contributorSet = this.contributors.get(documentName);
    if (!contributorSet) return [];
    return [...contributorSet];
  }

  private removeContributors(documentName: string, userIds: string[]): void {
    const contributorSet = this.contributors.get(documentName);
    if (!contributorSet) return;
    for (const userId of userIds) contributorSet.delete(userId);
    if (contributorSet.size === 0) this.contributors.delete(documentName);
  }

  private restoreContributors(documentName: string, userIds: string[]): void {
    if (userIds.length === 0) return;
    const contributorSet = this.contributors.get(documentName) ?? new Set();
    for (const userId of userIds) contributorSet.add(userId);
    this.contributors.set(documentName, contributorSet);
  }

  private markDocumentDirty(
    data: onStoreDocumentPayload,
    backgroundRetry: boolean,
  ): void {
    const existing = this.dirtyDocuments.get(data.documentName);
    this.dirtyDocuments.set(data.documentName, {
      data,
      retryIndex: backgroundRetry
        ? Math.min(
            (existing?.retryIndex ?? 0) + 1,
            PersistenceExtension.DIRTY_RETRY_DELAYS_MS.length - 1,
          )
        : 0,
    });
    this.scheduleDirtyRetry(data.documentName);
  }

  private scheduleDirtyRetry(documentName: string): void {
    if (this.dirtyRetryTimers.has(documentName)) return;
    const dirty = this.dirtyDocuments.get(documentName);
    if (!dirty) return;
    const delay =
      PersistenceExtension.DIRTY_RETRY_DELAYS_MS[dirty.retryIndex] ??
      PersistenceExtension.DIRTY_RETRY_DELAYS_MS.at(-1);
    const timer = setTimeout(() => {
      this.dirtyRetryTimers.delete(documentName);
      const current = this.dirtyDocuments.get(documentName);
      if (!current) return;
      void current.data.document.saveMutex
        .runExclusive(() => this.storeDocument(current.data, true))
        .catch((error) => {
          this.logSideEffectFailure(
            'dirty_retry',
            getPageId(documentName),
            error,
          );
          this.markDocumentDirty(current.data, true);
        });
    }, delay);
    timer.unref?.();
    this.dirtyRetryTimers.set(documentName, timer);
  }

  private clearDocumentDirty(documentName: string): void {
    this.dirtyDocuments.delete(documentName);
    const timer = this.dirtyRetryTimers.get(documentName);
    if (timer) clearTimeout(timer);
    this.dirtyRetryTimers.delete(documentName);
  }

  private getDatabaseErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const cause = (error as { cause?: unknown }).cause;
    if (!cause || typeof cause !== 'object') return null;
    const causeCode = (cause as { code?: unknown }).code;
    return typeof causeCode === 'string' ? causeCode : null;
  }

  private isRetryableDatabaseError(error: unknown): boolean {
    const code = this.getDatabaseErrorCode(error);
    if (!code) return false;
    return (
      code === '40001' ||
      code === '40P01' ||
      code === '55P03' ||
      code === '53300' ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03' ||
      code.startsWith('08')
    );
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private logSideEffectFailure(
    effect: string,
    pageId: string,
    error: unknown,
  ): void {
    const code = this.getDatabaseErrorCode(error) ?? 'unknown';
    this.logger.error(
      `Collaboration persistence effect failed; effect=${effect}; pageId=${pageId}; code=${code}`,
    );
  }

  private async enqueuePageHistory(page: Page): Promise<void> {
    const pageAge = Date.now() - new Date(page.createdAt).getTime();
    const delay =
      pageAge < HISTORY_FAST_THRESHOLD
        ? HISTORY_FAST_INTERVAL
        : HISTORY_INTERVAL;

    await this.collabHistory.enqueuePageContentHistory(
      page.id,
      delay,
      HISTORY_MAX_INTERVAL,
    );
  }

  private async syncTransclusionState(
    pageId: string,
    workspaceId: string,
    tiptapJson: unknown,
    trx: Parameters<TransclusionService['syncPageTransclusions']>[3],
    pageTemplateMutationId?: string,
    graphLease?: PageEmbedGraphLease,
  ): Promise<void> {
    await this.transclusionService.syncPageTransclusions(
      pageId,
      workspaceId,
      tiptapJson,
      trx,
    );
    await this.transclusionService.syncPageReferences(
      pageId,
      workspaceId,
      tiptapJson,
      trx,
    );
    await this.pageEmbedService.syncPageReferences(
      pageId,
      workspaceId,
      tiptapJson,
      trx,
      pageTemplateMutationId,
      graphLease,
    );
  }

  private getContentIntegrityErrorCode(error: unknown): string | null {
    if (!(error instanceof HttpException)) {
      const message = (error as Error)?.message;
      return typeof message === 'string' &&
        (message.startsWith('page_embed_') ||
          message.startsWith('page_template_managed_'))
        ? message
        : null;
    }
    const response = error.getResponse();
    if (!response || typeof response !== 'object') return null;
    const code = (response as { code?: unknown }).code;
    return typeof code === 'string' &&
      (code.startsWith('page_embed_') ||
        code.startsWith('page_template_managed_'))
      ? code
      : null;
  }

  private async restorePersistedDocument(
    document: onStoreDocumentPayload['document'],
    pageId: string,
  ): Promise<void> {
    const persisted = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });
    if (!persisted) return;
    const fragment = document.getXmlFragment('default');
    document.transact(() => {
      if (fragment.length > 0) fragment.delete(0, fragment.length);
      const restored = TiptapTransformer.toYdoc(
        getProsemirrorContent(persisted.content),
        'default',
        tiptapExtensions,
      );
      Y.applyUpdate(document, Y.encodeStateAsUpdate(restored));
    }, 'page_embed_integrity_recovery');
  }
}
