import { UserRepo } from '@docmost/db/repos/user/user.repo';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { comparePasswordHash } from '../../common/helpers/utils';
import { Workspace } from '@docmost/db/types/entity.types';
import { validateSsoEnforcement } from '../auth/auth.util';

@Injectable()
export class UserService {
  constructor(private userRepo: UserRepo) {}

  async findById(userId: string, workspaceId: string) {
    return this.userRepo.findById(userId, workspaceId);
  }

  async update(
    updateUserDto: UpdateUserDto,
    userId: string,
    workspace: Workspace,
  ) {
    const includePassword =
      updateUserDto.email != null && updateUserDto.confirmPassword != null;

    const user = await this.userRepo.findById(userId, workspace.id, {
      includePassword,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // preference update
    const hasPreferenceUpdates =
      typeof updateUserDto.fullPageWidth !== 'undefined' ||
      typeof updateUserDto.pageEditMode !== 'undefined' ||
      typeof updateUserDto.pushEnabled !== 'undefined' ||
      typeof updateUserDto.pushFrequency !== 'undefined' ||
      typeof updateUserDto.emailEnabled !== 'undefined' ||
      typeof updateUserDto.rememberPageScrollPosition !== 'undefined';

    let preferenceUser = null;

    if (typeof updateUserDto.fullPageWidth !== 'undefined') {
      preferenceUser = await this.userRepo.updatePreference(
        userId,
        'fullPageWidth',
        updateUserDto.fullPageWidth,
      );
    }

    if (typeof updateUserDto.pageEditMode !== 'undefined') {
      preferenceUser = await this.userRepo.updatePreference(
        userId,
        'pageEditMode',
        updateUserDto.pageEditMode.toLowerCase(),
      );
    }

    if (typeof updateUserDto.pushEnabled !== 'undefined') {
      preferenceUser = await this.userRepo.updatePreference(
        userId,
        'pushEnabled',
        updateUserDto.pushEnabled,
      );
    }

    if (typeof updateUserDto.pushFrequency !== 'undefined') {
      preferenceUser = await this.userRepo.updatePreference(
        userId,
        'pushFrequency',
        updateUserDto.pushFrequency,
      );
    }

    if (typeof updateUserDto.emailEnabled !== 'undefined') {
      preferenceUser = await this.userRepo.updatePreference(
        userId,
        'emailEnabled',
        updateUserDto.emailEnabled,
      );
    }

    if (typeof updateUserDto.rememberPageScrollPosition !== 'undefined') {
      preferenceUser = await this.userRepo.updatePreference(
        userId,
        'rememberPageScrollPosition',
        updateUserDto.rememberPageScrollPosition,
      );
    }

    const hasProfileUpdates =
      updateUserDto.name != null ||
      updateUserDto.email != null ||
      updateUserDto.avatarUrl != null ||
      updateUserDto.locale != null;

    if (hasPreferenceUpdates && !hasProfileUpdates) {
      return preferenceUser;
    }

    if (updateUserDto.name) {
      user.name = updateUserDto.name;
    }

    if (updateUserDto.email && user.email != updateUserDto.email) {
      validateSsoEnforcement(workspace);

      if (!updateUserDto.confirmPassword) {
        throw new BadRequestException(
          'You must provide a password to change your email',
        );
      }

      const isPasswordMatch = await comparePasswordHash(
        updateUserDto.confirmPassword,
        user.password,
      );

      if (!isPasswordMatch) {
        throw new BadRequestException(
          'You must provide the correct password to change your email',
        );
      }

      if (await this.userRepo.findByEmail(updateUserDto.email, workspace.id)) {
        throw new BadRequestException('A user with this email already exists');
      }

      user.email = updateUserDto.email;
    }

    if (updateUserDto.avatarUrl) {
      user.avatarUrl = updateUserDto.avatarUrl;
    }

    if (updateUserDto.locale) {
      user.locale = updateUserDto.locale;
    }

    delete updateUserDto.confirmPassword;

    await this.userRepo.updateUser(updateUserDto, userId, workspace.id);
    return user;
  }
}
