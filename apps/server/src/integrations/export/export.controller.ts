import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ExportService } from './export.service';
import {
  CopyMarkdownWithCommentsDto,
  ExportFormat,
  ExportPageDto,
  ExportSpaceDto,
} from './dto/export-dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { FastifyReply, FastifyRequest } from 'fastify';
import { sanitize } from 'sanitize-filename-ts';
import { PageAccessService } from '../../core/page-access/page-access.service';
import { CopyMarkdownWithCommentsService } from './copy-markdown-with-comments.service';
import { normalizeUserSettings } from '../../core/user/utils/user-preferences.util';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { createExportRequestLifetime } from './export-request-lifetime';

/**
 * Shared service layer for export controllers.
 * Extracted so that resource-oriented `pages` and `spaces` controllers
 * reuse the same business logic without duplicating access checks.
 */
class ExportControllerDelegate {
  constructor(
    private readonly exportService: ExportService,
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async exportPage(
    dto: ExportPageDto,
    user: User,
    res: FastifyReply,
    req?: FastifyRequest,
  ) {
    const requestLifetime =
      dto.format === ExportFormat.Docmost
        ? createExportRequestLifetime(req, res)
        : null;

    try {
      const page = await this.pageRepo.findById(dto.pageId, {
        includeContent: true,
      });

      if (!page || page.deletedAt) {
        throw new NotFoundException('Page not found');
      }

      await this.pageAccessService.assertCanReadPage(page, user);

      if (page.parentPageId == null) {
        await this.spaceAbility.assertHasFullSpaceAccess(user, page.spaceId);
      }

      const zipFileStream = await this.exportService.exportPages(
        dto.pageId,
        dto.format,
        dto.includeAttachments,
        dto.includeChildren,
        user.locale,
        normalizeUserSettings(user.settings).preferences
          .headingNumberingByPageId,
        // Only the root page is authorized above; the service filters descendants
        // through the page access rules.
        user,
        undefined,
        requestLifetime?.signal,
      );

      const fileName = sanitize(page.title || 'untitled') + '.zip';

      res.headers({
        'Content-Type': 'application/zip',
        'Content-Disposition':
          'attachment; filename="' + encodeURIComponent(fileName) + '"',
      });

      requestLifetime?.attachToStream(zipFileStream);
      res.send(zipFileStream);
    } catch (error) {
      requestLifetime?.cleanup();
      throw error;
    }
  }

  async exportSpace(
    dto: ExportSpaceDto,
    user: User,
    res: FastifyReply,
    req?: FastifyRequest,
  ) {
    const requestLifetime =
      dto.format === ExportFormat.Docmost
        ? createExportRequestLifetime(req, res)
        : null;

    try {
      await this.spaceAbility.assertHasFullSpaceAccess(user, dto.spaceId);

      const exportFile = await this.exportService.exportSpace(
        dto.spaceId,
        dto.format,
        dto.includeAttachments,
        user.locale,
        normalizeUserSettings(user.settings).preferences
          .headingNumberingByPageId,
        undefined,
        user,
        requestLifetime?.signal,
      );

      res.headers({
        'Content-Type': 'application/zip',
        'Content-Disposition':
          'attachment; filename="' +
          encodeURIComponent(sanitize(exportFile.fileName)) +
          '"',
      });

      requestLifetime?.attachToStream(exportFile.fileStream);
      res.send(exportFile.fileStream);
    } catch (error) {
      requestLifetime?.cleanup();
      throw error;
    }
  }
}

@Controller('pages')
export class PageExportController {
  private readonly delegate: ExportControllerDelegate;

  constructor(
    private readonly exportService: ExportService,
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    private readonly copyMarkdownWithCommentsService: CopyMarkdownWithCommentsService,
  ) {
    this.delegate = new ExportControllerDelegate(
      this.exportService,
      this.pageRepo,
      this.spaceAbility,
      this.pageAccessService,
    );
  }

  /**
   * New command-style endpoint.
   */
  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('page', { source: 'body', key: 'pageId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/export')
  async exportPageAction(
    @Body() dto: ExportPageDto,
    @AuthUser() user: User,
    @Res() res: FastifyReply,
    @Req() req?: FastifyRequest,
  ) {
    return this.delegate.exportPage(dto, user, res, req);
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('page', { source: 'body', key: 'pageId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/copy-markdown-with-comments')
  async copyMarkdownWithCommentsAction(
    @Body() dto: CopyMarkdownWithCommentsDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(dto.pageId, {
      includeContent: true,
    });

    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);
    this.pageAccessService.assertCanManageAccess(user, page.workspaceId);

    const markdown = await this.copyMarkdownWithCommentsService.build(
      page,
      user,
      user.locale,
    );

    return { markdown };
  }
}

@Controller('spaces')
export class SpaceExportController {
  private readonly delegate: ExportControllerDelegate;

  constructor(
    private readonly exportService: ExportService,
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
  ) {
    this.delegate = new ExportControllerDelegate(
      this.exportService,
      this.pageRepo,
      this.spaceAbility,
      this.pageAccessService,
    );
  }

  /**
   * New command-style endpoint.
   */
  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/export')
  async exportSpaceAction(
    @Body() dto: ExportSpaceDto,
    @AuthUser() user: User,
    @Res() res: FastifyReply,
    @Req() req?: FastifyRequest,
  ) {
    return this.delegate.exportSpace(dto, user, res, req);
  }
}
