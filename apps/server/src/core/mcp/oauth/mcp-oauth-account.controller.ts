import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { McpOAuthService } from './mcp-oauth.service';

@UseGuards(JwtAuthGuard)
@Controller('mcp-oauth/account')
export class McpOAuthAccountController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Get('settings')
  settings(@AuthWorkspace() workspace: Workspace) {
    return this.oauth.settings(workspace.id);
  }

  @Patch('settings')
  updateSettings(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: { enabled?: unknown },
  ) {
    return this.oauth.updateSettings(workspace.id, user, body?.enabled);
  }

  @Get('consent')
  consent(
    @AuthWorkspace() workspace: Workspace,
    @Query('requestId') requestId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.oauth.consentInfo(workspace, requestId);
  }

  @Post('consent')
  @HttpCode(200)
  decide(
    @Req() request: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.oauth.decide(workspace, user, request.user.session, body ?? {});
  }

  @Get('connections')
  connections(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.oauth.list(workspace.id, user.id);
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: { id?: unknown },
  ) {
    return this.oauth.disconnect(workspace.id, user.id, body?.id);
  }
}
