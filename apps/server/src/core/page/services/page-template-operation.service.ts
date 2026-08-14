import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { v7 as uuid7 } from 'uuid';
import type { User } from '@docmost/db/types/entity.types';
import type {
  KyselyDB,
  KyselyTransaction,
} from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { strictJsonToNode } from '../../../collaboration/collaboration.util';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { getAttachmentIds } from '../../../common/helpers/prosemirror/utils';
import { materializePageContent } from '../transclusion/utils/page-embed-materialize.util';
import { rewriteAttachmentsForUnsync } from '../transclusion/utils/transclusion-unsync.util';
import type { PageEmbedGraphLease } from '../transclusion/page-embed-graph-lock.service';

export type PageTemplateOperationKind =
  | 'snapshot'
  | 'embed_insert'
  | 'embed_detach'
  | 'template_sync'
  | 'template_detach'
  | 'legacy_embed_migration';

const OPERATION_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class PageTemplateOperationService {
  constructor(
    @InjectKysely()
    private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
  ) {}

  async beginOperation(
    kind: PageTemplateOperationKind,
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

  findOperation(kind: PageTemplateOperationKind, key: string, user: User) {
    return this.db
      .selectFrom('pageTemplateOperations')
      .selectAll()
      .where('workspaceId', '=', user.workspaceId)
      .where('requestedById', '=', user.id)
      .where('operationKind', '=', kind)
      .where('idempotencyKey', '=', key)
      .executeTakeFirst();
  }

  async findCompletedOperation(
    kind: PageTemplateOperationKind,
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

  findCompletedDetach(
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

  async completeOperation(
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

  async completeOperationInTransaction(
    trx: KyselyTransaction,
    id: string,
    leaseToken: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const completed = await trx
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
      .where('status', '=', 'pending')
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', new Date())
      .returning('id')
      .executeTakeFirst();
    if (!completed) {
      throw this.conflict(
        'page_template_operation_lease_lost',
        'The page template operation lease was lost',
      );
    }
  }

  async claimCreatedPageFinalization(
    operationId: string,
  ): Promise<string | null> {
    const leaseToken = uuid7();
    const claimed = await this.db
      .updateTable('pageTemplateOperations')
      .set({
        errorCode: 'page_template_finalization_pending',
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where('id', '=', operationId)
      .where('operationKind', '=', 'snapshot')
      .where('status', '=', 'completed')
      .where('afterContentHash', 'is', null)
      .where((eb) =>
        eb.or([
          eb('leaseToken', 'is', null),
          eb('leaseExpiresAt', 'is', null),
          eb('leaseExpiresAt', '<=', new Date()),
        ]),
      )
      .returning('id')
      .executeTakeFirst();
    return claimed ? leaseToken : null;
  }

  async completeCreatedPageFinalization(
    operationId: string,
    leaseToken: string,
    pageContent: unknown,
  ): Promise<boolean> {
    const completed = await this.db
      .updateTable('pageTemplateOperations')
      .set({
        afterContentHash: hashProseMirrorJson(pageContent as any),
        errorCode: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', operationId)
      .where('operationKind', '=', 'snapshot')
      .where('status', '=', 'completed')
      .where('afterContentHash', 'is', null)
      .where('leaseToken', '=', leaseToken)
      .returning('id')
      .executeTakeFirst();
    return Boolean(completed);
  }

  async releaseCreatedPageFinalization(
    operationId: string,
    leaseToken: string,
  ): Promise<void> {
    await this.db
      .updateTable('pageTemplateOperations')
      .set({
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', operationId)
      .where('operationKind', '=', 'snapshot')
      .where('status', '=', 'completed')
      .where('afterContentHash', 'is', null)
      .where('leaseToken', '=', leaseToken)
      .execute();
  }

  async failOperation(id: string, code: string, leaseToken?: string) {
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

  async stageMaterializedContent(
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
    const staged = await this.db
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
      .returning('id')
      .executeTakeFirst();
    if (!staged) {
      throw this.conflict(
        'page_template_operation_lease_lost',
        'The page template operation lease was lost',
      );
    }
    return rewritten;
  }

  async stageCreatedPageContent(
    operationId: string,
    leaseToken: string,
    content: unknown,
    attachmentMapping: Array<{
      oldAttachmentId: string;
      newAttachmentId: string;
    }>,
  ): Promise<void> {
    const staged = await this.db
      .updateTable('pageTemplateOperations')
      .set({
        stagedContent: content as any,
        attachmentMapping: attachmentMapping as any,
        leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where('id', '=', operationId)
      .where('status', '=', 'pending')
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', new Date())
      .returning('id')
      .executeTakeFirst();
    if (!staged) {
      throw this.conflict(
        'page_template_operation_lease_lost',
        'The page template operation lease was lost',
      );
    }
  }

  async stageAttachmentMapping(
    operationId: string,
    leaseToken: string,
    attachmentMapping: Array<{
      oldAttachmentId: string;
      newAttachmentId: string;
    }>,
  ): Promise<void> {
    await this.db
      .updateTable('pageTemplateOperations')
      .set({
        attachmentMapping: attachmentMapping as any,
        leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where('id', '=', operationId)
      .where('status', '=', 'pending')
      .where('leaseToken', '=', leaseToken)
      .executeTakeFirstOrThrow();
  }

  async assertOperationLease(
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

  async ownsOperationLease(
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

  readAttachmentMapping(value: unknown): Array<{
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

  assertIdempotencyKey(key: string): void {
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'idempotency_key_required',
        message: 'A valid Idempotency-Key header is required',
      });
    }
  }

  hashRequest(request: unknown): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }

  encodePageCursor(row: { updatedAt: Date | string; id: string }): string {
    return this.encodeVersionedCursor({
      version: 1,
      type: 'page',
      updatedAt: new Date(row.updatedAt).toISOString(),
      id: row.id,
    });
  }

  decodePageCursor(cursor?: string): { updatedAt: Date; id: string } | null {
    if (!cursor) return null;
    const parsed = this.decodeVersionedCursor(cursor);
    const updatedAt =
      typeof parsed.updatedAt === 'string'
        ? new Date(parsed.updatedAt)
        : new Date(Number.NaN);
    if (
      parsed.version !== 1 ||
      parsed.type !== 'page' ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      Number.isNaN(updatedAt.getTime())
    ) {
      throw new BadRequestException('Invalid cursor');
    }
    return { updatedAt, id: parsed.id };
  }

  encodeRevisionCursor(row: { revision: number; id: string }): string {
    return this.encodeVersionedCursor({
      version: 1,
      type: 'revision',
      revision: row.revision,
      id: row.id,
    });
  }

  decodeRevisionCursor(
    cursor?: string,
  ): { revision: number; id: string } | null {
    if (!cursor) return null;
    const parsed = this.decodeVersionedCursor(cursor);
    if (
      parsed.version !== 1 ||
      parsed.type !== 'revision' ||
      !Number.isSafeInteger(parsed.revision) ||
      Number(parsed.revision) < 0 ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new BadRequestException('Invalid cursor');
    }
    return { revision: Number(parsed.revision), id: parsed.id };
  }

  private encodeVersionedCursor(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private decodeVersionedCursor(cursor: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }

  errorCode(error: unknown): string {
    const response =
      error && typeof error === 'object' && 'getResponse' in error
        ? (error as any).getResponse()
        : undefined;
    const code = response?.code;
    return typeof code === 'string' &&
      code.length <= 120 &&
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(code)
      ? code
      : 'page_template_operation_failed';
  }

  async releaseGraphLease(
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

  private containsNodeType(input: unknown, type: string): boolean {
    if (!input || typeof input !== 'object') return false;
    if ((input as any).type === type) return true;
    return (
      Array.isArray((input as any).content) &&
      (input as any).content.some((child: unknown) =>
        this.containsNodeType(child, type),
      )
    );
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

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
