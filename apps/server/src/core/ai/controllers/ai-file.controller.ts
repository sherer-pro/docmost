import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { FileInterceptor } from '../../../common/interceptors/file.interceptor';
import { AiFileService } from '../services/ai-file.service';

@UseGuards(JwtAuthGuard)
@Controller('ai/conversations/:conversationId/files')
export class AiFileController {
  constructor(private readonly files: AiFileService) {}

  @Get()
  list(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.files.list(conversationId, user, workspace);
  }

  @Post()
  @UseInterceptors(FileInterceptor)
  upload(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.files.upload(
      conversationId,
      req.files({
        limits: {
          files: 10,
          fileSize: 25 * 1024 * 1024,
          fields: 2,
        },
      }),
      idempotencyKey,
      user,
      workspace,
    );
  }

  @Get(':fileId')
  async download(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() reply: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { file, stream } = await this.files.readForDownload(
      conversationId,
      fileId,
      user,
      workspace,
    );
    reply.header('content-type', file.mimeType);
    reply.header(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return reply.send(stream);
  }

  @Delete(':fileId')
  remove(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.files.remove(conversationId, fileId, user, workspace);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('ai/pages')
export class AiPageAttachmentController {
  constructor(private readonly files: AiFileService) {}

  @Get(':pageId/attachments')
  list(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.files.listPageAttachments(pageId, user, workspace);
  }
}
