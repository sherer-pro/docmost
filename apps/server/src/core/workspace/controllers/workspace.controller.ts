import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from '../services/workspace.service';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { UpdateWorkspaceUserRoleDto } from '../dto/update-workspace-user-role.dto';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { WorkspaceInvitationService } from '../services/workspace-invitation.service';
import { Public } from '../../../common/decorators/public.decorator';
import {
  AcceptInviteDto,
  InvitationIdDto,
  InviteUserDto,
  RevokeInviteDto,
} from '../dto/invitation.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../casl/interfaces/workspace-ability.type';
import { FastifyReply, FastifyRequest } from 'fastify';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { CheckHostnameDto } from '../dto/check-hostname.dto';
import { RemoveWorkspaceUserDto } from '../dto/remove-workspace-user.dto';
import { DeactivateWorkspaceUserDto } from '../dto/deactivate-workspace-user.dto';
import { AuthCookieService } from '../../../common/security/auth-cookie.service';
import { PresenceService } from '../../presence/presence.service';
import { DeprecatedRoute } from '../../../common/decorators/deprecated-route.decorator';
import { LEGACY_API_SUNSET } from '../../../common/config/api-deprecation.constants';

@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceInvitationService: WorkspaceInvitationService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly environmentService: EnvironmentService,
    private authCookieService: AuthCookieService,
    private readonly presenceService: PresenceService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('/public')
  async getWorkspacePublicInfoViaGet(@Req() req: any) {
    return this.getWorkspacePublicInfo(req);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/workspace/public',
  })
  @Post('/public')
  async getWorkspacePublicInfo(@Req() req: any) {
    return this.workspaceService.getWorkspacePublicData(req.raw.workspaceId);
  }

  @HttpCode(HttpStatus.OK)
  @Get('/info')
  async getWorkspaceViaGet(@AuthWorkspace() workspace: Workspace) {
    return this.getWorkspace(workspace);
  }

  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/workspace/info',
  })
  @Post('/info')
  async getWorkspace(@AuthWorkspace() workspace: Workspace) {
    return this.workspaceService.getWorkspaceInfo(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: UpdateWorkspaceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }

    const updatedWorkspace = await this.workspaceService.update(
      workspace.id,
      dto,
    );

    if (
      dto.hostname &&
      dto.hostname === updatedWorkspace.hostname &&
      workspace.hostname !== updatedWorkspace.hostname
    ) {
      // log user out of old hostname
      this.authCookieService.clearAuthCookies(res);
    }

    return updatedWorkspace;
  }

  @HttpCode(HttpStatus.OK)
  @Get('members')
  async getWorkspaceMembersViaQuery(
    @Query()
    pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getWorkspaceMembers(pagination, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/workspace/members',
  })
  @Post('members')
  async getWorkspaceMembers(
    @Body()
    pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.workspaceService.getWorkspaceUsers(
      user,
      workspace.id,
      pagination,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Get('members/count')
  async getWorkspaceVisibleMembersCountViaGet(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getWorkspaceVisibleMembersCount(user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/workspace/members/count',
  })
  @Post('members/count')
  async getWorkspaceVisibleMembersCount(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.workspaceService.getWorkspaceVisibleUsersCount(
      user,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Get('members/presence')
  async getWorkspaceMembersPresence(
    @Query('userIds') userIds: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    const parsedUserIds = (userIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100);
    const visibleUserIds =
      await this.workspaceService.filterExistingWorkspaceUserIds(
        workspace.id,
        parsedUserIds,
      );

    return this.presenceService.getWorkspaceMembersPresence(
      workspace.id,
      visibleUserIds,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/deactivate')
  async deactivateWorkspaceMember(
    @Body() dto: DeactivateWorkspaceUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceService.deactivateUser(user, dto.userId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/delete')
  async deleteWorkspaceMember(
    @Body() dto: RemoveWorkspaceUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    await this.workspaceService.deleteUser(user, dto.userId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/change-role')
  async updateWorkspaceMemberRole(
    @Body() workspaceUserRoleDto: UpdateWorkspaceUserRoleDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceService.updateWorkspaceUserRole(
      user,
      workspaceUserRoleDto,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Get('invites')
  async getInvitationsViaQuery(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Query()
    pagination: PaginationOptions,
  ) {
    return this.getInvitations(user, workspace, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/workspace/invites',
  })
  @Post('invites')
  async getInvitations(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body()
    pagination: PaginationOptions,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.getInvitations(
      workspace.id,
      pagination,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('invites/info')
  async getInvitationByIdViaQuery(
    @Query() dto: InvitationIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getInvitationById(dto, workspace);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/workspace/invites/info',
  })
  @Post('invites/info')
  async getInvitationById(
    @Body() dto: InvitationIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.workspaceInvitationService.getInvitationById(
      dto.invitationId,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/create')
  async inviteUser(
    @Body() inviteUserDto: InviteUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.createInvitation(
      inviteUserDto,
      workspace,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/resend')
  async resendInvite(
    @Body() revokeInviteDto: RevokeInviteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.resendInvitation(
      revokeInviteDto.invitationId,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/revoke')
  async revokeInvite(
    @Body() revokeInviteDto: RevokeInviteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.revokeInvitation(
      revokeInviteDto.invitationId,
      workspace.id,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('invites/accept')
  async acceptInvite(
    @Body() acceptInviteDto: AcceptInviteDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.workspaceInvitationService.acceptInvitation(
      acceptInviteDto,
      workspace,
      req,
    );

    if (result.requiresLogin) {
      return {
        requiresLogin: true,
      };
    }

    this.authCookieService.setAuthCookies(res, result.authToken);

    return {
      requiresLogin: false,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/check-hostname')
  async checkHostname(@Body() checkHostnameDto: CheckHostnameDto) {
    return this.workspaceService.checkHostname(checkHostnameDto.hostname);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/link')
  async getInviteLink(
    @Body() inviteDto: InvitationIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (this.environmentService.isCloud()) {
      throw new ForbiddenException();
    }

    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    const inviteLink =
      await this.workspaceInvitationService.getInvitationLinkById(
        inviteDto.invitationId,
        workspace,
      );

    return { inviteLink };
  }
}
