import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import * as bytes from 'bytes';
import { lookup as lookupMimeType } from 'mime-types';
import { validate as isValidUUID } from 'uuid';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Attachment, User, Workspace } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { StorageService } from '../../../integrations/storage/storage.service';
import { AttachmentService } from './attachment.service';
import { TokenService } from '../../auth/services/token.service';
import { JwtAttachmentPayload, JwtType } from '../../auth/dto/jwt-payload';
import { inlineFileExtensions } from '../attachment.constants';
import { resolveAttachmentAccessTokenDetails } from '../attachment-public-token.util';
import { PageAccessService } from '../../page-access/page-access.service';
import { PublicSharingPolicyService } from '../../share/public-sharing-policy.service';
import { ShareService } from '../../share/share.service';

const fallbackDownloadMimeType = 'application/octet-stream';

const trustedInlineMimeTypesByExtension: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.pdf': ['application/pdf'],
  '.mp4': ['video/mp4'],
  '.mov': ['video/quicktime'],
};

const dangerousDownloadMimeTypes = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
]);

const renderableDiagramSvgFileNamePattern =
  /^diagram\.(drawio|excalidraw)\.svg$/i;

@Injectable()
export class AttachmentFileAccessService {
  private readonly logger = new Logger(AttachmentFileAccessService.name);

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly pageAccessService: PageAccessService,
    private readonly pageRepo: PageRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly environmentService: EnvironmentService,
    private readonly tokenService: TokenService,
    private readonly storageService: StorageService,
    private readonly publicSharingPolicy: PublicSharingPolicyService,
    private readonly shareService: ShareService,
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

    await this.pageAccessService.assertCanWritePage(page, user);

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

    const page = await this.pageRepo.findById(attachment.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException();
    }

    await this.pageAccessService.assertCanReadPage(page, user);

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

    const page = await this.pageRepo.findById(attachment.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== workspace.id ||
      page.spaceId !== attachment.spaceId
    ) {
      throw new NotFoundException('File not found');
    }

    const accessTokenDetails = resolveAttachmentAccessTokenDetails(
      req,
      attachment.pageId,
      jwtToken,
    );
    const accessToken = accessTokenDetails.token;

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
      (jwtPayload.pageId !== attachment.pageId &&
        !jwtPayload.pageIds?.includes(attachment.pageId)) ||
      (jwtPayload.attachmentId && jwtPayload.attachmentId !== fileId)
    ) {
      throw new NotFoundException('File not found');
    }

    const isTrustedAttachmentSpecificToken = Boolean(
      jwtPayload.attachmentId === fileId && !jwtPayload.shareId,
    );
    if (
      !isTrustedAttachmentSpecificToken &&
      !(await this.publicSharingPolicy.isAllowed(
        workspace.id,
        attachment.spaceId,
      ))
    ) {
      throw new NotFoundException('File not found');
    }

    if (jwtPayload.shareId) {
      const inheritedShare = await this.shareService.getShareForPage(
        page.slugId,
        workspace.id,
        jwtPayload.shareId,
      );
      if (!inheritedShare) throw new NotFoundException('File not found');
      if (jwtPayload.pageEmbedSource) {
        const result = await this.shareService.lookupTransclusionForShare(
          jwtPayload.shareId,
          [
            {
              kind: 'page',
              sourcePageId: page.id,
            },
          ],
          workspace.id,
        );
        if (!result.items[0] || !('content' in result.items[0])) {
          throw new NotFoundException('File not found');
        }
      }
    }

    if (accessTokenDetails.source === 'query') {
      this.addLegacyQueryTokenDeprecationHeaders(res);
    }

    try {
      return await this.sendFileResponse(req, res, attachment, 'public');
    } catch (err) {
      this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }

  private addLegacyQueryTokenDeprecationHeaders(res: FastifyReply) {
    res.header('Deprecation', 'true');
    res.header(
      'Warning',
      '299 Docmost "Attachment jwt query tokens are deprecated; use attachment cookies or x-attachment-token."',
    );
  }

  private async sendFileResponse(
    req: FastifyRequest,
    res: FastifyReply,
    attachment: Attachment,
    cacheScope: 'private' | 'public',
  ) {
    const fileSize = Number(attachment.fileSize);
    const rangeHeader = req.headers.range;
    const shouldInline = this.shouldServeInline(attachment);
    const contentType = this.getResponseContentType(attachment, shouldInline);
    const cacheControl =
      cacheScope === 'public' ? 'private, no-store' : 'private, max-age=3600';

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
          res.header('Accept-Ranges', 'bytes');
          return res.send();
        }

        const fileStream = await this.storageService.readRangeStream(
          attachment.filePath,
          { start, end },
        );

        res.status(206);
        this.setFileResponseHeaders(res, attachment, shouldInline);
        res.headers({
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': end - start + 1,
          'Cache-Control': cacheControl,
        });

        return res.send(fileStream);
      }
    }

    const fileStream = await this.storageService.readStream(
      attachment.filePath,
    );

    this.setFileResponseHeaders(res, attachment, shouldInline);
    res.headers({
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    });

    const isSvg = attachment.fileExt === '.svg';
    if (fileSize && !isSvg) {
      res.header('Content-Length', fileSize);
    }

    return res.send(fileStream);
  }

  private setFileResponseHeaders(
    res: FastifyReply,
    attachment: Attachment,
    shouldInline: boolean,
  ) {
    res.header('Accept-Ranges', 'bytes');

    if (!shouldInline) {
      res.header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      );
    }
  }

  private shouldServeInline(attachment: Attachment): boolean {
    const fileExtension = attachment.fileExt?.toLowerCase() ?? '';
    const mimeType = this.getBaseMimeType(attachment.mimeType);
    const trustedMimeTypes = trustedInlineMimeTypesByExtension[fileExtension];

    return (
      inlineFileExtensions.includes(fileExtension) &&
      Boolean(mimeType) &&
      trustedMimeTypes?.includes(mimeType)
    );
  }

  private getResponseContentType(
    attachment: Attachment,
    shouldInline: boolean,
  ): string {
    const fileExtension = attachment.fileExt?.toLowerCase() ?? '';
    const storedMimeType = this.getBaseMimeType(attachment.mimeType);

    if (shouldInline) {
      return storedMimeType;
    }

    const trustedInlineMimeTypes =
      trustedInlineMimeTypesByExtension[fileExtension];
    if (
      trustedInlineMimeTypes &&
      !trustedInlineMimeTypes.includes(storedMimeType)
    ) {
      return fallbackDownloadMimeType;
    }

    const extensionMimeType = this.getBaseMimeType(
      lookupMimeType(attachment.fileName) || undefined,
    );
    const candidateMimeType =
      extensionMimeType || storedMimeType || fallbackDownloadMimeType;

    if (this.isRenderableDiagramSvg(attachment, candidateMimeType)) {
      return 'image/svg+xml';
    }

    if (dangerousDownloadMimeTypes.has(candidateMimeType)) {
      return fallbackDownloadMimeType;
    }

    return candidateMimeType;
  }

  private isRenderableDiagramSvg(
    attachment: Attachment,
    candidateMimeType: string,
  ): boolean {
    const fileExtension = attachment.fileExt?.toLowerCase() ?? '';

    return (
      fileExtension === '.svg' &&
      candidateMimeType === 'image/svg+xml' &&
      renderableDiagramSvgFileNamePattern.test(attachment.fileName ?? '')
    );
  }

  private getBaseMimeType(mimeType?: string | null): string {
    return mimeType?.split(';')[0]?.trim().toLowerCase() || '';
  }
}
