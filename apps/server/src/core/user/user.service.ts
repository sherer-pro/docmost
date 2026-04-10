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
import {
  normalizeNotificationFrequency,
  normalizePageEditModePreference,
  normalizePreferenceBoolean,
  normalizeUserSettings,
} from './utils/user-preferences.util';

@Injectable()
export class UserService {
  constructor(private userRepo: UserRepo) {}

  private normalizeUserPreferencePayload<T extends { settings?: unknown }>(
    user: T,
  ): T {
    return {
      ...user,
      settings: normalizeUserSettings(user?.settings),
    };
  }

  private normalizeFullPageWidthByPageId(
    value: unknown,
  ): Record<string, boolean> {
    let parsedValue = value;

    if (typeof parsedValue === 'string') {
      try {
        parsedValue = JSON.parse(parsedValue);
      } catch {
        return {};
      }
    }

    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {};
    }

    return Object.entries(parsedValue).reduce<Record<string, boolean>>(
      (acc, [pageId, isFullWidth]) => {
        if (!pageId || typeof isFullWidth !== 'boolean') {
          return acc;
        }

        acc[pageId] = isFullWidth;
        return acc;
      },
      {},
    );
  }

  async findById(userId: string, workspaceId: string) {
    const user = await this.userRepo.findById(userId, workspaceId);
    if (!user) {
      return user;
    }

    return this.normalizeUserPreferencePayload(user);
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

    const currentPreferences = normalizeUserSettings(user.settings).preferences;

    // preference update
    const hasPreferenceUpdates =
      typeof updateUserDto.fullPageWidth !== 'undefined' ||
      typeof updateUserDto.fullPageWidthByPageId !== 'undefined' ||
      typeof updateUserDto.pageEditMode !== 'undefined' ||
      typeof updateUserDto.pushEnabled !== 'undefined' ||
      typeof updateUserDto.pushFrequency !== 'undefined' ||
      typeof updateUserDto.emailFrequency !== 'undefined' ||
      typeof updateUserDto.emailEnabled !== 'undefined';

    if (typeof updateUserDto.fullPageWidth !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'fullPageWidth',
        updateUserDto.fullPageWidth,
      );
    }

    if (typeof updateUserDto.fullPageWidthByPageId !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'fullPageWidthByPageId',
        this.normalizeFullPageWidthByPageId(
          updateUserDto.fullPageWidthByPageId,
        ),
      );
    }

    if (typeof updateUserDto.pageEditMode !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'pageEditMode',
        normalizePageEditModePreference(updateUserDto.pageEditMode),
      );
    }

    if (typeof updateUserDto.pushEnabled !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'pushEnabled',
        normalizePreferenceBoolean(
          updateUserDto.pushEnabled,
          currentPreferences.pushEnabled,
        ),
      );
    }

    if (typeof updateUserDto.pushFrequency !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'pushFrequency',
        normalizeNotificationFrequency(
          updateUserDto.pushFrequency,
          currentPreferences.pushFrequency,
        ),
      );
    }

    if (typeof updateUserDto.emailEnabled !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'emailEnabled',
        normalizePreferenceBoolean(
          updateUserDto.emailEnabled,
          currentPreferences.emailEnabled,
        ),
      );
    }

    if (typeof updateUserDto.emailFrequency !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'emailFrequency',
        normalizeNotificationFrequency(
          updateUserDto.emailFrequency,
          currentPreferences.emailFrequency,
        ),
      );
    }

    const hasProfileUpdates =
      updateUserDto.name != null ||
      updateUserDto.email != null ||
      updateUserDto.avatarUrl != null ||
      updateUserDto.locale != null;

    if (hasPreferenceUpdates && !hasProfileUpdates) {
      const updatedUser = await this.userRepo.findById(userId, workspace.id);

      if (!updatedUser) {
        throw new NotFoundException('User not found');
      }

      return this.normalizeUserPreferencePayload(updatedUser);
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
    delete updateUserDto.fullPageWidthByPageId;

    await this.userRepo.updateUser(updateUserDto, userId, workspace.id);

    const updatedUser = await this.userRepo.findById(userId, workspace.id);

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return this.normalizeUserPreferencePayload(updatedUser);
  }
}
