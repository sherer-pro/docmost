import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { load } from 'cheerio';
import { PageService } from './services/page.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
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
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import {
  mapPageCustomFields,
  mapPageResponse,
} from './mappers/page-response.mapper';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { PageAccessService } from '../page-access/page-access.service';
import { PageRole } from '../../common/helpers/types/permission';
import {
  ClosePageGroupAccessDto,
  ClosePageUserAccessDto,
  GrantPageGroupAccessDto,
  GrantPageUserAccessDto,
} from './dto/page-access.dto';

const LINK_PREVIEW_TIMEOUT_MS = 7000;
const LINK_PREVIEW_MAX_REDIRECTS = 5;
const LINK_PREVIEW_MAX_RESPONSE_BYTES = 1_000_000;
const LINK_PREVIEW_BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
];

function buildLinkPreviewBlockList(): BlockList {
  const blockList = new BlockList();

  // Private, local, and non-routable IPv4 ranges.
  blockList.addSubnet('0.0.0.0', 8, 'ipv4');
  blockList.addSubnet('10.0.0.0', 8, 'ipv4');
  blockList.addSubnet('100.64.0.0', 10, 'ipv4');
  blockList.addSubnet('127.0.0.0', 8, 'ipv4');
  blockList.addSubnet('169.254.0.0', 16, 'ipv4');
  blockList.addSubnet('172.16.0.0', 12, 'ipv4');
  blockList.addSubnet('192.0.0.0', 24, 'ipv4');
  blockList.addSubnet('192.0.2.0', 24, 'ipv4');
  blockList.addSubnet('192.88.99.0', 24, 'ipv4');
  blockList.addSubnet('192.168.0.0', 16, 'ipv4');
  blockList.addSubnet('198.18.0.0', 15, 'ipv4');
  blockList.addSubnet('198.51.100.0', 24, 'ipv4');
  blockList.addSubnet('203.0.113.0', 24, 'ipv4');
  blockList.addSubnet('224.0.0.0', 4, 'ipv4');
  blockList.addSubnet('240.0.0.0', 4, 'ipv4');
  blockList.addAddress('255.255.255.255', 'ipv4');

  // Local and reserved IPv6 ranges.
  blockList.addAddress('::', 'ipv6');
  blockList.addAddress('::1', 'ipv6');
  blockList.addSubnet('fc00::', 7, 'ipv6');
  blockList.addSubnet('fe80::', 10, 'ipv6');
  blockList.addSubnet('ff00::', 8, 'ipv6');
  blockList.addSubnet('2001:db8::', 32, 'ipv6');

  return blockList;
}

const LINK_PREVIEW_BLOCKLIST = buildLinkPreviewBlockList();

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageController {
  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly pageHistoryService: PageHistoryService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly collaborationGateway: CollaborationGateway,
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

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
                mark?.type === 'quoteSource' &&
                mark?.attrs?.quoteId === quoteId,
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
  private async getLivePageContent(
    pageId: string,
    user: User,
  ): Promise<any | null> {
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

  private async fetchLinkPreviewHtml(
    sourceUrl: URL,
  ): Promise<{ finalUrl: URL; html: string }> {
    let currentUrl = new URL(sourceUrl.toString());

    for (let hop = 0; hop <= LINK_PREVIEW_MAX_REDIRECTS; hop += 1) {
      await this.assertPublicUrl(currentUrl);

      const response = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; DocmostBot/1.0; +https://docmost.com)',
          accept: 'text/html,application/xhtml+xml',
        },
      }).catch(() => {
        throw new BadRequestException('Failed to fetch URL metadata');
      });

      if (this.isRedirectResponse(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new BadRequestException('Failed to fetch URL metadata');
        }

        try {
          currentUrl = new URL(location, currentUrl);
        } catch {
          throw new BadRequestException('Failed to fetch URL metadata');
        }

        continue;
      }

      if (!response.ok) {
        throw new BadRequestException('Failed to fetch URL metadata');
      }

      const contentType =
        response.headers.get('content-type')?.toLowerCase() ?? '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        throw new BadRequestException('URL does not point to an HTML document');
      }

      const html = await this.readResponseTextWithLimit(
        response,
        LINK_PREVIEW_MAX_RESPONSE_BYTES,
      );

      return { finalUrl: currentUrl, html };
    }

    throw new BadRequestException('Too many redirects');
  }

  private async assertPublicUrl(url: URL): Promise<void> {
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Only HTTP and HTTPS URLs are supported');
    }

    if (this.isBlockedHostname(url.hostname)) {
      throw new BadRequestException('Unsafe target URL');
    }

    const hostIpVersion = isIP(url.hostname);
    if (hostIpVersion !== 0) {
      if (this.isBlockedIpAddress(url.hostname)) {
        throw new BadRequestException('Unsafe target URL');
      }

      return;
    }

    const resolvedAddresses = await lookup(url.hostname, {
      all: true,
      verbatim: true,
    }).catch(() => {
      throw new BadRequestException('Failed to resolve URL hostname');
    });

    if (resolvedAddresses.length === 0) {
      throw new BadRequestException('Failed to resolve URL hostname');
    }

    if (
      resolvedAddresses.some((entry) => this.isBlockedIpAddress(entry.address))
    ) {
      throw new BadRequestException('Unsafe target URL');
    }
  }

  private isBlockedHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/\.$/, '');
    return (
      normalized === 'localhost' ||
      LINK_PREVIEW_BLOCKED_HOST_SUFFIXES.some((suffix) =>
        normalized.endsWith(suffix),
      )
    );
  }

  private isBlockedIpAddress(address: string): boolean {
    const normalized = this.normalizeIpAddress(address);

    if (normalized.toLowerCase().startsWith('::ffff:')) {
      const mappedIpv4 = normalized.slice('::ffff:'.length);
      if (isIP(mappedIpv4) === 4) {
        return this.isBlockedIpAddress(mappedIpv4);
      }
    }

    const family = isIP(normalized);
    if (family === 0) {
      return true;
    }

    return LINK_PREVIEW_BLOCKLIST.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
  }

  private normalizeIpAddress(address: string): string {
    return address.replace(/^\[|\]$/g, '').split('%')[0];
  }

  private isRedirectResponse(statusCode: number): boolean {
    return [301, 302, 303, 307, 308].includes(statusCode);
  }

  private async readResponseTextWithLimit(
    response: Response,
    maxBytes: number,
  ): Promise<string> {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new BadRequestException('URL metadata response is too large');
    }

    if (!response.body) {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new BadRequestException('URL metadata response is too large');
      }

      return text;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BadRequestException('URL metadata response is too large');
      }

      chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks).toString('utf8');
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

    if (
      relTokens.includes('apple-touch-icon') ||
      relTokens.includes('apple-touch-icon-precomposed')
    ) {
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

  private getBestFaviconUrl(
    $: ReturnType<typeof load>,
    pageUrl: string,
  ): string {
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

  private toAccessResponse(access: {
    role: PageRole | null;
    sources: string[];
    capabilities: {
      canRead: boolean;
      canWrite: boolean;
      canCreateChild: boolean;
      canMoveDeleteShare: boolean;
      canManageAccess: boolean;
    };
    isSystemAccess: boolean;
  }) {
    return {
      role: access.role,
      sources: access.sources,
      capabilities: access.capabilities,
      isSystemAccess: access.isSystemAccess,
    };
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

    const effectiveAccess = await this.pageAccessService.assertCanReadPage(
      page,
      user,
    );

    const linkedDatabase = await this.databaseRepo.findByPageId(
      page.id,
      page.workspaceId,
    );

    if (dto.format && dto.format !== 'json' && page.content) {
      const contentOutput =
        dto.format === 'markdown'
          ? jsonToMarkdown(page.content)
          : jsonToHtml(page.content);
      return {
        ...mapPageResponse(page, { includeCustomFields: true }),
        databaseId: linkedDatabase?.id ?? null,
        content: contentOutput,
        access: this.toAccessResponse(effectiveAccess),
      };
    }

    return {
      ...mapPageResponse(page, { includeCustomFields: true }),
      databaseId: linkedDatabase?.id ?? null,
      access: this.toAccessResponse(effectiveAccess),
    };
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

    await this.pageAccessService.assertCanReadPage(page, user);

    const liveContent = await this.getLivePageContent(page.id, user);
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

    const { finalUrl, html } = await this.fetchLinkPreviewHtml(sourceUrl);
    const $ = load(html);
    const finalUrlString = finalUrl.toString();
    const title =
      this.getBestMetaContent($, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) ||
      $('title').first().text().trim() ||
      finalUrl.hostname;
    const description = this.getBestMetaContent($, [
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]);
    const image = this.getAbsoluteUrl(
      finalUrlString,
      this.getBestMetaContent($, [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="twitter:image"]',
      ]),
    );
    const favicon = this.getBestFaviconUrl($, finalUrlString);

    return {
      url: finalUrlString,
      title,
      description,
      image: image || favicon || null,
      siteName:
        this.getBestMetaContent($, [
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
        ]) || finalUrl.hostname,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() createPageDto: CreatePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (createPageDto.parentPageId) {
      const parentPage = await this.pageRepo.findById(createPageDto.parentPageId);
      if (!parentPage || parentPage.deletedAt) {
        throw new NotFoundException('Parent page not found');
      }
      if (parentPage.spaceId !== createPageDto.spaceId) {
        throw new BadRequestException('Parent page not found');
      }
      await this.pageAccessService.assertCanCreateChild(parentPage, user);
    } else {
      const ability = await this.spaceAbility.createForUser(
        user,
        createPageDto.spaceId,
      );
      if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    const page = await this.pageService.create(
      user.id,
      workspace.id,
      createPageDto,
    );
    const access = await this.pageAccessService.getEffectiveAccess(page, user);

    if (
      createPageDto.format &&
      createPageDto.format !== 'json' &&
      page.content
    ) {
      const contentOutput =
        createPageDto.format === 'markdown'
          ? jsonToMarkdown(page.content)
          : jsonToHtml(page.content);
      return {
        ...mapPageResponse(page),
        content: contentOutput,
        access: this.toAccessResponse(access),
      };
    }

    return {
      ...mapPageResponse(page),
      access: this.toAccessResponse(access),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(@Body() updatePageDto: UpdatePageDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(updatePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanWritePage(page, user);

    const updatedPage = await this.pageService.update(
      page,
      updatePageDto,
      user,
    );
    const access = await this.pageAccessService.getEffectiveAccess(updatedPage, user);

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
        ...mapPageResponse(updatedPage, { includeCustomFields: true }),
        content: contentOutput,
        access: this.toAccessResponse(access),
      };
    }

    return {
      ...mapPageResponse(updatedPage, { includeCustomFields: true }),
      access: this.toAccessResponse(access),
    };
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

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    if (deletePageDto.permanentlyDelete) {
      // Permanent deletion requires space admin permissions
      const ability = await this.spaceAbility.createForUser(user, page.spaceId);
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
        throw new ForbiddenException(
          'Only space admins can permanently delete pages',
        );
      }
      await this.pageService.forceDelete(page.id, workspace.id);
    } else {
      await this.pageService.removePage(page.id, user.id, workspace.id);
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

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    await this.pageRepo.restorePage(page.id, workspace.id);

    const restoredPage = await this.pageRepo.findById(page.id, {
      includeHasChildren: true,
    });

    if (!restoredPage) {
      return restoredPage;
    }

    const access = await this.pageAccessService.getEffectiveAccess(restoredPage, user);
    return {
      ...mapPageResponse(restoredPage),
      access: this.toAccessResponse(access),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('recent')
  async getRecentPages(
    @Body() recentPageDto: RecentPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    if (recentPageDto.spaceId) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(
          user,
          recentPageDto.spaceId,
        );
      if (!hasReadablePages) {
        throw new ForbiddenException();
      }

      const result = await this.pageService.getRecentSpacePages(
        recentPageDto.spaceId,
        pagination,
      );

      const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
        user,
        recentPageDto.spaceId,
      );

      result.items = result.items.filter((page) =>
        snapshot.readablePageIds.has(page.id),
      );

      return result;
    }

    const result = await this.pageService.getRecentPages(user.id, pagination);
    const accessRows = await Promise.all(
      result.items.map(async (page) => {
        const access = await this.pageAccessService.getEffectiveAccess(page, user);
        return {
          page,
          access,
        };
      }),
    );

    result.items = accessRows
      .filter((entry) => entry.access.capabilities.canRead)
      .map((entry) => ({
        ...entry.page,
        access: this.toAccessResponse(entry.access),
      }));

    return result;
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

    await this.pageAccessService.assertCanReadPage(page, user);

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

    const page = await this.pageRepo.findById(history.pageId);
    if (page) {
      await this.pageAccessService.assertCanReadPage(page, user);
      return history;
    }

    const ability = await this.spaceAbility.createForUser(user, history.spaceId);
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
      if (!page || page.deletedAt) {
        throw new NotFoundException('Page not found');
      }

      if (dto.spaceId && dto.spaceId !== page.spaceId) {
        throw new BadRequestException(
          'pageId does not belong to the provided spaceId',
        );
      }

      spaceId = page.spaceId;
    }

    const accessSnapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      spaceId,
    );

    if (accessSnapshot.readablePageIds.size === 0) {
      throw new ForbiddenException();
    }

    if (dto.pageId && !accessSnapshot.visiblePageIds.has(dto.pageId)) {
      throw new ForbiddenException();
    }

    const sidebarPages = await this.pageService.getSidebarPages(
      spaceId,
      pagination,
      dto.pageId,
      dto.includeNodeTypes,
    );

    const visibleItems = sidebarPages.items.filter((node) =>
      accessSnapshot.visiblePageIds.has(node.id),
    );

    return {
      ...sidebarPages,
      items: visibleItems.map((node) => ({
        ...node,
        hasChildren:
          (accessSnapshot.visibleChildrenCountByParentId.get(node.id) ?? 0) > 0,
        customFields: ['page', 'database', 'databaseRow'].includes(
          node.nodeType,
        )
          ? mapPageCustomFields(node)
          : null,
        access: {
          role: accessSnapshot.writablePageIds.has(node.id)
            ? PageRole.WRITER
            : accessSnapshot.readablePageIds.has(node.id)
              ? PageRole.READER
              : null,
          sources: [],
          capabilities: {
            canRead: accessSnapshot.readablePageIds.has(node.id),
            canWrite: accessSnapshot.writablePageIds.has(node.id),
            canCreateChild: accessSnapshot.createChildPageIds.has(node.id),
            canMoveDeleteShare:
              accessSnapshot.moveDeleteSharePageIds.has(node.id),
            canManageAccess: accessSnapshot.manageAccessPageIds.has(node.id),
          },
          isSystemAccess: this.pageAccessService.isWorkspaceBypassUser(user),
        },
      })),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/actions/access/users')
  async listPageAccessUsers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    this.pageAccessService.assertCanManageAccess(user);

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    return this.pageAccessService.listEffectiveUsers(page, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/actions/access/groups')
  async listPageAccessGroups(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    this.pageAccessService.assertCanManageAccess(user);

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    return this.pageAccessService.listGroupRules(page, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/actions/access/grant-user')
  async grantPageUserAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: GrantPageUserAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.grantUserAccessForSubtree(
      page,
      dto.userId,
      dto.role,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/actions/access/close-user')
  async closePageUserAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: ClosePageUserAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.closeUserAccessForSubtree(
      page,
      dto.userId,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/actions/access/grant-group')
  async grantPageGroupAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: GrantPageGroupAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.grantGroupAccessForSubtree(
      page,
      dto.groupId,
      dto.role,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/actions/access/close-group')
  async closePageGroupAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: ClosePageGroupAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.closeGroupAccessForSubtree(
      page,
      dto.groupId,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':pageId/convert-to-database')
  async convertToDatabase(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);

    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    const existingDatabase = await this.databaseRepo.findByPageId(
      page.id,
      page.workspaceId,
    );
    if (existingDatabase) {
      throw new BadRequestException('Page is already a database');
    }

    return this.pageService.convertPageToDatabase(page, user.id);
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

    await this.pageAccessService.assertCanMoveDeleteShare(movedPage, user);

    const destinationAbility = await this.spaceAbility.createForUser(
      user,
      dto.spaceId,
    );
    if (destinationAbility.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
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
      await this.pageAccessService.assertCanReadPage(copiedPage, user);

      const targetAbility = await this.spaceAbility.createForUser(user, dto.spaceId);
      if (targetAbility.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      const duplicatedPage = await this.pageService.duplicatePage(
        copiedPage,
        dto.spaceId,
        user,
      );

      const access = await this.pageAccessService.getEffectiveAccess(
        duplicatedPage,
        user,
      );
      return {
        ...mapPageResponse(duplicatedPage),
        access: this.toAccessResponse(access),
      };
    } else {
      // If no spaceId, it's a duplicate in same space
      await this.pageAccessService.assertCanWritePage(copiedPage, user);

      const duplicatedPage = await this.pageService.duplicatePage(
        copiedPage,
        undefined,
        user,
      );

      const access = await this.pageAccessService.getEffectiveAccess(
        duplicatedPage,
        user,
      );
      return {
        ...mapPageResponse(duplicatedPage),
        access: this.toAccessResponse(access),
      };
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('move')
  async movePage(@Body() dto: MovePageDto, @AuthUser() user: User) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage || movedPage.deletedAt) {
      throw new NotFoundException('Moved page not found');
    }

    if (dto.parentPageId && dto.parentPageId === dto.pageId) {
      throw new BadRequestException('Page cannot be moved under itself');
    }

    if (dto.parentPageId) {
      const parentPage = await this.pageRepo.findById(dto.parentPageId);
      if (
        !parentPage ||
        parentPage.deletedAt ||
        parentPage.spaceId !== movedPage.spaceId
      ) {
        throw new NotFoundException('Parent page not found');
      }

      await this.pageAccessService.assertCanCreateChild(parentPage, user);
    }

    await this.pageAccessService.assertCanMoveDeleteShare(movedPage, user);

    return this.pageService.movePage(dto, movedPage);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/breadcrumbs')
  async getPageBreadcrumbs(@Body() dto: PageIdDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      page.spaceId,
    );

    const breadcrumbs = await this.pageService.getPageBreadCrumbs(page.id);
    return breadcrumbs.filter((crumb) => snapshot.visiblePageIds.has(crumb.id));
  }
}
