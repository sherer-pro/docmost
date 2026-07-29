import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { MultipartFile } from '@fastify/multipart';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiChatFile as AiChatFileEntity,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import {
  AiChatFile,
  AiCitation,
  AiFileUploadBatch,
  AiListResponse,
} from '@docmost/api-contract';
import { StorageService } from '../../../integrations/storage/storage.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import {
  SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  resolveTrustedMimeType,
  validateFileExtensionAndSignature,
} from '../../../common/helpers/file-validation';
import { prepareFile } from '../../attachment/attachment.utils';
import {
  AI_ALLOWED_CHAT_FILE_EXTENSIONS,
  AI_ALLOWED_CHAT_FILE_MIME_TYPES,
  AI_CHAT_LIMITS,
} from '../ai.constants';
import { AiProviderMessage } from '../ai.types';
import { AiConversationService } from './ai-conversation.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { AiOperationalMetricsService } from './ai-operational-metrics.service';

type FileContext = {
  text: string;
  images: Array<{ type: 'image_url'; image_url: { url: string } }>;
  citations: Array<Omit<AiCitation, 'id' | 'messageId' | 'position'>>;
};

@Injectable()
export class AiFileService {
  private readonly logger = new Logger(AiFileService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.AI_CHAT_QUEUE)
    private readonly queue: Queue,
    private readonly storage: StorageService,
    private readonly conversations: AiConversationService,
    private readonly pageAccessService: PageAccessService,
    private readonly metrics: AiOperationalMetricsService,
  ) {}

  async list(
    conversationId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiListResponse<AiChatFile>> {
    await this.conversations.getOwnedEntity(conversationId, user, workspace);
    const rows = await this.db
      .selectFrom('aiChatFiles')
      .selectAll()
      .where('conversationId', '=', conversationId)
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
    return { items: rows.map((row) => this.toFile(row)) };
  }

  async listPageAttachments(
    pageId: string,
    user: User,
    workspace: Workspace,
  ) {
    const page = await this.conversations.assertWritablePage(
      pageId,
      user,
      workspace.id,
    );
    const items = await this.db
      .selectFrom('attachments')
      .select(['id', 'fileName', 'mimeType', 'fileSize'])
      .where('pageId', '=', page.id)
      .where('spaceId', '=', page.spaceId)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          size: Number(row.fileSize ?? 0),
        })),
      );
    return { items };
  }

  async upload(
    conversationId: string,
    multipartFiles: AsyncIterableIterator<MultipartFile>,
    idempotencyKey: string | undefined,
    user: User,
    workspace: Workspace,
  ): Promise<AiFileUploadBatch> {
    if (
      !idempotencyKey ||
      idempotencyKey.length > 128 ||
      !/^[A-Za-z0-9._-]+$/.test(idempotencyKey)
    ) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    const conversation = await this.conversations.getOwnedEntity(
      conversationId,
      user,
      workspace,
    );
    const prepared: Array<{
      name: string;
      mimeType: string;
      size: number;
      buffer: Buffer;
      sha256: string;
    }> = [];
    let preparedBytes = 0;
    for await (const file of multipartFiles) {
      if (file.type !== 'file') {
        continue;
      }
      if (
        prepared.length >= AI_CHAT_LIMITS.maxFilesPerConversation
      ) {
        throw new BadRequestException('Too many AI chat files');
      }
      const item = await prepareFile(Promise.resolve(file));
      const extension = path.extname(item.fileName).toLowerCase();
      const mimeAllowed =
        AI_ALLOWED_CHAT_FILE_MIME_TYPES.has(item.mimeType) ||
        (extension === '.md' &&
          ['text/plain', 'application/octet-stream'].includes(item.mimeType));
      if (
        item.fileSize <= 0 ||
        item.fileSize > AI_CHAT_LIMITS.maxFileBytes ||
        !item.buffer ||
        !mimeAllowed
      ) {
        throw new BadRequestException(SAFE_FILE_VALIDATION_ERROR_MESSAGE);
      }
      await validateFileExtensionAndSignature({
        fileName: item.fileName,
        fileBuffer: item.buffer,
        allowedExtensions: [...AI_ALLOWED_CHAT_FILE_EXTENSIONS],
        safeErrorMessage: SAFE_FILE_VALIDATION_ERROR_MESSAGE,
      });
      if (
        preparedBytes + item.fileSize >
        AI_CHAT_LIMITS.maxConversationFileBytes
      ) {
        throw new BadRequestException('AI chat file quota exceeded');
      }
      prepared.push({
        name: item.fileName,
        mimeType: resolveTrustedMimeType({
          fileExtension: item.fileExtension,
          fileBuffer: item.buffer,
          fallbackMimeType: item.mimeType,
        }),
        size: item.fileSize,
        buffer: item.buffer,
        sha256: createHash('sha256').update(item.buffer).digest('hex'),
      });
      preparedBytes += item.fileSize;
    }
    if (prepared.length === 0) {
      throw new BadRequestException('No files provided');
    }
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          prepared.map((file) => ({
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            sha256: file.sha256,
          })),
        ),
      )
      .digest('hex');

    const reservation = await this.db.transaction().execute(async (trx) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`ai-file-upload:${conversation.id}`}, 0)
        )
      `.execute(trx);
      const existingBatch = await trx
        .selectFrom('aiFileUploadBatches')
        .selectAll()
        .where('conversationId', '=', conversation.id)
        .where('idempotencyKey', '=', idempotencyKey)
        .executeTakeFirst();
      if (existingBatch) {
        if (existingBatch.requestFingerprint !== requestFingerprint) {
          throw new ConflictException({
            code: 'idempotency_key_reused',
            message:
              'The idempotency key was already used for another upload',
          });
        }
        const rows = await trx
          .selectFrom('aiChatFiles')
          .selectAll()
          .where('uploadBatchId', '=', existingBatch.id)
          .orderBy('uploadOrdinal', 'asc')
          .execute();
        return { batch: existingBatch, rows, existing: true };
      }

      const usage = await trx
        .selectFrom('aiChatFiles')
        .select((eb) => [
          eb.fn.countAll<number>().as('count'),
          eb.fn.sum<number>('size').as('size'),
        ])
        .where('conversationId', '=', conversation.id)
        .where('deletedAt', 'is', null)
        .executeTakeFirstOrThrow();
      const totalBytes =
        Number(usage.size ?? 0) +
        prepared.reduce((sum, file) => sum + file.size, 0);
      if (
        Number(usage.count) + prepared.length >
          AI_CHAT_LIMITS.maxFilesPerConversation ||
        totalBytes > AI_CHAT_LIMITS.maxConversationFileBytes
      ) {
        throw new BadRequestException('AI chat file quota exceeded');
      }

      const batchId = uuidv7();
      const batch = await trx
        .insertInto('aiFileUploadBatches')
        .values({
          id: batchId,
          conversationId: conversation.id,
          userId: user.id,
          workspaceId: workspace.id,
          idempotencyKey,
          requestFingerprint,
          status: 'processing',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const rows = await trx
        .insertInto('aiChatFiles')
        .values(
          prepared.map((file, ordinal) => {
            const id = uuidv7();
            return {
              id,
              conversationId: conversation.id,
              userId: user.id,
              workspaceId: workspace.id,
              spaceId: conversation.spaceId,
              uploadBatchId: batchId,
              uploadOrdinal: ordinal,
              contentSha256: file.sha256,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              storageKey: `${workspace.id}/ai-chat/${conversation.id}/${id}/${file.name}`,
              status: 'pending',
            };
          }),
        )
        .returningAll()
        .execute();
      return { batch, rows, existing: false };
    });

    if (reservation.existing) {
      return this.toUploadBatch(reservation.batch, reservation.rows);
    }

    this.metrics.observeFileLifecycle('upload_started');
    const uploaded: AiChatFileEntity[] = [];
    try {
      for (const [index, row] of reservation.rows.entries()) {
        await this.storage.upload(row.storageKey, prepared[index].buffer);
        uploaded.push(row);
      }
      const now = new Date();
      const rows = await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('aiChatFiles')
          .set({ uploadedAt: now, updatedAt: now })
          .where('uploadBatchId', '=', reservation.batch.id)
          .execute();
        await trx
          .updateTable('aiFileUploadBatches')
          .set({ status: 'completed', updatedAt: now })
          .where('id', '=', reservation.batch.id)
          .execute();
        return trx
          .selectFrom('aiChatFiles')
          .selectAll()
          .where('uploadBatchId', '=', reservation.batch.id)
          .orderBy('uploadOrdinal', 'asc')
          .execute();
      });
      for (const row of rows) {
        await this.enqueueExtraction(row.id);
      }
      this.metrics.observeFileLifecycle('upload_completed');
      return this.toUploadBatch(
        { ...reservation.batch, status: 'completed', updatedAt: now },
        rows,
      );
    } catch {
      this.metrics.observeFileLifecycle('upload_failed');
      const now = new Date();
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('aiChatFiles')
          .set({ deletedAt: now, updatedAt: now })
          .where('uploadBatchId', '=', reservation.batch.id)
          .execute();
        await trx
          .updateTable('aiFileUploadBatches')
          .set({
            status: 'failed',
            errorCode: 'ai_file_upload_failed',
            updatedAt: now,
          })
          .where('id', '=', reservation.batch.id)
          .execute();
      });
      await Promise.allSettled(
        uploaded.map((row) => this.storage.delete(row.storageKey)),
      );
      throw new ServiceUnavailableException({
        code: 'ai_file_upload_failed',
        message: 'AI chat files could not be uploaded',
      });
    }
  }

  async remove(
    conversationId: string,
    fileId: string,
    user: User,
    workspace: Workspace,
  ) {
    await this.conversations.getOwnedEntity(conversationId, user, workspace);
    const file = await this.db
      .selectFrom('aiChatFiles')
      .selectAll()
      .where('id', '=', fileId)
      .where('conversationId', '=', conversationId)
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();
    if (!file) throw new NotFoundException('AI chat file not found');
    if (file.deletedAt) return { success: true };
    const now = new Date();
    await this.db
      .updateTable('aiChatFiles')
      .set({ deletedAt: now, updatedAt: now })
      .where('id', '=', file.id)
      .where('deletedAt', 'is', null)
      .execute();
    this.metrics.observeFileLifecycle('delete_tombstoned');
    await this.cleanupDeletedFile(file.id);
    return { success: true };
  }

  async readForDownload(
    conversationId: string,
    fileId: string,
    user: User,
    workspace: Workspace,
  ) {
    await this.conversations.getOwnedEntity(conversationId, user, workspace);
    const file = await this.getOwnedFile(
      fileId,
      conversationId,
      user.id,
      workspace.id,
    );
    return { file, stream: await this.storage.readStream(file.storageKey) };
  }

  async extract(fileId: string): Promise<void> {
    const now = new Date();
    const file = await this.db
      .updateTable('aiChatFiles')
      .set({
        status: 'processing',
        extractionStartedAt: now,
        error: null,
        updatedAt: now,
      })
      .where('id', '=', fileId)
      .where('status', '=', 'pending')
      .where('uploadedAt', 'is not', null)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!file) return;
    this.metrics.observeFileLifecycle('extraction_started');
    try {
      const buffer = await this.storage.read(file.storageKey);
      const extension = path.extname(file.name).toLowerCase();
      let text: string | null = null;
      if (extension === '.txt' || extension === '.md') {
        text = buffer.toString('utf8');
      } else if (extension === '.docx') {
        const mammoth = await import('mammoth');
        text = (await mammoth.extractRawText({ buffer })).value;
      } else if (extension === '.pdf') {
        text = await this.extractPdfText(buffer);
      }
      const ready = await this.db
        .updateTable('aiChatFiles')
        .set({
          status: 'ready',
          extractedText: text
            ? text.slice(0, AI_CHAT_LIMITS.maxExtractedTextChars)
            : null,
          error: null,
          extractionStartedAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', file.id)
        .where('status', '=', 'processing')
        .where('deletedAt', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (ready) {
        this.metrics.observeFileLifecycle('extraction_ready');
      }
    } catch (error) {
      this.metrics.observeFileLifecycle('extraction_failed');
      this.logger.warn(`AI chat file extraction failed: ${file.id}`);
      await this.db
        .updateTable('aiChatFiles')
        .set({
          status: 'failed',
          error: 'file_extraction_failed',
          extractionStartedAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', file.id)
        .where('status', '=', 'processing')
        .where('deletedAt', 'is', null)
        .execute();
      throw error;
    }
  }

  async buildContext(
    chatFileIds: string[],
    attachmentIds: string[],
    params: {
      conversationId: string;
      userId: string;
      workspaceId: string;
      spaceId: string;
      visionEnabled: boolean;
      maxTextChars: number;
      maxImageBytes: number;
    },
  ): Promise<FileContext> {
    const chatFiles = chatFileIds.length
      ? await this.db
          .selectFrom('aiChatFiles')
          .selectAll()
          .where('id', 'in', chatFileIds)
          .where('conversationId', '=', params.conversationId)
          .where('userId', '=', params.userId)
          .where('workspaceId', '=', params.workspaceId)
          .where('status', '=', 'ready')
          .where('deletedAt', 'is', null)
          .execute()
      : [];
    let attachments = attachmentIds.length
      ? await this.db
          .selectFrom('attachments')
          .selectAll()
          .where('id', 'in', attachmentIds)
          .where('workspaceId', '=', params.workspaceId)
          .where('spaceId', '=', params.spaceId)
          .where('deletedAt', 'is', null)
          .execute()
      : [];
    if (attachments.length > 0) {
      const user = await this.db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', params.userId)
        .where('workspaceId', '=', params.workspaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      if (!user) {
        attachments = [];
      } else {
        const snapshot =
          await this.pageAccessService.getSidebarAccessSnapshot(
            user as User,
            params.spaceId,
          );
        attachments = attachments.filter(
          (attachment) =>
            attachment.pageId &&
            snapshot.readablePageIds.has(attachment.pageId),
        );
      }
    }
    const textParts: string[] = [];
    const images: FileContext['images'] = [];
    const citations: FileContext['citations'] = [];
    let remainingTextChars = params.maxTextChars;
    let remainingImageBytes = params.maxImageBytes;
    const appendText = (label: string, value: string) => {
      if (remainingTextChars <= 0) return false;
      const block = `${label}\n${value}`.slice(0, remainingTextChars);
      if (!block.trim()) return false;
      textParts.push(block);
      remainingTextChars -= block.length;
      return true;
    };

    for (const file of chatFiles) {
      const buffer =
        params.visionEnabled &&
        (file.mimeType.startsWith('image/') ||
          (file.mimeType === 'application/pdf' && !file.extractedText))
          ? await this.storage.read(file.storageKey)
          : null;
      if (file.extractedText) {
        if (
          !appendText(`Chat file "${file.name}":`, file.extractedText)
        ) {
          continue;
        }
      } else if (buffer && file.mimeType.startsWith('image/')) {
        if (buffer.length > remainingImageBytes) continue;
        images.push(this.toImagePart(buffer, file.mimeType));
        remainingImageBytes -= buffer.length;
      } else if (buffer && file.mimeType === 'application/pdf') {
        const rendered = await this.renderPdfImages(
          buffer,
          remainingImageBytes,
        );
        if (rendered.length === 0) continue;
        images.push(...rendered.images);
        remainingImageBytes -= rendered.bytes;
      } else {
        continue;
      }
      citations.push({
        sourceType: 'chat_file',
        sourceId: file.id,
        pageId: null,
        sourceTitle: file.name,
        sourceUrl: null,
        excerpt: file.extractedText?.slice(0, 2000) ?? null,
        relevanceScore: null,
      });
    }

    for (const file of attachments) {
      if (file.textContent) {
        if (
          !appendText(`Attachment "${file.fileName}":`, file.textContent)
        ) {
          continue;
        }
      } else if (params.visionEnabled && file.mimeType?.startsWith('image/')) {
        const buffer = await this.storage.read(file.filePath);
        if (buffer.length > remainingImageBytes) continue;
        images.push(this.toImagePart(buffer, file.mimeType));
        remainingImageBytes -= buffer.length;
      } else if (
        params.visionEnabled &&
        file.mimeType === 'application/pdf'
      ) {
        const buffer = await this.storage.read(file.filePath);
        const rendered = await this.renderPdfImages(
          buffer,
          remainingImageBytes,
        );
        if (rendered.length === 0) continue;
        images.push(...rendered.images);
        remainingImageBytes -= rendered.bytes;
      } else {
        continue;
      }
      citations.push({
        sourceType: 'attachment',
        sourceId: file.id,
        pageId: file.pageId,
        sourceTitle: file.fileName,
        sourceUrl: null,
        excerpt: file.textContent?.slice(0, 2000) ?? null,
        relevanceScore: null,
      });
    }
    return { text: textParts.join('\n\n'), images, citations };
  }

  async cleanupConversationFiles(
    conversationId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const now = new Date();
    await this.db
      .updateTable('aiChatFiles')
      .set({ deletedAt: now, updatedAt: now })
      .where('conversationId', '=', conversationId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
    const rows = await this.db
      .selectFrom('aiChatFiles')
      .select('id')
      .where('conversationId', '=', conversationId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is not', null)
      .where('storageDeletedAt', 'is', null)
      .execute();
    const results = await Promise.all(rows.map((row) => this.cleanupDeletedFile(row.id)));
    return results.every(Boolean);
  }

  async cleanupRetention(): Promise<void> {
    const configs = await this.db
      .selectFrom('aiSpaceConfigs')
      .select(['workspaceId', 'spaceId', 'retentionDays'])
      .execute();
    for (const config of configs) {
      const cutoff = new Date(
        Date.now() - config.retentionDays * 24 * 60 * 60 * 1000,
      );
      while (true) {
        const conversations = await this.db
          .selectFrom('aiConversations')
          .select('id')
          .where('workspaceId', '=', config.workspaceId)
          .where('spaceId', '=', config.spaceId)
          .where('updatedAt', '<', cutoff)
          .where('deletedAt', 'is', null)
          .limit(500)
          .execute();
        if (conversations.length === 0) break;
        const ids = conversations.map((conversation) => conversation.id);
        const now = new Date();
        await this.db.transaction().execute(async (trx) => {
          await trx
            .updateTable('aiRuns')
            .set({
              status: 'cancelled',
              sequence: sql`sequence + 1`,
              cancelRequestedAt: now,
              completedAt: now,
              finishReason: 'cancelled',
              updatedAt: now,
            })
            .where('conversationId', 'in', ids)
            .where('status', 'in', ['queued', 'running'])
            .execute();
          await trx
            .updateTable('aiChatFiles')
            .set({ deletedAt: now, updatedAt: now })
            .where('conversationId', 'in', ids)
            .where('deletedAt', 'is', null)
            .execute();
          await trx
            .updateTable('aiConversations')
            .set({ deletedAt: now, updatedAt: now })
            .where('id', 'in', ids)
            .execute();
        });
        if (conversations.length < 500) break;
      }

      await this.cleanupDeletedFiles(500);
      while (true) {
        const removable = await this.db
          .selectFrom('aiConversations as c')
          .select('c.id')
          .where('c.workspaceId', '=', config.workspaceId)
          .where('c.spaceId', '=', config.spaceId)
          .where('c.deletedAt', 'is not', null)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('aiChatFiles as f')
                  .select('f.id')
                  .whereRef('f.conversationId', '=', 'c.id')
                  .where('f.storageDeletedAt', 'is', null),
              ),
            ),
          )
          .limit(500)
          .execute();
        if (removable.length === 0) break;
        await this.db
          .deleteFrom('aiConversations')
          .where('id', 'in', removable.map((row) => row.id))
          .execute();
        if (removable.length < 500) break;
      }
    }
  }

  async enqueueExtraction(fileId: string): Promise<boolean> {
    try {
      await this.queue.add(
        QueueJob.AI_CHAT_FILE_EXTRACT,
        { fileId },
        {
          jobId: `ai-file-extract-${fileId}`,
          attempts: 2,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  async recoverStaleExtractions(): Promise<string[]> {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const stale = await this.db
      .updateTable('aiChatFiles')
      .set({
        status: 'pending',
        extractionStartedAt: null,
        updatedAt: new Date(),
      })
      .where('status', '=', 'processing')
      .where('extractionStartedAt', '<', staleBefore)
      .where('deletedAt', 'is', null)
      .returning('id')
      .execute();
    return stale.map((row) => row.id);
  }

  async cleanupDeletedFiles(limit = 100): Promise<number> {
    const rows = await this.db
      .selectFrom('aiChatFiles')
      .select('id')
      .where('deletedAt', 'is not', null)
      .where('storageDeletedAt', 'is', null)
      .limit(limit)
      .execute();
    const results = await Promise.all(
      rows.map((row) => this.cleanupDeletedFile(row.id)),
    );
    return results.filter(Boolean).length;
  }

  async cleanupDeletedFile(fileId: string): Promise<boolean> {
    const file = await this.db
      .selectFrom('aiChatFiles')
      .select(['id', 'storageKey'])
      .where('id', '=', fileId)
      .where('deletedAt', 'is not', null)
      .where('storageDeletedAt', 'is', null)
      .executeTakeFirst();
    if (!file) return true;
    try {
      await this.storage.delete(file.storageKey);
      await this.db
        .updateTable('aiChatFiles')
        .set({ storageDeletedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', file.id)
        .where('storageDeletedAt', 'is', null)
        .execute();
      this.metrics.observeFileLifecycle('storage_deleted');
      return true;
    } catch {
      this.logger.warn(`AI chat file cleanup failed: ${file.id}`);
      return false;
    }
  }

  async pendingExtractionIds(limit = 100): Promise<string[]> {
    const rows = await this.db
      .selectFrom('aiChatFiles')
      .select('id')
      .where('status', '=', 'pending')
      .where('uploadedAt', 'is not', null)
      .where('deletedAt', 'is', null)
      .limit(limit)
      .execute();
    return rows.map((row) => row.id);
  }

  private toUploadBatch(
    batch: {
      id: string;
      conversationId: string;
      status: string;
      errorCode: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    rows: AiChatFileEntity[],
  ): AiFileUploadBatch {
    return {
      id: batch.id,
      conversationId: batch.conversationId,
      status: batch.status as AiFileUploadBatch['status'],
      errorCode: batch.errorCode,
      files: rows.map((row) => this.toFile(row)),
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    };
  }

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
    const parts: string[] = [];
    const pages = Math.min(document.numPages, 20);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
          .join(' '),
      );
    }
    const text = parts.join('\n\n').trim();
    return text || null;
  }

  private async renderPdfImages(
    buffer: Buffer,
    maxBytes: number,
  ): Promise<{ images: FileContext['images']; bytes: number; length: number }> {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const canvasModule: any = await import('@napi-rs/canvas');
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
    const result: FileContext['images'] = [];
    let totalBytes = 0;
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(document.numPages, 20);
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = canvasModule.createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;
      const image = canvas.toBuffer('image/png');
      if (
        totalBytes + image.length >
        Math.min(maxBytes, 10 * 1024 * 1024)
      ) {
        break;
      }
      totalBytes += image.length;
      result.push(this.toImagePart(image, 'image/png'));
    }
    return { images: result, bytes: totalBytes, length: result.length };
  }

  private toImagePart(
    buffer: Buffer,
    mimeType: string,
  ): FileContext['images'][number] {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${buffer.toString('base64')}`,
      },
    };
  }

  private async getOwnedFile(
    fileId: string,
    conversationId: string,
    userId: string,
    workspaceId: string,
  ) {
    const file = await this.db
      .selectFrom('aiChatFiles')
      .selectAll()
      .where('id', '=', fileId)
      .where('conversationId', '=', conversationId)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!file) throw new NotFoundException('AI chat file not found');
    return file;
  }

  private toFile(row: AiChatFileEntity): AiChatFile {
    return {
      id: row.id,
      conversationId: row.conversationId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      name: row.name,
      mimeType: row.mimeType,
      size: Number(row.size),
      status: row.status as AiChatFile['status'],
      error: row.error,
      uploadBatchId: row.uploadBatchId,
      uploadedAt: row.uploadedAt?.toISOString() ?? null,
      storageDeletedAt: row.storageDeletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
