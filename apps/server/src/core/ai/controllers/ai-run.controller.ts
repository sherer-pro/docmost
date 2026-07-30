import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiRunActionDto, SendAiMessageDto } from '../dto/ai.dto';
import { AiRunService } from '../services/ai-run.service';
import { AiRunStepService } from '../services/ai-run-step.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class AiRunController {
  constructor(
    private readonly runs: AiRunService,
    private readonly steps: AiRunStepService,
  ) {}

  @Post('ai/conversations/:id/messages')
  @HttpCode(202)
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAiMessageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runs.send(id, dto, user, workspace);
  }

  @Get('ai/runs/:id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runs.get(id, user, workspace);
  }

  @Post('ai/runs/:id/actions/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runs.cancel(id, user, workspace);
  }

  @Post('ai/runs/:id/actions/retry')
  @HttpCode(202)
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AiRunActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runs.retry(id, dto, user, workspace);
  }

  @Post('ai/messages/:id/actions/regenerate')
  @HttpCode(202)
  regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AiRunActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runs.regenerate(id, dto, user, workspace);
  }

  @Post('ai/runs/:runId/steps/:stepId/actions/approve')
  approveStep(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.steps.approve(runId, stepId, user, workspace);
  }

  @Post('ai/runs/:runId/steps/:stepId/actions/reject')
  rejectStep(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.steps.reject(runId, stepId, user, workspace);
  }
}
