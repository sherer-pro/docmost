import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AiContentPolicyCandidatesQueryDto,
  UpdateAiContentPolicyDto,
} from './dto/ai-content-policy.dto';
import { AiContentPolicyService } from './ai-content-policy.service';

@UseGuards(JwtAuthGuard)
@Controller('spaces/:spaceId/ai/exclusions')
export class AiContentPolicyController {
  constructor(private readonly policy: AiContentPolicyService) {}

  @Get()
  get(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policy.getAdminPolicy(spaceId, user, workspace);
  }

  @Put()
  update(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: UpdateAiContentPolicyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policy.updatePolicy(spaceId, dto, user, workspace);
  }

  @Get('candidates')
  candidates(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Query() query: AiContentPolicyCandidatesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.policy.searchCandidates(spaceId, query, user, workspace);
  }
}
