import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../../integrations/storage/storage.service';
import { StorageObjectChangedError } from '../../../integrations/storage/interfaces/storage-driver.interface';
import { PageService } from '../../page/services/page.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import type {
  AiToolExecutionContext,
  AiToolExecutionResult,
} from './ai-tool-execution.types';
import {
  decodeReadCursor,
  encodeReadCursor,
  hashReadVersion,
  paginateReadText,
} from './ai-tool-read-pagination';

@Injectable()
export class AiAttachmentReadService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storage: StorageService,
    private readonly pages: PageService,
    private readonly pageAccess: PageAccessService,
    private readonly contentPolicy: AiContentPolicyService,
  ) {}

  private async readable(
    attachmentId: string,
    context: AiToolExecutionContext,
  ) {
    const attachment = await this.db
      .selectFrom('attachments')
      .selectAll()
      .where('id', '=', attachmentId)
      .where('workspaceId', '=', context.workspaceId)
      .where('spaceId', '=', context.spaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!attachment?.pageId)
      throw new NotFoundException('Attachment not found');
    const page = await this.pages.findById(attachment.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== context.workspaceId ||
      page.spaceId !== context.spaceId
    )
      throw new NotFoundException('Attachment not found');
    await this.pageAccess.assertCanReadPage(page, context.user);
    if (
      await this.contentPolicy.isPageExcluded(
        page.id,
        context.spaceId,
        context.workspaceId,
      )
    )
      throw new ForbiddenException('Page is excluded from AI access');
    return attachment;
  }

  private revision(
    attachment: Awaited<ReturnType<AiAttachmentReadService['readable']>>,
  ) {
    return hashReadVersion([
      attachment.id,
      attachment.pageId,
      attachment.spaceId,
      attachment.filePath,
      attachment.fileName,
      attachment.mimeType,
      String(attachment.fileSize),
      attachment.updatedAt,
      attachment.contentIndexStatus,
      attachment.contentIndexVersion,
      attachment.contentIndexedAt,
    ]);
  }

  private metadata(
    attachment: Awaited<ReturnType<AiAttachmentReadService['readable']>>,
  ) {
    return {
      attachmentId: attachment.id,
      pageId: attachment.pageId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileExt: attachment.fileExt,
      fileSize:
        attachment.fileSize === null ? null : String(attachment.fileSize),
    };
  }

  async text(
    attachmentId: string,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const attachment = await this.readable(attachmentId, context);
    const extension = attachment.fileExt
      ? attachment.fileExt.startsWith('.')
        ? attachment.fileExt
        : `.${attachment.fileExt}`
      : attachment.fileName;
    const supported = /\.(pdf|docx|txt|md)$/i.test(extension);
    const status = supported
      ? attachment.contentIndexStatus === 'ready' &&
        typeof attachment.textContent !== 'string'
        ? 'failed'
        : (attachment.contentIndexStatus ?? 'pending')
      : 'unsupported';
    const text =
      status === 'ready' && typeof attachment.textContent === 'string'
        ? attachment.textContent
        : '';
    const version = hashReadVersion([this.revision(attachment), text]);
    const content = paginateReadText(
      text,
      {
        ...this.metadata(attachment),
        version,
        status,
        extractionVersion: attachment.contentIndexVersion,
        errorCode:
          status === 'failed' ||
          (status === 'ready' && attachment.textContent === null)
            ? 'ATTACHMENT_TEXT_UNAVAILABLE'
            : null,
      },
      { tool: 'getAttachmentText', resource: attachmentId, version, cursor },
    );
    const current = await this.readable(attachmentId, context);
    if (
      hashReadVersion([
        this.revision(current),
        supported && current.contentIndexStatus === 'ready'
          ? (current.textContent ?? '')
          : '',
      ]) !== version
    )
      this.changed();
    return { content, dependencyPageIds: [attachment.pageId!] };
  }

  async file(
    attachmentId: string,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const attachment = await this.readable(attachmentId, context);
    const metadataVersion = this.revision(attachment);
    // The first bounded read discovers the current storage version without a separate public handle.
    let range;
    let offset = 0;
    try {
      range = await this.storage.readVersionedRange(attachment.filePath, 0, 1);
      const version = hashReadVersion([metadataVersion, range.version]);
      offset = decodeReadCursor(
        cursor,
        'getAttachmentFileChunk',
        attachmentId,
        version,
      );
      range = await this.storage.readVersionedRange(
        attachment.filePath,
        offset,
        16 * 1024,
        range.version,
      );
      if (
        attachment.fileSize !== null &&
        String(range.size) !== String(attachment.fileSize)
      )
        this.changed();
      const current = await this.readable(attachmentId, context);
      if (this.revision(current) !== metadataVersion) this.changed();
      const nextOffset = offset + range.data.length;
      return {
        content: {
          ...this.metadata(attachment),
          version,
          encoding: 'base64',
          offset,
          data: range.data.toString('base64'),
          totalBytes: range.size,
          nextCursor:
            nextOffset < range.size
              ? encodeReadCursor(
                  'getAttachmentFileChunk',
                  attachmentId,
                  version,
                  nextOffset,
                )
              : null,
          truncated: nextOffset < range.size,
        },
        dependencyPageIds: [attachment.pageId!],
      };
    } catch (error) {
      if (error instanceof StorageObjectChangedError) this.changed();
      if (error instanceof RangeError)
        throw new BadRequestException({
          code: 'MCP_INVALID_CURSOR',
          message: 'Invalid attachment range',
        });
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      throw new ServiceUnavailableException({
        code: 'MCP_STORAGE_UNAVAILABLE',
        message: 'Attachment storage is unavailable',
      });
    }
  }

  private changed(): never {
    throw new ConflictException({
      code: 'MCP_SOURCE_CHANGED',
      message: 'Attachment changed; restart reading',
    });
  }
}
