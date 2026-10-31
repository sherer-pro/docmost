import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';
import { CsrfExempt } from '../../../common/decorators/csrf-exempt.decorator';
import { McpOAuthService } from './mcp-oauth.service';
import { hostWorkspace } from './mcp-oauth-request';
import { McpOAuthRateLimitGuard } from './mcp-oauth-rate-limit.guard';

@UseGuards(McpOAuthRateLimitGuard)
@Controller('mcp-oauth')
export class McpOAuthPublicController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Post('clients')
  @SkipTransform()
  @CsrfExempt()
  register(@Req() request: any, @Body() body: Record<string, unknown>) {
    return this.oauth.register(hostWorkspace(request).id, body ?? {});
  }

  @Get('authorize')
  @SkipTransform()
  async authorize(
    @Req() request: any,
    @Query() query: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ) {
    const redirect = await this.oauth.begin(hostWorkspace(request), query);
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .redirect(redirect, 302);
  }

  @Post('token')
  @SkipTransform()
  @HttpCode(200)
  @CsrfExempt()
  token(
    @Req() request: any,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    return this.oauth.token(hostWorkspace(request), body ?? {});
  }

  @Post('revoke')
  @SkipTransform()
  @HttpCode(200)
  @CsrfExempt()
  revoke(
    @Req() request: any,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    return this.oauth.revoke(hostWorkspace(request).id, body ?? {});
  }
}
