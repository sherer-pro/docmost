import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace, Space } from '@docmost/db/types/entity.types';
import { FastifyReply } from 'fastify';
import { sanitize } from 'sanitize-filename-ts';
import { validate as isValidUuid } from 'uuid';
import { RagService } from './rag.service';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { ApiKeyTrafficGuard } from '../api-key/traffic/api-key-traffic.guard';
import { ApiKeyTraffic } from '../api-key/traffic/api-key-traffic.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthSpace } from '../../common/decorators/auth-space.decorator';
import {
  RagDatabaseIdentifierParamsDto,
  RagBlockedPagesQueryDto,
  RagDatabaseRowsQueryDto,
  RagDeletedQueryDto,
  RagDictionaryTermParamsDto,
  RagListPagesQueryDto,
  RagPageExportQueryDto,
  RagPageIdentifierParamsDto,
  RagPageInfoQueryDto,
  RagSpaceExportQueryDto,
  RagUpdatesQueryDto,
} from './dto/rag.dto';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { StorageService } from '../../integrations/storage/storage.service';

@ApiKeyTraffic('rag')
@UseGuards(ApiKeyAuthGuard, ApiKeyTrafficGuard)
@Controller('rag')
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly storageService: StorageService,
  ) {}

  private buildScope(user: User, workspace: Workspace, space: Space) {
    return { user, workspace, space };
  }

  @SkipTransform()
  @Get('scope')
  async getScope(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getScope(this.buildScope(user, workspace, space));
  }

  @SkipTransform()
  @Get('scope/blocked')
  async getBlockedPages(
    @Query() query: RagBlockedPagesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getBlockedPages(
      this.buildScope(user, workspace, space),
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('pages')
  async listPages(
    @Query() query: RagListPagesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.listPages(
      this.buildScope(user, workspace, space),
      query.includeContent,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('updates')
  async getUpdates(
    @Query() query: RagUpdatesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getUpdates(
      this.buildScope(user, workspace, space),
      query.updatedSince,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('deleted')
  async getDeleted(
    @Query() query: RagDeletedQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getDeleted(
      this.buildScope(user, workspace, space),
      query.deletedSince,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('dictionary/terms')
  async listDictionaryTerms(
    @Query() query: RagBlockedPagesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.listDictionaryTerms(
      this.buildScope(user, workspace, space),
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('dictionary/terms/:termId')
  async getDictionaryTerm(
    @Param() params: RagDictionaryTermParamsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getDictionaryTerm(
      this.buildScope(user, workspace, space),
      params.termId,
    );
  }

  @SkipTransform()
  @Get('dictionary/updates')
  async getDictionaryUpdates(
    @Query() query: RagUpdatesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getDictionaryUpdates(
      this.buildScope(user, workspace, space),
      query.updatedSince,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('dictionary/deleted')
  async getDictionaryDeleted(
    @Query() query: RagDeletedQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getDictionaryDeleted(
      this.buildScope(user, workspace, space),
      query.deletedSince,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('attachments/updates')
  async getAttachmentUpdates(
    @Query() query: RagUpdatesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getAttachmentUpdates(
      this.buildScope(user, workspace, space),
      query.updatedSince,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('attachments/deleted')
  async getAttachmentDeleted(
    @Query() query: RagDeletedQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getAttachmentDeleted(
      this.buildScope(user, workspace, space),
      query.deletedSince,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @SkipTransform()
  @Get('databases/:databaseIdOrPageSlug')
  async getDatabaseInfo(
    @Param() params: RagDatabaseIdentifierParamsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getDatabaseInfo(
      this.buildScope(user, workspace, space),
      params.databaseIdOrPageSlug,
    );
  }

  @SkipTransform()
  @Get('databases/:databaseIdOrPageSlug/rows')
  async getDatabaseRows(
    @Param() params: RagDatabaseIdentifierParamsDto,
    @Query() query: RagDatabaseRowsQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getDatabaseRows(
      this.buildScope(user, workspace, space),
      params.databaseIdOrPageSlug,
      query.pageIds,
    );
  }

  @SkipTransform()
  @Get('pages/:pageIdOrSlug/attachments')
  async getPageAttachments(
    @Param() params: RagPageIdentifierParamsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getPageAttachments(
      this.buildScope(user, workspace, space),
      params.pageIdOrSlug,
    );
  }

  @SkipTransform()
  @Get('pages/:pageIdOrSlug/comments')
  async getPageComments(
    @Param() params: RagPageIdentifierParamsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getComments(
      this.buildScope(user, workspace, space),
      params.pageIdOrSlug,
    );
  }

  @SkipTransform()
  @Get('pages/:pageIdOrSlug/export')
  async exportPage(
    @Param() params: RagPageIdentifierParamsDto,
    @Query() query: RagPageExportQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
    @Res() res: FastifyReply,
  ) {
    const exported = await this.ragService.exportPage(
      this.buildScope(user, workspace, space),
      params.pageIdOrSlug,
      {
        format: query.format,
        includeAttachments: query.includeAttachments,
        includeChildren: query.includeChildren,
      },
    );

    const fileName = `${sanitize(exported.page.title || 'untitled')}.zip`;

    res.headers({
      'Content-Type': 'application/zip',
      'Content-Disposition':
        'attachment; filename="' + encodeURIComponent(fileName) + '"',
    });

    res.send(exported.stream);
  }

  @SkipTransform()
  @Get('space/export')
  async exportSpace(
    @Query() query: RagSpaceExportQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
    @Res() res: FastifyReply,
  ) {
    const exported = await this.ragService.exportSpace(
      this.buildScope(user, workspace, space),
      {
        format: query.format,
        includeAttachments: query.includeAttachments,
      },
    );

    res.headers({
      'Content-Type': 'application/zip',
      'Content-Disposition':
        'attachment; filename="' +
        encodeURIComponent(sanitize(exported.fileName)) +
        '"',
    });

    res.send(exported.fileStream);
  }

  @SkipTransform()
  @Get('pages/:pageIdOrSlug')
  async getPageInfo(
    @Param() params: RagPageIdentifierParamsDto,
    @Query() query: RagPageInfoQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
  ) {
    return this.ragService.getPageInfo(
      this.buildScope(user, workspace, space),
      params.pageIdOrSlug,
      query.includeContent,
    );
  }

  @SkipTransform()
  @Get('attachments/:fileId/:fileName')
  async downloadAttachment(
    @Param('fileId') fileId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
    @Res() res: FastifyReply,
  ) {
    if (!isValidUuid(fileId)) {
      throw new NotFoundException('File not found');
    }

    const attachment = await this.ragService.resolveAttachmentForDownload(
      this.buildScope(user, workspace, space),
      fileId,
    );

    let fileStream = null;
    try {
      fileStream = await this.storageService.readStream(attachment.filePath);
    } catch {
      throw new NotFoundException('File not found');
    }

    const fileSize = Number(attachment.fileSize);

    res.headers({
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition':
        'attachment; filename="' +
        encodeURIComponent(attachment.fileName) +
        '"',
      'Cache-Control': 'private, max-age=3600',
    });

    if (fileSize) {
      res.header('Content-Length', fileSize);
    }

    res.send(fileStream);
  }
}
