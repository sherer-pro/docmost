import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuid7 } from 'uuid';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import type { Page, User } from '@docmost/db/types/entity.types';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { strictJsonToNode } from '../../../collaboration/collaboration.util';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageEmbedService } from '../transclusion/page-embed.service';
import { PageTemplatePolicyService } from '../transclusion/page-template-policy.service';
import {
  DetachPageEmbedDto,
  InsertPageEmbedDto,
} from '../dto/page-template.dto';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';

@Injectable()
export class PageEmbedCommandService {
  constructor(
    private readonly pageAccessService: PageAccessService,
    private readonly policy: PageTemplatePolicyService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    private readonly content: PageTemplateContentService,
    private readonly operations: PageTemplateOperationService,
  ) {}

  async insertPageEmbed(
    dto: InsertPageEmbedDto,
    idempotencyKey: string,
    user: User,
  ) {
    this.operations.assertIdempotencyKey(idempotencyKey);
    const completedOperation = await this.operations.findCompletedOperation(
      'embed_insert',
      idempotencyKey,
      user,
      dto,
    );
    if (completedOperation) {
      const completedConsumer = await this.content.requirePlainDocument(
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
      this.content.requirePlainDocument(dto.consumerPageId, user.workspaceId),
      this.content.requireTemplateSource(dto.sourcePageId, user),
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
    const operation = await this.operations.beginOperation(
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
      const current = await this.content.getLiveContent(consumer.id, user);
      const recovered = this.findPageEmbed(current, operation.referenceNodeId);
      if (recovered?.sourcePageId === source.id) {
        const afterContentHash = hashProseMirrorJson(current as any);
        await this.operations.completeOperation(
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
      await this.operations.assertOperationLease(
        operation.id,
        operation.leaseToken,
      );
      const result = await this.content.applyMutation(
        consumer.id,
        current,
        next,
        dto.baseContentHash,
        operation.id,
        operation.leaseToken,
        user,
      );
      await this.operations.completeOperation(
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
      if (
        await this.operations.ownsOperationLease(
          operation.id,
          operation.leaseToken,
        )
      ) {
        await this.operations.failOperation(
          operation.id,
          this.operations.errorCode(error),
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
    this.operations.assertIdempotencyKey(idempotencyKey);
    const consumer = await this.content.requirePlainDocument(
      dto.consumerPageId,
      user.workspaceId,
    );
    await this.pageAccessService.assertCanWritePage(consumer, user);
    const current = await this.content.getLiveContent(consumer.id, user);
    const currentHash = hashProseMirrorJson(current as any);
    const located = this.findPageEmbed(current, dto.referenceNodeId);
    const existingOperation = await this.operations.findOperation(
      'embed_detach',
      idempotencyKey,
      user,
    );
    if (!located) {
      const completed =
        existingOperation?.status === 'completed'
          ? existingOperation
          : await this.operations.findCompletedDetach(
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
        await this.operations.completeOperation(existingOperation.id, {
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
    const source = await this.content.findReadablePlainDocument(
      located.sourcePageId,
      user,
    );
    const operation = await this.operations.beginOperation(
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
              copies: this.operations.readAttachmentMapping(
                operation.attachmentMapping,
              ),
            }
          : await this.operations.stageMaterializedContent(
              operation.id,
              operation.leaseToken,
              await this.content.getLiveContent(source.id, user),
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
      const rows = await this.content.copyAttachments(
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
      await this.operations.assertOperationLease(
        operation.id,
        operation.leaseToken,
      );
      const result = await this.content.applyMutation(
        consumer.id,
        current,
        next,
        dto.baseContentHash,
        operation.id,
        operation.leaseToken,
        user,
      );
      await this.operations.completeOperation(
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
        await Promise.allSettled(
          insertedAttachmentIds.map((id) =>
            this.attachmentRepo.deleteAttachmentById(id),
          ),
        );
        await Promise.allSettled(
          copiedPaths.map((path) => this.storageService.delete(path)),
        );
      }
      const completed = await this.operations.findCompletedDetach(
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
    const doc = strictJsonToNode(content as any);
    const sources = new Set<string>();
    doc.descendants((node) => {
      if (node.type.name === 'pageEmbed') {
        const sourcePageId = node.attrs.sourcePageId;
        if (typeof sourcePageId === 'string') sources.add(sourcePageId);
      }
      return true;
    });
    return [...sources];
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
