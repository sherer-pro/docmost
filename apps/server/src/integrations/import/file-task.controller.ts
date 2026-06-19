import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { FileTaskIdDto } from './dto/file-task-dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageAccessService } from '../../core/page-access/page-access.service';
import { FileTaskQueryService } from './services/file-task-query.service';

@Controller('file-tasks')
export class FileTaskController {
  constructor(
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    private readonly fileTaskQueryService: FileTaskQueryService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post()
  async getFileTasks(
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }

    return this.fileTaskQueryService.findForUser(user.id, pagination);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getFileTask(@Body() dto: FileTaskIdDto, @AuthUser() user: User) {
    const fileTask = await this.fileTaskQueryService.findById(dto.fileTaskId);

    if (!fileTask || !fileTask.spaceId) {
      throw new NotFoundException('File task not found');
    }

    const ability = await this.spaceAbility.createForUser(
      user,
      fileTask.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(
          user,
          fileTask.spaceId,
        );
      if (!hasReadablePages) {
        throw new ForbiddenException();
      }
    }

    return fileTask;
  }
}
