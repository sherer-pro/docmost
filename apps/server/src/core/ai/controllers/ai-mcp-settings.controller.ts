import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiMcpAdminService } from '../mcp/ai-mcp-admin.service';
import {
  CreateAiMcpServerDto,
  UpdateAiMcpServerDto,
  UpdateAiMcpSettingsDto,
} from '../dto/ai-mcp.dto';

/**
 * Workspace administration for outbound external MCP servers.
 *
 * This is the client direction: Docmost calling out. It is unrelated to the
 * inbound `/mcp` endpoint and shares no credentials with it.
 */
@UseGuards(JwtAuthGuard)
@Controller('ai/mcp-settings')
export class AiMcpSettingsController {
  constructor(private readonly adminService: AiMcpAdminService) {}

  @Get()
  get(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.adminService.getSettings(user, workspace);
  }

  @Patch()
  update(
    @Body() dto: UpdateAiMcpSettingsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.adminService.updateSettings(dto, user, workspace);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('ai/mcp-servers')
export class AiMcpServersController {
  constructor(private readonly adminService: AiMcpAdminService) {}

  @Get()
  async list(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return { items: await this.adminService.listServers(user, workspace) };
  }

  @Post()
  create(
    @Body() dto: CreateAiMcpServerDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.adminService.createServer(dto, user, workspace);
  }

  @Get(':serverId')
  get(
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.adminService.getServer(serverId, user, workspace);
  }

  @Patch(':serverId')
  update(
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: UpdateAiMcpServerDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.adminService.updateServer(serverId, dto, user, workspace);
  }

  @Delete(':serverId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.adminService.deleteServer(serverId, user, workspace);
  }

  @Post(':serverId/actions/test')
  test(
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.adminService.testServer(serverId, user, workspace);
  }

  @Post(':serverId/actions/discover')
  discover(
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.adminService.discoverServer(serverId, user, workspace);
  }
}
