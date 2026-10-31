import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { User } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from '../auth/rate-limit/auth-rate-limit.decorator';
import { IntegrationPreviewService } from './integration-preview.service';
import {
  ResolveIntegrationPreviewDto,
  SaveIntegrationPreviewConnectionDto,
  UpdateIntegrationPreviewSettingsDto,
} from './integration-preview.dto';

@UseGuards(JwtAuthGuard)
@Controller('integration-previews')
export class IntegrationPreviewController {
  constructor(private readonly previews: IntegrationPreviewService) {}

  @Get('settings')
  settings(
    @AuthUser() user: User,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.previews.settings(user.workspaceId);
  }

  @Patch('settings')
  updateSettings(
    @AuthUser() user: User,
    @Body() body: UpdateIntegrationPreviewSettingsDto,
  ) {
    return this.previews.updateSettings(user, body.enabled);
  }

  @Get('connections')
  connections(
    @AuthUser() user: User,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.previews.connections(user);
  }

  @Put('connections/:provider')
  saveConnection(
    @AuthUser() user: User,
    @Param('provider') provider: string,
    @Body() body: SaveIntegrationPreviewConnectionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.previews.saveConnection(user, provider, body.credential);
  }

  @Delete('connections/:provider')
  disconnect(@AuthUser() user: User, @Param('provider') provider: string) {
    return this.previews.removeConnection(user, provider);
  }

  @Post('actions/resolve')
  @HttpCode(200)
  @AuthPolicyScope('page', { source: 'body', key: 'pageId' })
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'integrationPreview', accountField: 'sessionId' })
  resolve(
    @AuthUser() user: User,
    @Body() body: ResolveIntegrationPreviewDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.previews.resolve(user, body.pageId, body.url);
  }
}
