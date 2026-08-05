import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthPolicyScope } from '../../../common/decorators/auth-policy-scope.decorator';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  CreateAiAssistantProfileDto,
  UpdateAiAssistantProfileDto,
  UpdateAiAssistantProfilePreferencesDto,
  UpdateAiAssistantProfileWorkspacePolicyDto,
} from '../dto/ai-assistant-profile.dto';
import { AiAssistantProfileService } from '../services/ai-assistant-profile.service';

@UseGuards(JwtAuthGuard)
@Controller('ai/profile-policy')
export class AiAssistantProfilePolicyController {
  constructor(private readonly profiles: AiAssistantProfileService) {}

  @Get()
  get(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.profiles.getWorkspacePolicy(user, workspace);
  }

  @Patch()
  update(
    @Body() dto: UpdateAiAssistantProfileWorkspacePolicyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.updateWorkspacePolicy(dto, user, workspace);
  }
}

@UseGuards(JwtAuthGuard)
@AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
@Controller('spaces/:spaceId/ai')
export class AiAssistantProfileController {
  constructor(private readonly profiles: AiAssistantProfileService) {}

  @Get('profiles')
  list(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.list(spaceId, user, workspace);
  }

  @Get('profiles/:profileId')
  get(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.getAdmin(spaceId, profileId, user, workspace);
  }

  @Post('profiles')
  create(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: CreateAiAssistantProfileDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.create(spaceId, dto, user, workspace);
  }

  @Patch('profiles/:profileId')
  update(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateAiAssistantProfileDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.update(spaceId, profileId, dto, user, workspace);
  }

  @Delete('profiles/:profileId')
  remove(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.remove(spaceId, profileId, user, workspace);
  }

  @Post('profiles/:profileId/actions/test-model')
  testModel(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.testModel(spaceId, profileId, user, workspace);
  }

  @Post('profiles/:profileId/actions/test-agent')
  testAgent(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.testAgent(spaceId, profileId, user, workspace);
  }

  @Get('profile-preferences')
  getPreferences(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.getPreferences(spaceId, user, workspace);
  }

  @Put('profile-preferences')
  updatePreferences(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: UpdateAiAssistantProfilePreferencesDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.profiles.updatePreferences(spaceId, dto, user, workspace);
  }
}
