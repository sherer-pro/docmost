import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly userRepo: UserRepo,
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
  @Get('me')
  @Post('me')
  async getUserInfo(
    @AuthUser() authUser: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const memberCount = await this.workspaceRepo.getActiveUserCount(
      workspace.id,
    );

    const { licenseKey, ...rest } = workspace;

    const workspaceInfo = {
      ...rest,
      memberCount,
      hasLicenseKey: Boolean(licenseKey),
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
      authUser.role === UserRole.OWNER ||
      authUser.role === UserRole.ADMIN ||
      (await this.userRepo.hasNonDefaultGroupMembership(authUser.id, workspace.id));

    return {
      user: {
        ...authUser,
        canAccessMembersDirectory,
      },
      workspace: workspaceInfo,
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
