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
   * Возвращает профиль текущего пользователя и метаданные workspace.
   *
   * Исторически endpoint был POST (`/users/me`), из-за чего на него
   * распространялась CSRF-проверка как на mutating-запрос.
   * Для безопасного read-only сценария поддерживаем GET-вариант,
   * а POST сохраняем для обратной совместимости со старыми клиентами.
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
     * - member has access only if they belong to at least one non-default group.
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
