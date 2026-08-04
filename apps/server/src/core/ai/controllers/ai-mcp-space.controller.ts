import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthPolicyScope } from '../../../common/decorators/auth-policy-scope.decorator';
import { AiMcpPolicyService } from '../mcp/ai-mcp-policy.service';
import { PutAiMcpBindingDto, PutAiMcpPreferencesDto } from '../dto/ai-mcp.dto';

/**
 * Space-level configuration for outbound external MCP servers.
 *
 * A space administrator may only pick from the workspace catalog, narrow the
 * tool list, and add instructions. Bindings are the space scope; preferences are
 * the individual user's own consent and need no space administration rights.
 */
@UseGuards(JwtAuthGuard)
@AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
@Controller('spaces/:spaceId/ai')
export class AiMcpSpaceController {
  constructor(private readonly policyService: AiMcpPolicyService) {}

  @Get('mcp-bindings')
  getBindings(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policyService.getBindingsView(spaceId, user, workspace);
  }

  @Put('mcp-bindings/:serverId')
  putBinding(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: PutAiMcpBindingDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policyService.putBinding(
      spaceId,
      serverId,
      dto,
      user,
      workspace,
    );
  }

  @Delete('mcp-bindings/:serverId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBinding(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.policyService.deleteBinding(spaceId, serverId, user, workspace);
  }

  @Get('mcp-preferences')
  getPreferences(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policyService.getPreferences(spaceId, user, workspace);
  }

  @Put('mcp-preferences')
  putPreferences(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: PutAiMcpPreferencesDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policyService.putPreferences(spaceId, dto, user, workspace);
  }
}
