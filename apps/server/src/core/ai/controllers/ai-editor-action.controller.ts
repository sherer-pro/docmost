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
import { CreateAiEditorActionDto } from '../dto/ai.dto';
import { AiAuxRunService } from '../services/ai-aux-run.service';

@UseGuards(JwtAuthGuard)
@Controller('ai/editor-actions')
export class AiEditorActionController {
  constructor(private readonly auxRuns: AiAuxRunService) {}

  @Post()
  @HttpCode(202)
  create(
    @Body() dto: CreateAiEditorActionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.auxRuns.createEditorAction(dto, user, workspace);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.auxRuns.getEditorAction(id, user, workspace);
  }

  @Post(':id/actions/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.auxRuns.cancelEditorAction(id, user, workspace);
  }
}
