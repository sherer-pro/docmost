import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageSettings } from '@docmost/db/types/entity.types';
import {
  getPageAssigneeId,
  getPageRoleRecipientIds,
  getPageStakeholderIds,
  normalizePageSettings,
} from '../../page/utils/page-settings.utils';
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

    const settings = normalizePageSettings(page.settings);
    const candidateUserIds = getPageRoleRecipientIds(settings);

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
    const prev = normalizePageSettings(currentSettings);
    const next = normalizePageSettings(nextSettings);

    const previousAssigneeId = getPageAssigneeId(prev);
    const nextAssigneeId = getPageAssigneeId(next);

    const newAssigneeId =
      nextAssigneeId && nextAssigneeId !== previousAssigneeId ? nextAssigneeId : null;

    const previousStakeholderIds = new Set(getPageStakeholderIds(prev));

    const newStakeholderIds = getPageStakeholderIds(next).filter(
      (stakeholderId) => !previousStakeholderIds.has(stakeholderId),
    );

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

}