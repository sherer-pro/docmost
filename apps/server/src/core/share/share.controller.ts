import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { Share, User, Workspace } from '@docmost/db/types/entity.types';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { ShareService } from './share.service';
import {
  CreateShareDto,
  ShareIdDto,
  ShareInfoDto,
  SharePageIdDto,
  UpdateShareDto,
} from './dto/share.dto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { FastifyReply } from 'fastify';
import { TokenService } from '../auth/services/token.service';
import {
  getAttachmentTokenCookieName,
  LEGACY_ATTACHMENT_TOKEN_COOKIE,
} from '../attachment/attachment-public-token.util';
import { PageAccessService } from '../page-access/page-access.service';
import { ShareTransclusionLookupDto } from './dto/share-transclusion-lookup.dto';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from '../auth/rate-limit/auth-rate-limit.decorator';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';

@UseGuards(JwtAuthGuard)
@Controller('shares')
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly shareRepo: ShareRepo,
    private readonly pageRepo: PageRepo,
    private readonly environmentService: EnvironmentService,
    private readonly tokenService: TokenService,
    private readonly pageAccessService: PageAccessService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Get('/')
  async getSharesViaQuery(
    @AuthUser() user: User,
    @Query() pagination: PaginationOptions,
  ) {
    return this.getShares(user, pagination);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('/page-info')
  async getSharedPageInfoViaQuery(
    @Query() dto: ShareInfoDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.getSharedPageInfo(dto, workspace, res);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('/info')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'shareRead', accountField: 'shareId' })
  async getShareViaQuery(
    @Query() dto: ShareIdDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.getShare(dto, workspace, res);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'query', key: 'pageId' })
  @Get('/for-page')
  async getShareForPageViaQuery(
    @Query() dto: SharePageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getShareForPage(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body', key: 'pageId' })
  @Post('actions/create')
  async createViaAction(
    @Body() createShareDto: CreateShareDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.create(createShareDto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('resource', {
    source: 'body',
    key: 'shareId',
    resourceType: 'share',
  })
  @Post('actions/update')
  async updateViaAction(
    @Body() updateShareDto: UpdateShareDto,
    @AuthUser() user: User,
  ) {
    return this.update(updateShareDto, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('resource', {
    source: 'body',
    key: 'shareId',
    resourceType: 'share',
  })
  @Post('actions/delete')
  async deleteViaAction(
    @Body() shareIdDto: ShareIdDto,
    @AuthUser() user: User,
  ) {
    return this.delete(shareIdDto, user);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/transclusion/lookup')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    endpoint: 'shareTransclusionLookup',
    accountField: 'shareId',
  })
  async lookupTransclusion(
    @Body() dto: ShareTransclusionLookupDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    this.setPublicDataNoStore(res);
    const result = await this.shareService.lookupTransclusionForShare(
      dto.shareId,
      dto.references,
      workspace.id,
    );
    for (const item of result.items) {
      if (item && 'content' in item) {
        await this.setAttachmentAccessCookie(
          res,
          item.sourcePageId,
          workspace.id,
          dto.shareId,
          false,
        );
      } else if (item?.sourcePageId) {
        this.clearAttachmentAccessCookie(res, item.sourcePageId);
      }
    }
    return result;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('/tree')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'shareRead', accountField: 'shareId' })
  async getSharePageTreeViaQuery(
    @Query() dto: ShareIdDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.getSharePageTree(dto, workspace, res);
  }

  private setPublicDataNoStore(res: FastifyReply): void {
    res.header('Cache-Control', 'private, no-store');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
  }

  private async setAttachmentAccessCookie(
    res: FastifyReply,
    pageId: string,
    workspaceId: string,
    shareId?: string,
    includeLegacy = true,
  ) {
    const token = await this.tokenService.generateAttachmentPageToken({
      pageId,
      workspaceId,
      shareId,
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const cookieOptions = {
      httpOnly: true,
      path: '/api',
      secure: this.environmentService.isHttps(),
      sameSite: 'lax' as const,
      expires: expiresAt,
    };

    res.setCookie(getAttachmentTokenCookieName(pageId), token, cookieOptions);
    if (includeLegacy) {
      // Keep generic cookie during migration for older handlers/clients.
      res.setCookie(LEGACY_ATTACHMENT_TOKEN_COOKIE, token, cookieOptions);
    }
  }

  private clearAttachmentAccessCookie(res: FastifyReply, pageId: string): void {
    res.clearCookie(getAttachmentTokenCookieName(pageId), {
      path: '/api',
      secure: this.environmentService.isHttps(),
      sameSite: 'lax',
    });
  }

  async getShares(
    @AuthUser() user: User,
    @Body() pagination: PaginationOptions,
  ) {
    return this.shareRepo.getShares(user.id, pagination);
  }

  async getSharedPageInfo(
    @Body() dto: ShareInfoDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    this.setPublicDataNoStore(res);
    if (!dto.pageId && !dto.shareId) {
      throw new BadRequestException();
    }

    const shareData = await this.shareService.getSharedPage(dto, workspace.id);

    const sharingAllowed = await this.shareService.isSharingAllowed(
      workspace.id,
      shareData.share.spaceId,
    );
    if (!sharingAllowed) {
      throw new NotFoundException('Shared page not found');
    }

    await this.setAttachmentAccessCookie(
      res,
      shareData.page.id,
      workspace.id,
      shareData.share.id,
    );

    return shareData;
  }

  async getShare(
    @Body() dto: ShareIdDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    this.setPublicDataNoStore(res);
    const share = (await this.shareRepo.findById(dto.shareId, {
      includeSharedPage: true,
    })) as (Share & { sharedPage?: { id: string } | null }) | undefined;

    if (
      !share ||
      share.workspaceId !== workspace.id ||
      !share.sharedPage
    ) {
      throw new NotFoundException('Share not found');
    }

    const sharingAllowed = await this.shareService.isSharingAllowed(
      share.workspaceId,
      share.spaceId,
    );
    if (!sharingAllowed) {
      throw new NotFoundException('Share not found');
    }

    return share;
  }

  async getShareForPage(
    @Body() dto: SharePageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Shared page not found');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    return this.shareService.getShareForPage(page.slugId, workspace.id);
  }

  async create(
    @Body() createShareDto: CreateShareDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(createShareDto.pageId);

    if (!page || workspace.id !== page.workspaceId) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    return this.shareService.createShare({
      page,
      authUserId: user.id,
      workspaceId: workspace.id,
      createShareDto,
    });
  }

  async update(@Body() updateShareDto: UpdateShareDto, @AuthUser() user: User) {
    const share = await this.shareRepo.findById(updateShareDto.shareId);

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    const page = await this.pageRepo.findById(share.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    return this.shareService.updateShare(share.id, updateShareDto);
  }

  async delete(@Body() shareIdDto: ShareIdDto, @AuthUser() user: User) {
    const share = await this.shareRepo.findById(shareIdDto.shareId);

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    const page = await this.pageRepo.findById(share.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    await this.shareRepo.deleteShare(share.id);
  }

  async getSharePageTree(
    @Body() dto: ShareIdDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    this.setPublicDataNoStore(res);
    const treeData = await this.shareService.getShareTree(
      dto.shareId,
      workspace.id,
    );

    const sharingAllowed = await this.shareService.isSharingAllowed(
      workspace.id,
      treeData.share.spaceId,
    );
    if (!sharingAllowed) {
      throw new NotFoundException('Share not found');
    }

    return treeData;
  }
}
