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
import { LinkPreviewDto } from './dto/link-preview.dto';
import { AddLabelsDto, RemoveLabelDto } from '../label/dto/label.dto';
import { LabelService } from '../label/label.service';
import { BacklinkService } from './services/backlink.service';
import { BacklinksListDto } from './dto/backlink.dto';
import {
  jsonToHtml,
  jsonToMarkdown,
} from '../../collaboration/collaboration.util';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import {
  mapPageCustomFields,
  mapPageResponse,
} from './mappers/page-response.mapper';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { PageAccessService } from '../page-access/page-access.service';
import { PageRole } from '../../common/helpers/types/permission';
import {
  ClosePageGroupAccessDto,
  ClosePageUserAccessDto,
  GrantPageGroupAccessDto,
  GrantPageUserAccessDto,
  ResolvePageAccessUsersDto,
} from './dto/page-access.dto';

const LINK_PREVIEW_TIMEOUT_MS = 7000;
const LINK_PREVIEW_MAX_REDIRECTS = 5;
const LINK_PREVIEW_MAX_RESPONSE_BYTES = 1_000_000;
const LINK_PREVIEW_BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
];

type LinkPreviewAddress = {
  address: string;
  family: 4 | 6;
};

type LinkPreviewResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
};

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
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly labelService: LabelService,
    private readonly backlinkService: BacklinkService,
  ) {}

  private async fetchLinkPreviewHtml(
    sourceUrl: URL,
  ): Promise<{ finalUrl: URL; html: string }> {
    let currentUrl = new URL(sourceUrl.toString());

    for (let hop = 0; hop <= LINK_PREVIEW_MAX_REDIRECTS; hop += 1) {
      const targetAddress = await this.resolvePublicUrlAddress(currentUrl);

      const response = await this.requestLinkPreview(
        currentUrl,
        targetAddress,
      ).catch(() => {
        throw new BadRequestException('Failed to fetch URL metadata');
      });

      if (this.isRedirectResponse(response.statusCode)) {
        response.body.resume();
        const location = this.getHeaderValue(response.headers, 'location');
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

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.resume();
        throw new BadRequestException('Failed to fetch URL metadata');
      }

      const contentType =
        this.getHeaderValue(response.headers, 'content-type')?.toLowerCase() ??
        '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        response.body.resume();
        throw new BadRequestException('URL does not point to an HTML document');
      }

      const html = await this.readIncomingMessageWithLimit(
        response.body,
        LINK_PREVIEW_MAX_RESPONSE_BYTES,
      );

      return { finalUrl: currentUrl, html };
    }

    throw new BadRequestException('Too many redirects');
  }

  private async resolvePublicUrlAddress(url: URL): Promise<LinkPreviewAddress> {
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

      return {
        address: this.normalizeIpAddress(url.hostname),
        family: hostIpVersion as 4 | 6,
      };
    }

    const resolvedAddresses = await dnsLookup(url.hostname, {
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

    const targetAddress = resolvedAddresses.find(
      (entry) => entry.family === 4 || entry.family === 6,
    );

    if (!targetAddress) {
      throw new BadRequestException('Failed to resolve URL hostname');
    }

    return {
      address: targetAddress.address,
      family: targetAddress.family as 4 | 6,
    };
  }

  private requestLinkPreview(
    url: URL,
    targetAddress: LinkPreviewAddress,
  ): Promise<LinkPreviewResponse> {
    return new Promise((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          headers: {
            'user-agent':
              'Mozilla/5.0 (compatible; DocmostBot/1.0; +https://docmost.com)',
            accept: 'text/html,application/xhtml+xml',
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, targetAddress.address, targetAddress.family);
          },
          timeout: LINK_PREVIEW_TIMEOUT_MS,
        },
        (body) => {
          resolve({
            statusCode: body.statusCode ?? 0,
            headers: body.headers,
            body,
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('Link preview request timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private getHeaderValue(
    headers: IncomingHttpHeaders,
    name: string,
  ): string | null {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
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

  private async readIncomingMessageWithLimit(
    response: IncomingMessage,
    maxBytes: number,
  ): Promise<string> {
    const contentLength = Number(
      this.getHeaderValue(response.headers, 'content-length'),
    );
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new BadRequestException('URL metadata response is too large');
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of response) {
      if (!chunk) {
        continue;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        response.destroy();
        throw new BadRequestException('URL metadata response is too large');
      }

      chunks.push(buffer);
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
  @Post('labels')
  async getPageLabels(
    @Body() dto: PageIdDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.labelService.getPageLabels(page.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('labels/add')
  async addPageLabels(
    @Body() dto: AddLabelsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanWritePage(page, user);

    return this.labelService.addLabelsToPage(
      page.id,
      dto.names,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('labels/remove')
  async removePageLabel(
    @Body() dto: RemoveLabelDto,
    @AuthUser() user: User,
  ): Promise<void> {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanWritePage(page, user);

    await this.labelService.removeLabelFromPage(
      page.id,
      dto.labelId,
      page.workspaceId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('backlinks-count')
  async getBacklinksCount(
    @Body() dto: PageIdDto,
    @AuthUser() user: User,
  ): Promise<{ incoming: number; outgoing: number }> {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.backlinkService.countByPageId(page.id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('backlinks')
  async getBacklinks(
    @Body() dto: BacklinksListDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.backlinkService.findByPageId(
      page.id,
      dto.direction,
      user,
      pagination,
    );
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
  @Post(':pageId/actions/access/resolve-users')
  async resolvePageAccessUsers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: ResolvePageAccessUsersDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);
    return this.pageAccessService.resolveReadableUsers(page, dto.userIds ?? []);
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
