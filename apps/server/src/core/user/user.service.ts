import { UserRepo } from '@docmost/db/repos/user/user.repo';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { UpdateUserDto } from './dto/update-user.dto';
import { comparePasswordHash } from '../../common/helpers/utils';
import { Workspace } from '@docmost/db/types/entity.types';
import { validateSsoEnforcement } from '../auth/auth.util';
import {
  normalizeAiPanelWidth,
  normalizeAsideTabPreference,
  normalizeBooleanPreferenceByPageId,
  normalizeNotificationFrequency,
  normalizePageEditModeByPageId,
  normalizePreferenceBoolean,
  normalizeUserSettings,
} from './utils/user-preferences.util';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EventName } from '../../common/events/event.contants';

@Injectable()
export class UserService {
  constructor(
    private userRepo: UserRepo,
    @Optional() @InjectKysely() private readonly db?: KyselyDB,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

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
    delete (updateUserDto as UpdateUserDto & { pageEditMode?: unknown }).pageEditMode;

    // preference update
    const hasPreferenceUpdates =
      typeof updateUserDto.fullPageWidth !== 'undefined' ||
      typeof updateUserDto.fixedToolbar !== 'undefined' ||
      typeof updateUserDto.aiPanelOpen !== 'undefined' ||
      typeof updateUserDto.aiPanelWidth !== 'undefined' ||
      typeof updateUserDto.aiPanelTab !== 'undefined' ||
      typeof updateUserDto.fullPageWidthByPageId !== 'undefined' ||
      typeof updateUserDto.headingNumberingByPageId !== 'undefined' ||
      typeof updateUserDto.pageEditModeByPageId !== 'undefined' ||
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

    if (typeof updateUserDto.fixedToolbar !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'fixedToolbar',
        normalizePreferenceBoolean(
          updateUserDto.fixedToolbar,
          currentPreferences.fixedToolbar,
        ),
      );
    }

    if (typeof updateUserDto.aiPanelOpen !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'aiPanelOpen',
        normalizePreferenceBoolean(
          updateUserDto.aiPanelOpen,
          currentPreferences.aiPanelOpen,
        ),
      );
    }

    if (typeof updateUserDto.aiPanelWidth !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'aiPanelWidth',
        normalizeAiPanelWidth(
          updateUserDto.aiPanelWidth,
          currentPreferences.aiPanelWidth,
        ),
      );
    }

    if (typeof updateUserDto.aiPanelTab !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'aiPanelTab',
        normalizeAsideTabPreference(
          updateUserDto.aiPanelTab,
          currentPreferences.aiPanelTab,
        ),
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

    if (typeof updateUserDto.headingNumberingByPageId !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'headingNumberingByPageId',
        normalizeBooleanPreferenceByPageId(
          updateUserDto.headingNumberingByPageId,
        ),
      );
    }

    if (typeof updateUserDto.pageEditModeByPageId !== 'undefined') {
      await this.userRepo.updatePreference(
        userId,
        workspace.id,
        'pageEditModeByPageId',
        normalizePageEditModeByPageId(updateUserDto.pageEditModeByPageId),
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

    const displayNameChanged = Boolean(
      updateUserDto.name && updateUserDto.name !== user.name,
    );
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
    delete updateUserDto.fixedToolbar;
    delete updateUserDto.aiPanelOpen;
    delete updateUserDto.aiPanelWidth;
    delete updateUserDto.aiPanelTab;
    delete updateUserDto.fullPageWidthByPageId;
    delete updateUserDto.headingNumberingByPageId;
    delete updateUserDto.pageEditModeByPageId;

    await this.userRepo.updateUser(updateUserDto, userId, workspace.id);

    const updatedUser = await this.userRepo.findById(userId, workspace.id);

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    if (displayNameChanged && this.db) {
      const affectedSpaces = await this.db
        .selectFrom('pages')
        .select('spaceId')
        .distinct()
        .where('workspaceId', '=', workspace.id)
        .where('deletedAt', 'is', null)
        .where(
          sql<boolean>`(
            settings ->> 'assigneeId' = ${userId}
            OR COALESCE(settings -> 'stakeholderIds', '[]'::jsonb) ? ${userId}
          )`,
        )
        .execute();
      for (const affected of affectedSpaces) {
        void this.eventEmitter
          ?.emitAsync(EventName.RAG_SYNC_SCOPE_CHANGED, {
            spaceId: affected.spaceId,
          })
          .catch(() => undefined);
      }
    }

    if (displayNameChanged) {
      void this.eventEmitter
        ?.emitAsync(EventName.USER_DISPLAY_NAME_CHANGED, {
          userId,
          workspaceId: workspace.id,
        })
        .catch(() => undefined);
    }

    return this.normalizeUserPreferencePayload(updatedUser);
  }
}
