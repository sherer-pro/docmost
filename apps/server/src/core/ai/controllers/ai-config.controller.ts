import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthPolicyScope } from '../../../common/decorators/auth-policy-scope.decorator';
import {
  AiStatusQueryDto,
  TestAiSpaceConfigDto,
  UpdateAiSpaceConfigDto,
} from '../dto/ai.dto';
import { AiConfigService } from '../services/ai-config.service';

@UseGuards(JwtAuthGuard)
@AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
@Controller('spaces/:spaceId/ai/config')
export class AiConfigController {
  constructor(private readonly aiConfigService: AiConfigService) {}

  @Get()
  get(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiConfigService.getAdminConfig(spaceId, user, workspace);
  }

  @Patch()
  update(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: UpdateAiSpaceConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiConfigService.updateConfig(spaceId, dto, user, workspace);
  }

  @Post('actions/test-model')
  testModel(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: TestAiSpaceConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiConfigService.testModel(spaceId, dto, user, workspace);
  }

  @Post('actions/test-retrieval')
  testRetrieval(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: TestAiSpaceConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiConfigService.testRetrieval(spaceId, dto, user, workspace);
  }

  @Post('actions/test-agent')
  testAgent(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: TestAiSpaceConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiConfigService.testAgent(spaceId, dto, user, workspace);
  }
}

@UseGuards(JwtAuthGuard)
@AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
@Controller('spaces/:spaceId/ai/status')
export class AiStatusController {
  constructor(private readonly aiConfigService: AiConfigService) {}

  @Get()
  get(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Query() query: AiStatusQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiConfigService.getStatus(
      spaceId,
      query.pageId,
      user,
      workspace,
    );
  }
}
