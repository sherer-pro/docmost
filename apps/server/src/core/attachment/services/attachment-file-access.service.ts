import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import * as bytes from 'bytes';
import { validate as isValidUUID } from 'uuid';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Attachment, User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { StorageService } from '../../../integrations/storage/storage.service';
import { AttachmentService } from './attachment.service';
import { TokenService } from '../../auth/services/token.service';
import { JwtAttachmentPayload, JwtType } from '../../auth/dto/jwt-payload';
import { inlineFileExtensions } from '../attachment.constants';
import { resolveAttachmentAccessToken } from '../attachment-public-token.util';

@Injectable()
export class AttachmentFileAccessService {
  private readonly logger = new Logger(AttachmentFileAccessService.name);

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageRepo: PageRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly environmentService: EnvironmentService,
    private readonly tokenService: TokenService,
    private readonly storageService: StorageService,
  ) {}

  async uploadFile(
    req: any,
    res: FastifyReply,
    user: User,
    workspace: Workspace,
  ) {
    const maxFileSize = bytes(this.environmentService.getFileUploadSizeLimit());

    let file = null;
    try {
      file = await req.file({
        limits: { fileSize: maxFileSize, fields: 3, files: 1 },
      });
    } catch (err: any) {
      this.logger.error(err.message);
      if (err?.statusCode === 413) {
        throw new BadRequestException(
          `File too large. Exceeds the ${this.environmentService.getFileUploadSizeLimit()} limit`,
        );
      }
    }

    if (!file) {
      throw new BadRequestException('Failed to upload file');
    }

    const pageId = file.fields?.pageId?.value;
    if (!pageId) {
      throw new BadRequestException('PageId is required');
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const spaceAbility = await this.spaceAbility.createForUser(
      user,
      page.spaceId,
    );
    if (spaceAbility.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const attachmentId = file.fields?.attachmentId?.value;
    if (attachmentId && !isValidUUID(attachmentId)) {
      throw new BadRequestException('Invalid attachment id');
    }

    try {
      const fileResponse = await this.attachmentService.uploadFile({
        filePromise: file,
        pageId,
        spaceId: page.spaceId,
        userId: user.id,
        workspaceId: workspace.id,
        attachmentId,
      });

      return res.send(fileResponse);
    } catch (err: any) {
      if (err?.statusCode === 413) {
        const errMessage = `File too large. Exceeds the ${this.environmentService.getFileUploadSizeLimit()} limit`;
        this.logger.error(errMessage);
        throw new BadRequestException(errMessage);
      }

      this.logger.error(err);
      throw new BadRequestException('Error processing file upload.');
    }
  }

  async getPrivateFile(
    req: FastifyRequest,
    res: FastifyReply,
    user: User,
    workspace: Workspace,
    fileId: string,
  ) {
    if (!isValidUUID(fileId)) {
      throw new NotFoundException('Invalid file id');
    }

    const attachment = await this.attachmentRepo.findById(fileId);
    if (
      !attachment ||
      attachment.workspaceId !== workspace.id ||
      !attachment.pageId ||
      !attachment.spaceId
    ) {
      throw new NotFoundException();
    }

    const spaceAbility = await this.spaceAbility.createForUser(
      user,
      attachment.spaceId,
    );

    if (spaceAbility.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    try {
      return await this.sendFileResponse(req, res, attachment, 'private');
    } catch (err) {
      this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }

  async getPublicFile(
    req: FastifyRequest,
    res: FastifyReply,
    workspace: Workspace,
    fileId: string,
    jwtToken?: string,
  ) {
    if (!isValidUUID(fileId)) {
      throw new NotFoundException('File not found');
    }

    const attachment = await this.attachmentRepo.findById(fileId);
    if (
      !attachment ||
      attachment.workspaceId !== workspace.id ||
      !attachment.pageId ||
      !attachment.spaceId
    ) {
      throw new NotFoundException('File not found');
    }

    const accessToken = resolveAttachmentAccessToken(
      req,
      attachment.pageId,
      jwtToken,
    );

    let jwtPayload: JwtAttachmentPayload = null;
    try {
      jwtPayload = await this.tokenService.verifyJwt(
        accessToken,
        JwtType.ATTACHMENT,
      );
    } catch (err) {
      throw new BadRequestException(
        'Expired or invalid attachment access token',
      );
    }

    if (
      jwtPayload.workspaceId !== workspace.id ||
      jwtPayload.pageId !== attachment.pageId ||
      (jwtPayload.attachmentId && jwtPayload.attachmentId !== fileId)
    ) {
      throw new NotFoundException('File not found');
    }

    try {
      return await this.sendFileResponse(req, res, attachment, 'public');
    } catch (err) {
      this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }

  private async sendFileResponse(
    req: FastifyRequest,
    res: FastifyReply,
    attachment: Attachment,
    cacheScope: 'private' | 'public',
  ) {
    const fileSize = Number(attachment.fileSize);
    const rangeHeader = req.headers.range;

    res.header('Accept-Ranges', 'bytes');

    if (!inlineFileExtensions.includes(attachment.fileExt)) {
      res.header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      );
    }

    if (rangeHeader && fileSize) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2]
          ? Math.min(parseInt(match[2], 10), fileSize - 1)
          : fileSize - 1;

        if (start >= fileSize || start > end) {
          res.status(416);
          res.header('Content-Range', `bytes */${fileSize}`);
          return res.send();
        }

        const fileStream = await this.storageService.readRangeStream(
          attachment.filePath,
          { start, end },
        );

        res.status(206);
        res.headers({
          'Content-Type': attachment.mimeType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': end - start + 1,
          'Cache-Control': `${cacheScope}, max-age=3600`,
        });

        return res.send(fileStream);
      }
    }

    const fileStream = await this.storageService.readStream(attachment.filePath);

    res.headers({
      'Content-Type': attachment.mimeType,
      'Cache-Control': `${cacheScope}, max-age=3600`,
    });

    const isSvg = attachment.fileExt === '.svg';
    if (fileSize && !isSvg) {
      res.header('Content-Length', fileSize);
    }

    return res.send(fileStream);
  }
}
