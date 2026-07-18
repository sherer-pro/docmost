import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
} from '@casl/ability';
import {
  SpaceRole,
  UserRole,
} from '../../../common/helpers/types/permission';
import { User } from '@docmost/db/types/entity.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  SpaceCaslAction,
  ISpaceAbility,
  SpaceCaslSubject,
} from '../interfaces/space-ability.type';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';

@Injectable()
export default class SpaceAbilityFactory {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async createForUser(user: User, spaceId: string) {
    const [userSpaceRoles, space] = await Promise.all([
      this.spaceMemberRepo.getUserSpaceRoles(user.id, spaceId),
      this.db
        .selectFrom('spaces')
        .select(['archivedAt', 'workspaceId'])
        .where('id', '=', spaceId)
        .where('workspaceId', '=', user.workspaceId)
        .executeTakeFirst(),
    ]);

    if (!space) {
      throw new NotFoundException('Space permissions not found');
    }

    const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);
    const isArchived = !!space?.archivedAt;

    switch (userSpaceRole) {
      case SpaceRole.ADMIN:
        return buildSpaceAdminAbility(isArchived);
      case SpaceRole.WRITER:
        return buildSpaceWriterAbility(isArchived);
      case SpaceRole.READER:
        return buildSpaceReaderAbility();
      default:
        throw new NotFoundException('Space permissions not found');
    }
  }

  async assertHasFullSpaceAccess(user: User, spaceId: string): Promise<void> {
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('workspaceId', '=', user.workspaceId)
      .executeTakeFirst();

    if (!space) {
      throw new NotFoundException('Space permissions not found');
    }

    if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) {
      return;
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      spaceId,
    );
    const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);

    if (userSpaceRole !== SpaceRole.ADMIN) {
      throw new ForbiddenException();
    }
  }
}

function buildSpaceAdminAbility(isArchived = false) {
  const { can, build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings);
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Member);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Page);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Share);
  if (!isArchived) {
    can(SpaceCaslAction.Manage, SpaceCaslSubject.Page);
    can(SpaceCaslAction.Manage, SpaceCaslSubject.Share);
  }
  return build();
}

function buildSpaceWriterAbility(isArchived = false) {
  const { can, build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  can(SpaceCaslAction.Read, SpaceCaslSubject.Settings);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Member);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Page);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Share);
  if (!isArchived) {
    can(SpaceCaslAction.Manage, SpaceCaslSubject.Page);
    can(SpaceCaslAction.Manage, SpaceCaslSubject.Share);
  }
  return build();
}

function buildSpaceReaderAbility() {
  const { can, build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  can(SpaceCaslAction.Read, SpaceCaslSubject.Settings);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Member);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Page);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Share);
  return build();
}
