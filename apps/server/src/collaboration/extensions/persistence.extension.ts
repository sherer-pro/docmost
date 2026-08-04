import {
  afterUnloadDocumentPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as Y from 'yjs';
import { HttpException, Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class PersistenceExtension implements Extension {
  private readonly logger = new Logger(PersistenceExtension.name);
  private contributors: Map<string, Set<string>> = new Map();

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
    const editingUserIds = this.consumeContributors(documentName);
    let graphLease: PageEmbedGraphLease | undefined;

    try {
      const preflightPage = await this.pageRepo.findById(pageId);
      if (preflightPage) {
        graphLease = await this.pageEmbedService.acquireGraphLeaseForContent(
          preflightPage.workspaceId,
          tiptapJson,
        );
      }
      await executeTx(this.db, async (trx) => {
        page = await this.pageRepo.findById(pageId, {
          withLock: true,
          includeContent: true,
          trx,
        });

        if (!page) {
          this.logger.error(`Page with id ${pageId} not found`);
          return;
        }

        if (isDeepStrictEqual(tiptapJson, page.content)) {
          page = null;
          return;
        }

        let contributorIds = undefined;
        try {
          const existingContributors = page.contributorIds || [];
          contributorIds = Array.from(
            new Set([...existingContributors, ...editingUserIds, page.creatorId]),
          );
        } catch (err) {
          //this.logger.debug('Contributors error:' + err?.['message']);
        }

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
          page.workspaceId,
          tiptapJson,
          trx,
          context?.pageTemplateMutationId,
          graphLease,
        );

        if (context?.pageTemplateMutationId) {
          await trx
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
            .execute();
        }

        this.logger.debug(`Page updated: ${pageId} - SlugId: ${page.slugId}`);
      });
    } catch (err) {
      this.logger.error(`Failed to update page ${pageId}`, err);
      page = null;
      const integrityCode = this.getPageEmbedIntegrityErrorCode(err);
      if (integrityCode && !context?.pageTemplateMutationId) {
        await this.restorePersistedDocument(document, pageId);
        document.broadcastStateless(
          JSON.stringify({
            type: 'page_embed_integrity_error',
            code: integrityCode,
          }),
        );
        for (const socket of document.connections.keys()) {
          socket.close(4409, 'page_embed_integrity_error');
        }
      }
      if (context?.pageTemplateMutationId || integrityCode) {
        throw err;
      }
    } finally {
      if (graphLease) {
        try {
          await graphLease.release();
        } catch (error) {
          this.logger.error(
            `Failed to release page embed graph lease for ${pageId}`,
            error as Error,
          );
        }
      }
    }

    if (page) {
      await this.collabHistory.addContributors(pageId, editingUserIds);

      const mentions = extractMentions(tiptapJson);
      const pageMentions = extractPageMentions(mentions);

      await this.generalQueue.add(QueueJob.PAGE_BACKLINKS, {
        pageId: pageId,
        workspaceId: page.workspaceId,
        mentions: pageMentions,
      } as IPageBacklinkJob);

      const userMentions = extractUserMentions(mentions);
      const oldMentions = page.content ? extractMentions(page.content) : [];
      const oldMentionedUserIds = extractUserMentions(oldMentions).map((m) => m.entityId);

      if (userMentions.length > 0) {
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
      }

      await this.eventEmitter.emitAsync(EventName.PAGE_UPDATED, {
        pageIds: [pageId],
        workspaceId: page.workspaceId,
      });

      await this.enqueuePageHistory(page);
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
    this.contributors.delete(documentName);
  }

  private consumeContributors(documentName: string): string[] {
    const contributorSet = this.contributors.get(documentName);
    if (!contributorSet) return [];
    const userIds = [...contributorSet];
    this.contributors.delete(documentName);
    return userIds;
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

  private getPageEmbedIntegrityErrorCode(error: unknown): string | null {
    if (!(error instanceof HttpException)) {
      const message = (error as Error)?.message;
      return typeof message === 'string' && message.startsWith('page_embed_')
        ? message
        : null;
    }
    const response = error.getResponse();
    if (!response || typeof response !== 'object') return null;
    const code = (response as { code?: unknown }).code;
    return typeof code === 'string' && code.startsWith('page_embed_')
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
