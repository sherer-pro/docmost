import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthPolicyScope } from '../../../common/decorators/auth-policy-scope.decorator';
import {
  UpdateAiBuiltinToolSpacePolicyDto,
  UpdateAiBuiltinToolWorkspacePolicyDto,
} from '../dto/ai-builtin-tool-policy.dto';
import { AiBuiltinToolPolicyService } from '../tools/ai-builtin-tool-policy.service';

@UseGuards(JwtAuthGuard)
@Controller('ai/tool-policy')
export class AiBuiltinToolWorkspacePolicyController {
  constructor(private readonly policy: AiBuiltinToolPolicyService) {}

  @Get()
  get(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.policy.getWorkspaceView(user, workspace);
  }

  @Patch()
  update(
    @Body() dto: UpdateAiBuiltinToolWorkspacePolicyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policy.updateWorkspace(dto, user, workspace);
  }
}

@UseGuards(JwtAuthGuard)
@AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
@Controller('spaces/:spaceId/ai/tool-policy')
export class AiBuiltinToolSpacePolicyController {
  constructor(private readonly policy: AiBuiltinToolPolicyService) {}

  @Get()
  get(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policy.getSpaceView(spaceId, user, workspace);
  }

  @Put()
  update(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: UpdateAiBuiltinToolSpacePolicyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policy.updateSpace(spaceId, dto, user, workspace);
  }
}
