import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageSettings } from '@docmost/db/types/entity.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';

@Injectable()
export class RecipientResolverService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  /**
   * Общий фильтр, который убирает инициатора события из списка получателей.
   *
   * Дополнительно удаляются дубли и пустые значения, чтобы ниже по пайплайну
   * работать только с валидным списком потенциальных получателей.
   */
  excludeActor(userIds: string[], actorId: string): string[] {
    return [...new Set(userIds.filter((userId) => !!userId && userId !== actorId))];
  }

  /**
   * Достаёт получателей для событий «документ изменён» и «комментарий добавлен»
   * из настроек страницы: assigneeId и stakeholderIds.
   */
  async resolvePageRoleRecipients(
    pageId: string,
    spaceId: string,
    actorId: string,
  ): Promise<string[]> {
    const page = await this.db
      .selectFrom('pages')
      .select(['settings'])
      .where('id', '=', pageId)
      .executeTakeFirst();

    if (!page) {
      return [];
    }

    const settings = this.normalizeSettings(page.settings);
    const candidateUserIds = this.extractSettingsRecipients(settings);

    return this.filterUsersWithSpaceAccess(candidateUserIds, spaceId, actorId);
  }

  /**
   * Вычисляет дельту назначений при обновлении страницы:
   * - новый assignee;
   * - новые stakeholder'ы.
   */
  resolveAssignmentDelta(
    currentSettings: PageSettings | null,
    nextSettings: PageSettings | null,
  ): {
    newAssigneeId: string | null;
    newStakeholderIds: string[];
  } {
    const prev = this.normalizeSettings(currentSettings);
    const next = this.normalizeSettings(nextSettings);

    const previousAssigneeId = typeof prev.assigneeId === 'string' ? prev.assigneeId : null;
    const nextAssigneeId = typeof next.assigneeId === 'string' ? next.assigneeId : null;

    const newAssigneeId =
      nextAssigneeId && nextAssigneeId !== previousAssigneeId ? nextAssigneeId : null;

    const previousStakeholderIds = new Set(
      Array.isArray(prev.stakeholderIds) ? prev.stakeholderIds.filter(Boolean) : [],
    );

    const newStakeholderIds = Array.isArray(next.stakeholderIds)
      ? next.stakeholderIds.filter(
          (stakeholderId): stakeholderId is string =>
            !!stakeholderId && !previousStakeholderIds.has(stakeholderId),
        )
      : [];

    return {
      newAssigneeId,
      newStakeholderIds: [...new Set(newStakeholderIds)],
    };
  }

  /**
   * Применяет общий фильтр (исключить actor) и проверку доступа в space.
   */
  async filterUsersWithSpaceAccess(
    candidateUserIds: string[],
    spaceId: string,
    actorId: string,
  ): Promise<string[]> {
    const filteredIds = this.excludeActor(candidateUserIds, actorId);

    if (filteredIds.length === 0) {
      return [];
    }

    const usersWithAccess = await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
      filteredIds,
      spaceId,
    );

    return filteredIds.filter((userId) => usersWithAccess.has(userId));
  }

  private extractSettingsRecipients(settings: PageSettings): string[] {
    const assigneeId = typeof settings.assigneeId === 'string' ? settings.assigneeId : null;
    const stakeholderIds = Array.isArray(settings.stakeholderIds)
      ? settings.stakeholderIds.filter(
          (stakeholderId): stakeholderId is string => !!stakeholderId,
        )
      : [];

    return [...new Set([...(assigneeId ? [assigneeId] : []), ...stakeholderIds])];
  }

  private normalizeSettings(settings: unknown): PageSettings {
    if (!settings || typeof settings !== 'object') {
      return {};
    }

    return settings as PageSettings;
  }
}
