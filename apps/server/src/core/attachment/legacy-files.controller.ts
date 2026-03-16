import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { FileInterceptor } from '../../common/interceptors/file.interceptor';
import { AttachmentFileAccessService } from './services/attachment-file-access.service';

/**
 * Legacy attachment routes kept for backward compatibility with persisted links
 * and older frontend clients that still use `/api/files/*`.
 *
 * Canonical endpoints live under `/api/attachments/*`.
 */
@Controller('files')
export class LegacyFilesController {
  constructor(
    private readonly attachmentFileAccessService: AttachmentFileAccessService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('upload')
  @UseInterceptors(FileInterceptor)
  async uploadFile(
    @Req() req: any,
    @Res() res: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.attachmentFileAccessService.uploadFile(req, res, user, workspace);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':fileId/:fileName')
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

  @Get('public/:fileId/:fileName')
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
}
