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
   * Shared filter that removes the event actor from the recipient list.
   *
   * It also removes duplicates and empty values so downstream processing
   * works only with a valid list of potential recipients.
   */
  excludeActor(userIds: string[], actorId: string): string[] {
    return [...new Set(userIds.filter((userId) => !!userId && userId !== actorId))];
  }

  /**
   * Resolves recipients for "document changed" and "comment added" events
   * from page settings: assigneeId and stakeholderIds.
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
   * Computes assignment deltas when a page is updated:
   * - new assignee;
   * - new stakeholders.
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
   * Applies the shared filter (exclude actor) and space access checks.
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
