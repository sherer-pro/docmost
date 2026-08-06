import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthPolicyScope } from '../../../common/decorators/auth-policy-scope.decorator';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  RagSyncActionDto,
  RagSyncDestructiveActionDto,
  UpdateRagSyncSpaceConfigDto,
} from './rag-sync-admin.dto';
import { RagSyncAdminService } from './rag-sync-admin.service';

@UseGuards(JwtAuthGuard)
@AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
@Controller('spaces/:spaceId/ai/rag-sync')
export class RagSyncAdminController {
  constructor(private readonly service: RagSyncAdminService) {}

  @Get()
  get(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.getConfig(spaceId, user, workspace);
  }

  @Patch()
  update(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: UpdateRagSyncSpaceConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.updateConfig(spaceId, dto, user, workspace);
  }

  @Post('actions/test')
  test(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.testTarget(spaceId, user, workspace);
  }

  @Post('actions/enable')
  enable(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: RagSyncActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.enable(spaceId, dto, user, workspace);
  }

  @Post('actions/disable')
  disable(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: RagSyncActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.disable(spaceId, dto, user, workspace);
  }

  @Post('actions/retry-cleanup')
  retryCleanup(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: RagSyncActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.retryCleanup(spaceId, dto, user, workspace);
  }

  @Post('actions/force-disable')
  forceDisable(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: RagSyncDestructiveActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.forceDisable(spaceId, dto, user, workspace);
  }

  @Post('actions/abandon-cleanup')
  abandonCleanup(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: RagSyncDestructiveActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.abandonCleanup(spaceId, dto, user, workspace);
  }
}
