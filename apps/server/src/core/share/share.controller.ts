import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
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
import { hasLicenseOrEE } from '../../common/helpers';
import { FastifyReply } from 'fastify';
import { TokenService } from '../auth/services/token.service';
import {
  getAttachmentTokenCookieName,
  LEGACY_ATTACHMENT_TOKEN_COOKIE,
} from '../attachment/attachment-public-token.util';
import { PageAccessService } from '../page-access/page-access.service';

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
  @Post('/')
  async getShares(
    @AuthUser() user: User,
    @Body() pagination: PaginationOptions,
  ) {
    return this.shareRepo.getShares(user.id, pagination);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/page-info')
  async getSharedPageInfo(
    @Body() dto: ShareInfoDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
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
    );

    return {
      ...shareData,
      hasLicenseKey: hasLicenseOrEE({
        licenseKey: workspace.licenseKey,
        isCloud: this.environmentService.isCloud(),
        plan: workspace.plan,
      }),
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/info')
  async getShare(@Body() dto: ShareIdDto) {
    const share = await this.shareRepo.findById(dto.shareId, {
      includeSharedPage: true,
    });

    if (!share) {
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

  @HttpCode(HttpStatus.OK)
  @Post('/for-page')
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

  @HttpCode(HttpStatus.OK)
  @Post('create')
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

    const sharingAllowed = await this.shareService.isSharingAllowed(
      workspace.id,
      page.spaceId,
    );
    if (!sharingAllowed) {
      throw new ForbiddenException('Public sharing is disabled');
    }

    return this.shareService.createShare({
      page,
      authUserId: user.id,
      workspaceId: workspace.id,
      createShareDto,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
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

  @HttpCode(HttpStatus.OK)
  @Post('delete')
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

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/tree')
  async getSharePageTree(
    @Body() dto: ShareIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
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

    return {
      ...treeData,
      hasLicenseKey: hasLicenseOrEE({
        licenseKey: workspace.licenseKey,
        isCloud: this.environmentService.isCloud(),
        plan: workspace.plan,
      }),
    };
  }

  private async setAttachmentAccessCookie(
    res: FastifyReply,
    pageId: string,
    workspaceId: string,
  ) {
    const token = await this.tokenService.generateAttachmentPageToken({
      pageId,
      workspaceId,
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
    // Keep generic cookie during migration for older handlers/clients.
    res.setCookie(LEGACY_ATTACHMENT_TOKEN_COOKIE, token, cookieOptions);
  }
}
