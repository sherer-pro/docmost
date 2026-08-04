import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserRole } from '../../common/helpers/types/permission';
import { DeprecatedRoute } from '../../common/decorators/deprecated-route.decorator';
import { LEGACY_API_SUNSET } from '../../common/config/api-deprecation.constants';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { AuthenticationAssuranceService } from '../space-policy/authentication-assurance.service';
import { FastifyRequest } from 'fastify';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly userRepo: UserRepo,
    private readonly authenticationAssurance: AuthenticationAssuranceService,
  ) {}

  /**
   * Returns the current user's profile and workspace metadata.
   *
   * Historically this endpoint was POST (`/users/me`), so it
   * was subject to CSRF checks as a mutating request.
   * For a safe read-only scenario, we support a GET variant,
   * while keeping POST for backward compatibility with older clients.
   */
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @AuthPolicyScope('bootstrap')
  @Get('me')
  async getUserInfoViaGet(
    @AuthUser() authUser: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.getUserInfo(authUser, workspace, req);
  }

  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/users/me',
  })
  @AuthPolicyScope('bootstrap')
  @Post('me')
  async getUserInfo(
    @AuthUser() authUser: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    const user = await this.userService.findById(authUser.id, workspace.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    /**
     * For MEMBER users, return only the number of users they are allowed to see
     * (shared non-default groups/spaces).
     *
     * This prevents leaking the total workspace member count when
     * there is no shared context with other users.
     */
    const memberCount =
      user.role === UserRole.MEMBER
        ? await this.userRepo.getWorkspaceVisibleUsersCount(workspace.id, user)
        : await this.workspaceRepo.getActiveUserCount(workspace.id);

    const workspaceInfo = {
      ...workspace,
      memberCount,
    };

    /**
     * Flag used by the client to control visibility of the "Manage members" item.
     *
     * Rules:
     * - owner/admin always have access;
     * - member has access if they belong to at least one non-default group
     *   or at least one non-default space.
     */
    const canAccessMembersDirectory =
      user.role === UserRole.OWNER ||
      user.role === UserRole.ADMIN ||
      (await this.userRepo.hasNonDefaultGroupMembership(user.id, workspace.id));

    return {
      user: {
        ...user,
        canAccessMembersDirectory,
      },
      workspace: workspaceInfo,
      authenticationAssurance:
        this.authenticationAssurance.getAuthenticationAssurance(
          workspace,
          (req as any).user?.session ?? (req.raw as any).userSession,
        ),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateUser(
    @Body() updateUserDto: UpdateUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.userService.update(updateUserDto, user.id, workspace);
  }
}
