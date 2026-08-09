import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AttachmentService } from './services/attachment.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { FileInterceptor } from '../../common/interceptors/file.interceptor';
import * as bytes from 'bytes';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { StorageService } from '../../integrations/storage/storage.service';
import {
  getAttachmentFolderPath,
  validAttachmentTypes,
} from './attachment.utils';
import { getMimeType } from '../../common/helpers';
import {
  AttachmentType,
  MAX_AVATAR_SIZE,
  validImageExtensions,
} from './attachment.constants';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { validate as isValidUUID } from 'uuid';
import * as path from 'path';
import { RemoveIconDto } from './dto/attachment.dto';
import { AttachmentFileAccessService } from './services/attachment-file-access.service';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';

@Controller('attachments')
export class AttachmentController {
  private readonly logger = new Logger(AttachmentController.name);

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly attachmentFileAccessService: AttachmentFileAccessService,
    private readonly storageService: StorageService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('page', { source: 'query', key: 'pageId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/upload-file')
  @UseInterceptors(FileInterceptor)
  async uploadFile(
    @Req() req: any,
    @Res() res: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.attachmentFileAccessService.uploadFile(
      req,
      res,
      user,
      workspace,
    );
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('resource', {
    key: 'fileId',
    resourceType: 'attachment',
  })
  @Get('files/:fileId/:fileName')
  async getFile(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Param('fileId') fileId: string,
    @Param('fileName') _fileName?: string,
  ) {
    return this.attachmentFileAccessService.getPrivateFile(
      req,
      res,
      user,
      workspace,
      fileId,
    );
  }

  @Get('files/public/:fileId/:fileName')
  async getPublicFile(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @AuthWorkspace() workspace: Workspace,
    @Param('fileId') fileId: string,
    @Param('fileName') _fileName?: string,
    @Query('jwt') jwtToken?: string,
  ) {
    return this.attachmentFileAccessService.getPublicFile(
      req,
      res,
      workspace,
      fileId,
      jwtToken,
    );
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
    optional: true,
  })
  @HttpCode(HttpStatus.OK)
  @Post('actions/upload-image')
  @UseInterceptors(FileInterceptor)
  async uploadAvatarOrLogo(
    @Req() req: any,
    @Res() res: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const maxFileSize = bytes(MAX_AVATAR_SIZE);

    let file = null;
    try {
      file = await req.file({
        limits: { fileSize: maxFileSize, fields: 3, files: 1 },
      });
    } catch (err: any) {
      if (err?.statusCode === 413) {
        throw new BadRequestException(
          `File too large. Exceeds the ${MAX_AVATAR_SIZE} limit`,
        );
      }
    }

    if (!file) {
      throw new BadRequestException('Invalid file upload');
    }

    const attachmentType = file.fields?.type?.value;
    const spaceId = file.fields?.spaceId?.value;

    if (!attachmentType) {
      throw new BadRequestException('attachment type is required');
    }

    if (
      !validAttachmentTypes.includes(attachmentType) ||
      attachmentType === AttachmentType.File
    ) {
      throw new BadRequestException('Invalid image attachment type');
    }

    if (attachmentType === AttachmentType.WorkspaceIcon) {
      const ability = this.workspaceAbility.createForUser(user, workspace);
      if (
        ability.cannot(
          WorkspaceCaslAction.Manage,
          WorkspaceCaslSubject.Settings,
        )
      ) {
        throw new ForbiddenException();
      }
    }

    if (attachmentType === AttachmentType.SpaceIcon) {
      if (!spaceId) {
        throw new BadRequestException('spaceId is required');
      }

      const spaceAbility = await this.spaceAbility.createForUser(user, spaceId);
      if (
        spaceAbility.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)
      ) {
        throw new ForbiddenException();
      }
    }

    try {
      const fileResponse = await this.attachmentService.uploadImage(
        file,
        attachmentType,
        user.id,
        workspace.id,
        spaceId,
      );

      return res.send(fileResponse);
    } catch {
      this.logger.error({ event: 'attachment_image_upload_failed' });
      throw new BadRequestException('Error processing file upload.');
    }
  }

  @Get('img/:attachmentType/:fileName')
  async getLogoOrAvatar(
    @Res() res: FastifyReply,
    @AuthWorkspace() workspace: Workspace,
    @Param('attachmentType') attachmentType: AttachmentType,
    @Param('fileName') fileName?: string,
  ) {
    if (
      !validAttachmentTypes.includes(attachmentType) ||
      attachmentType === AttachmentType.File
    ) {
      throw new BadRequestException('Invalid image attachment type');
    }

    // The route parameter may still contain encoded path separators, so the
    // storage path is rebuilt from validated parts only and never from the raw
    // parameter. Anything else would allow reads outside the workspace folder.
    const fileExtension = path.extname(fileName ?? '').toLowerCase();
    const filenameWithoutExt = path.basename(fileName ?? '', fileExtension);

    if (!isValidUUID(filenameWithoutExt)) {
      throw new BadRequestException('Invalid file id');
    }

    if (!validImageExtensions.includes(fileExtension)) {
      throw new BadRequestException('Invalid image file extension');
    }

    const safeFileName = `${filenameWithoutExt}${fileExtension}`;
    const filePath = `${getAttachmentFolderPath(attachmentType, workspace.id)}/${safeFileName}`;

    try {
      const fileStream = await this.storageService.readStream(filePath);
      res.headers({
        'Content-Type': getMimeType(filePath),
        'Cache-Control': 'private, max-age=86400',
      });
      return res.send(fileStream);
    } catch (err) {
      // this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('space', {
    source: 'body',
    key: 'spaceId',
    optional: true,
  })
  @HttpCode(HttpStatus.OK)
  @Post('actions/remove-icon')
  async removeIcon(
    @Body() dto: RemoveIconDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { type, spaceId } = dto;

    // remove current user avatar
    if (type === AttachmentType.Avatar) {
      await this.attachmentService.removeUserAvatar(user);
      return;
    }

    // remove space icon
    if (type === AttachmentType.SpaceIcon) {
      if (!spaceId) {
        throw new BadRequestException(
          'spaceId is required to change space icons',
        );
      }

      const spaceAbility = await this.spaceAbility.createForUser(user, spaceId);
      if (
        spaceAbility.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)
      ) {
        throw new ForbiddenException();
      }

      await this.attachmentService.removeSpaceIcon(spaceId, workspace.id);
      return;
    }

    // remove workspace icon
    if (type === AttachmentType.WorkspaceIcon) {
      const ability = this.workspaceAbility.createForUser(user, workspace);
      if (
        ability.cannot(
          WorkspaceCaslAction.Manage,
          WorkspaceCaslSubject.Settings,
        )
      ) {
        throw new ForbiddenException();
      }
      await this.attachmentService.removeWorkspaceIcon(workspace);
      return;
    }
  }

  async uploadAvatarOrLogoLegacy(
    @Req() req: any,
    @Res() res: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.uploadAvatarOrLogo(req, res, user, workspace);
  }

  async removeIconLegacy(
    @Body() dto: RemoveIconDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.removeIcon(dto, user, workspace);
  }
}
