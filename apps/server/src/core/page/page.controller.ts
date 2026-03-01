import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { load } from 'cheerio';
import { PageService } from './services/page.service';
import { CreatePageDto } from './dto/create-page.dto';
import {
  UpdatePageCustomFieldsDto,
  UpdatePageDto,
} from './dto/update-page.dto';
import { MovePageDto, MovePageToSpaceDto } from './dto/move-page.dto';
import {
  DeletePageDto,
  PageHistoryIdDto,
  PageIdDto,
  PageInfoDto,
} from './dto/page.dto';
import { PageHistoryService } from './services/page-history.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { SidebarPageDto } from './dto/sidebar-page.dto';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { RecentPageDto } from './dto/recent-page.dto';
import { DuplicatePageDto } from './dto/duplicate-page.dto';
import { DeletedPageDto } from './dto/deleted-page.dto';
import { QuoteContentDto } from './dto/quote-content.dto';
import { LinkPreviewDto } from './dto/link-preview.dto';
import {
  jsonToHtml,
  jsonToMarkdown,
} from '../../collaboration/collaboration.util';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { TiptapTransformer } from '@hocuspocus/transformer';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageController {
  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly pageHistoryService: PageHistoryService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly collaborationGateway: CollaborationGateway,
  ) {}

  private getPageCustomFields(page: { settings?: unknown }) {
    const settings =
      page.settings && typeof page.settings === 'object'
        ? (page.settings as Record<string, unknown>)
        : {};

    return {
      status: settings.status ?? null,
      assigneeId: settings.assigneeId ?? null,
      stakeholderIds: Array.isArray(settings.stakeholderIds)
        ? settings.stakeholderIds
        : [],
    } as UpdatePageCustomFieldsDto;
  }


  /**
   * Extracts text from all text nodes marked with the given quote identifier.
   *
   * Returns merged plain text that is then displayed
   * in the target document as a synchronized embedded quote.
   */
  private extractQuoteTextFromContent(content: any, quoteId: string): string {
    const chunks: string[] = [];

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      if (node.type === 'text' && typeof node.text === 'string') {
        const hasQuoteMark = Array.isArray(node.marks)
          ? node.marks.some(
              (mark) =>
                mark?.type === 'quoteSource' && mark?.attrs?.quoteId === quoteId,
            )
          : false;

        if (hasQuoteMark) {
          chunks.push(node.text);
        }
      }

      if (Array.isArray(node.content)) {
        node.content.forEach(walk);
      }
    };

    walk(content);

    return chunks.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Reads the freshest source page content directly from the active Yjs document.
   *
   * This bypasses DB persistence debounce and allows linked quotes to react to
   * source edits almost immediately while users are collaboratively editing.
   */
  private async getLivePageContent(pageId: string, user: User): Promise<any | null> {
    const documentName = `page.${pageId}`;

    const connection = await this.collaborationGateway.openDirectConnection(
      documentName,
      { user },
    );

    try {
      let content: any = null;

      await connection.transact((doc) => {
        content = TiptapTransformer.fromYdoc(doc, 'default');
      });

      return content;
    } catch {
      return null;
    } finally {
      await connection.disconnect();
    }
  }

  private getAbsoluteUrl(baseUrl: string, value?: string): string | null {
    if (!value) {
      return null;
    }

    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return null;
    }
  }

  private getBestMetaContent(
    $: ReturnType<typeof load>,
    selectors: string[],
  ): string {
    for (const selector of selectors) {
      const value = $(selector).attr('content')?.trim();
      if (value) {
        return value;
      }
    }

    return '';
  }

  private getIconArea(sizeValue?: string): number {
    if (!sizeValue) {
      return 0;
    }

    const normalized = sizeValue.toLowerCase();
    if (normalized.includes('any')) {
      return Number.MAX_SAFE_INTEGER;
    }

    return normalized
      .split(/\s+/)
      .map((item) => item.trim())
      .reduce((maxArea, item) => {
        const match = item.match(/^(\d+)x(\d+)$/);
        if (!match) {
          return maxArea;
        }

        const width = Number(match[1]);
        const height = Number(match[2]);

        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          return maxArea;
        }

        return Math.max(maxArea, width * height);
      }, 0);
  }

  private getIconRelPriority(relValue?: string): number {
    if (!relValue) {
      return 0;
    }

    const relTokens = relValue
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (relTokens.includes('apple-touch-icon') || relTokens.includes('apple-touch-icon-precomposed')) {
      return 3;
    }

    if (relTokens.includes('icon') && relTokens.includes('shortcut')) {
      return 2;
    }

    if (relTokens.includes('icon')) {
      return 1;
    }

    if (relTokens.includes('mask-icon')) {
      return 1;
    }

    return 0;
  }

  private getBestFaviconUrl($: ReturnType<typeof load>, pageUrl: string): string {
    let bestUrl = '';
    let bestArea = -1;
    let bestPriority = -1;

    $('link[rel]').each((_, element) => {
      const rel = $(element).attr('rel')?.trim();
      const priority = this.getIconRelPriority(rel);

      if (priority === 0) {
        return;
      }

      const href = $(element).attr('href')?.trim();
      const absoluteHref = this.getAbsoluteUrl(pageUrl, href);
      if (!absoluteHref) {
        return;
      }

      const area = this.getIconArea($(element).attr('sizes')?.trim());
      const shouldReplace =
        area > bestArea || (area === bestArea && priority > bestPriority);

      if (!shouldReplace) {
        return;
      }

      bestArea = area;
      bestPriority = priority;
      bestUrl = absoluteHref;
    });

    return bestUrl;
  }

  @HttpCode(HttpStatus.OK)
  @Post('/info')
  async getPage(@Body() dto: PageInfoDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(dto.pageId, {
      includeSpace: true,
      includeContent: true,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    if (dto.format && dto.format !== 'json' && page.content) {
      const contentOutput =
        dto.format === 'markdown'
          ? jsonToMarkdown(page.content)
          : jsonToHtml(page.content);
      return {
        ...page,
        content: contentOutput,
        customFields: this.getPageCustomFields(page),
      };
    }

    return { ...page, customFields: this.getPageCustomFields(page) };
  }


  @HttpCode(HttpStatus.OK)
  @Post('/quote-content')
  async getQuoteContent(
    @Body() dto: QuoteContentDto,
    @AuthUser() user: User,
  ): Promise<{ text: string }> {
    const page = await this.pageRepo.findById(dto.sourcePageId, {
      includeContent: true,
    });

    if (!page) {
      throw new NotFoundException('Source page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const liveContent = await this.getLivePageContent(dto.sourcePageId, user);
    const sourceContent = liveContent ?? page.content;
    const text = this.extractQuoteTextFromContent(sourceContent, dto.quoteId);

    if (!text) {
      throw new NotFoundException('Quote content not found');
    }

    return { text };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/link-preview')
  async getLinkPreview(@Body() dto: LinkPreviewDto) {
    let sourceUrl: URL;

    try {
      sourceUrl = new URL(dto.url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
      throw new BadRequestException('Only HTTP and HTTPS URLs are supported');
    }

    const response = await fetch(sourceUrl.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; DocmostBot/1.0; +https://docmost.com)',
        accept: 'text/html,application/xhtml+xml',
      },
    }).catch(() => {
      throw new BadRequestException('Failed to fetch URL metadata');
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to fetch URL metadata');
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new BadRequestException('URL does not point to an HTML document');
    }

    const html = await response.text();
    const $ = load(html);
    const finalUrl = response.url || sourceUrl.toString();
    const title =
      this.getBestMetaContent($, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) ||
      $('title').first().text().trim() ||
      sourceUrl.hostname;
    const description = this.getBestMetaContent($, [
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]);
    const image = this.getAbsoluteUrl(
      finalUrl,
      this.getBestMetaContent($, [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="twitter:image"]',
      ]),
    );
    const favicon = this.getBestFaviconUrl($, finalUrl);

    return {
      url: finalUrl,
      title,
      description,
      image: image || favicon || null,
      siteName:
        this.getBestMetaContent($, [
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
        ]) || sourceUrl.hostname,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() createPageDto: CreatePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(
      user,
      createPageDto.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const page = await this.pageService.create(
      user.id,
      workspace.id,
      createPageDto,
    );

    if (
      createPageDto.format &&
      createPageDto.format !== 'json' &&
      page.content
    ) {
      const contentOutput =
        createPageDto.format === 'markdown'
          ? jsonToMarkdown(page.content)
          : jsonToHtml(page.content);
      return { ...page, content: contentOutput };
    }

    return page;
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(@Body() updatePageDto: UpdatePageDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(updatePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const updatedPage = await this.pageService.update(
      page,
      updatePageDto,
      user,
    );

    if (
      updatePageDto.format &&
      updatePageDto.format !== 'json' &&
      updatedPage.content
    ) {
      const contentOutput =
        updatePageDto.format === 'markdown'
          ? jsonToMarkdown(updatedPage.content)
          : jsonToHtml(updatedPage.content);
      return {
        ...updatedPage,
        content: contentOutput,
        customFields: this.getPageCustomFields(updatedPage),
      };
    }

    return { ...updatedPage, customFields: this.getPageCustomFields(updatedPage) };
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(
    @Body() deletePageDto: DeletePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(deletePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);

    if (deletePageDto.permanentlyDelete) {
      // Permanent deletion requires space admin permissions
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
        throw new ForbiddenException(
          'Only space admins can permanently delete pages',
        );
      }
      await this.pageService.forceDelete(deletePageDto.pageId, workspace.id);
    } else {
      // Soft delete requires page manage permissions
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
      await this.pageService.removePage(
        deletePageDto.pageId,
        user.id,
        workspace.id,
      );
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('restore')
  async restore(
    @Body() pageIdDto: PageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(pageIdDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    await this.pageRepo.restorePage(pageIdDto.pageId, workspace.id);

    return this.pageRepo.findById(pageIdDto.pageId, {
      includeHasChildren: true,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('recent')
  async getRecentPages(
    @Body() recentPageDto: RecentPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    if (recentPageDto.spaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        recentPageDto.spaceId,
      );

      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.getRecentSpacePages(
        recentPageDto.spaceId,
        pagination,
      );
    }

    return this.pageService.getRecentPages(user.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('trash')
  async getDeletedPages(
    @Body() deletedPageDto: DeletedPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    if (deletedPageDto.spaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        deletedPageDto.spaceId,
      );

      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.getDeletedSpacePages(
        deletedPageDto.spaceId,
        pagination,
      );
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('/history')
  async getPageHistory(
    @Body() dto: PageIdDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.pageHistoryService.findHistoryByPageId(page.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/history/info')
  async getPageHistoryInfo(
    @Body() dto: PageHistoryIdDto,
    @AuthUser() user: User,
  ) {
    const history = await this.pageHistoryService.findById(dto.historyId);
    if (!history) {
      throw new NotFoundException('Page history not found');
    }

    const ability = await this.spaceAbility.createForUser(
      user,
      history.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    return history;
  }

  @HttpCode(HttpStatus.OK)
  @Post('/sidebar-pages')
  async getSidebarPages(
    @Body() dto: SidebarPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    if (!dto.spaceId && !dto.pageId) {
      throw new BadRequestException(
        'Either spaceId or pageId must be provided',
      );
    }
    let spaceId = dto.spaceId;

    if (dto.pageId) {
      const page = await this.pageRepo.findById(dto.pageId);
      if (!page) {
        throw new ForbiddenException();
      }

      spaceId = page.spaceId;
    }

    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const sidebarPages = await this.pageService.getSidebarPages(
      spaceId,
      pagination,
      dto.pageId,
    );

    return {
      ...sidebarPages,
      items: sidebarPages.items.map((page) => ({
        ...page,
        customFields: this.getPageCustomFields(page),
      })),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('move-to-space')
  async movePageToSpace(
    @Body() dto: MovePageToSpaceDto,
    @AuthUser() user: User,
  ) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage) {
      throw new NotFoundException('Page to move not found');
    }
    if (movedPage.spaceId === dto.spaceId) {
      throw new BadRequestException('Page is already in this space');
    }

    const abilities = await Promise.all([
      this.spaceAbility.createForUser(user, movedPage.spaceId),
      this.spaceAbility.createForUser(user, dto.spaceId),
    ]);

    if (
      abilities.some((ability) =>
        ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page),
      )
    ) {
      throw new ForbiddenException();
    }

    return this.pageService.movePageToSpace(movedPage, dto.spaceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('duplicate')
  async duplicatePage(@Body() dto: DuplicatePageDto, @AuthUser() user: User) {
    const copiedPage = await this.pageRepo.findById(dto.pageId);
    if (!copiedPage) {
      throw new NotFoundException('Page to copy not found');
    }

    // If spaceId is provided, it's a copy to different space
    if (dto.spaceId) {
      const abilities = await Promise.all([
        this.spaceAbility.createForUser(user, copiedPage.spaceId),
        this.spaceAbility.createForUser(user, dto.spaceId),
      ]);

      if (
        abilities.some((ability) =>
          ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page),
        )
      ) {
        throw new ForbiddenException();
      }

      return this.pageService.duplicatePage(copiedPage, dto.spaceId, user);
    } else {
      // If no spaceId, it's a duplicate in same space
      const ability = await this.spaceAbility.createForUser(
        user,
        copiedPage.spaceId,
      );
      if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.duplicatePage(copiedPage, undefined, user);
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('move')
  async movePage(@Body() dto: MovePageDto, @AuthUser() user: User) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage) {
      throw new NotFoundException('Moved page not found');
    }

    const ability = await this.spaceAbility.createForUser(
      user,
      movedPage.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.pageService.movePage(dto, movedPage);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/breadcrumbs')
  async getPageBreadcrumbs(@Body() dto: PageIdDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    return this.pageService.getPageBreadCrumbs(page.id);
  }
}
