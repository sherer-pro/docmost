import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { GroupService } from './services/group.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { GroupUserService } from './services/group-user.service';
import { GroupIdDto, GroupMembersQueryDto } from './dto/group-id.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { AddGroupUserDto } from './dto/add-group-user.dto';
import { RemoveGroupUserDto } from './dto/remove-group-user.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';

@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly groupUserService: GroupUserService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Get('/')
  getWorkspaceGroupsViaQuery(
    @Query() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getWorkspaceGroups(pagination, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/')
  getWorkspaceGroups(
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Group)) {
      throw new ForbiddenException();
    }

    return this.groupService.getWorkspaceGroups(workspace.id, pagination, user);
  }

  @HttpCode(HttpStatus.OK)
  @Get('/info')
  getGroupViaQuery(
    @Query() groupIdDto: GroupIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getGroup(groupIdDto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/info')
  getGroup(
    @Body() groupIdDto: GroupIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Group)) {
      throw new ForbiddenException();
    }
    return this.groupService.getGroupInfo(groupIdDto.groupId, workspace.id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  createGroup(
    @Body() createGroupDto: CreateGroupDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }
    return this.groupService.createGroup(user, workspace.id, createGroupDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  updateGroup(
    @Body() updateGroupDto: UpdateGroupDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    return this.groupService.updateGroup(workspace.id, updateGroupDto);
  }

  @HttpCode(HttpStatus.OK)
  @Get('members')
  getGroupMembersViaQuery(
    @Query() query: GroupMembersQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getGroupMembers(query, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members')
  getGroupMembers(
    @Body() groupIdDto: GroupMembersQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Group)) {
      throw new ForbiddenException();
    }

    return this.groupUserService.getGroupUsers(
      groupIdDto.groupId,
      workspace.id,
      groupIdDto,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/add')
  addGroupMember(
    @Body() addGroupUserDto: AddGroupUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    return this.groupUserService.addUsersToGroupBatch(
      addGroupUserDto.userIds,
      addGroupUserDto.groupId,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/remove')
  removeGroupMember(
    @Body() removeGroupUserDto: RemoveGroupUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    return this.groupUserService.removeUserFromGroup(
      removeGroupUserDto.userId,
      removeGroupUserDto.groupId,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  deleteGroup(
    @Body() groupIdDto: GroupIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }
    return this.groupService.deleteGroup(groupIdDto.groupId, workspace.id);
  }
}
