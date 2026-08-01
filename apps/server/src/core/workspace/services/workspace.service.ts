import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateWorkspaceDto } from '../dto/create-workspace.dto';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { SpaceService } from '../../space/services/space.service';
import { CreateSpaceDto } from '../../space/dto/create-space.dto';
import { SpaceRole, UserRole } from '../../../common/helpers/types/permission';
import { SpaceMemberService } from '../../space/services/space-member.service';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { InjectKysely } from 'nestjs-kysely';
import { AuthProvider, User } from '@docmost/db/types/entity.types';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { UpdateWorkspaceUserRoleDto } from '../dto/update-workspace-user-role.dto';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { DomainService } from '../../../integrations/environment/domain.service';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { DISALLOWED_HOSTNAMES } from '../workspace.constants';
import { SSO_PROVIDER_TYPES } from '../../sso/dto/sso.dto';
import { isUsableSsoProvider } from '../../sso/sso-provider.util';
import { v4 } from 'uuid';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { generateRandomSuffixNumbers } from '../../../common/helpers';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { WatcherRepo } from '@docmost/db/repos/watcher/watcher.repo';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { sql } from 'kysely';
import { SsoEndpointPolicyService } from '../../../integrations/environment/sso-endpoint-policy.service';

@Injectable()
export class WorkspaceService {
  constructor(
    private workspaceRepo: WorkspaceRepo,
    private spaceService: SpaceService,
    private spaceMemberService: SpaceMemberService,
    private groupRepo: GroupRepo,
    private groupUserRepo: GroupUserRepo,
    private userRepo: UserRepo,
    private environmentService: EnvironmentService,
    private domainService: DomainService,
    private shareRepo: ShareRepo,
    private watcherRepo: WatcherRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    private eventEmitter: EventEmitter2,
    private readonly ssoEndpointPolicy: SsoEndpointPolicyService,
  ) {}

  async findById(workspaceId: string) {
    return this.workspaceRepo.findById(workspaceId);
  }

  async getWorkspaceInfo(workspaceId: string) {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  async getWorkspacePublicData(workspaceId: string) {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select(['id', 'name', 'logo', 'hostname', 'enforceSso'])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('authProviders')
            .select([
              'authProviders.id',
              'authProviders.name',
              'authProviders.type',
            ])
            .where('authProviders.isEnabled', '=', true)
            .where('authProviders.deletedAt', 'is', null)
            .where('authProviders.type', 'in', [...SSO_PROVIDER_TYPES])
            .where((provider) =>
              provider.or([
                provider.and([
                  provider('authProviders.type', '=', 'oidc'),
                  provider('authProviders.oidcIssuer', 'is not', null),
                  provider('authProviders.oidcIssuer', '!=', ''),
                  provider('authProviders.oidcClientId', 'is not', null),
                  provider('authProviders.oidcClientId', '!=', ''),
                  provider('authProviders.oidcClientSecret', 'is not', null),
                  provider('authProviders.oidcClientSecret', '!=', ''),
                ]),
                provider.and([
                  provider('authProviders.type', '=', 'saml'),
                  provider('authProviders.samlUrl', 'is not', null),
                  provider('authProviders.samlUrl', '!=', ''),
                  provider('authProviders.samlCertificate', 'is not', null),
                  provider('authProviders.samlCertificate', '!=', ''),
                ]),
                provider.and([
                  provider('authProviders.type', '=', 'ldap'),
                  provider('authProviders.ldapUrl', 'is not', null),
                  provider('authProviders.ldapUrl', '!=', ''),
                  provider('authProviders.ldapBindDn', 'is not', null),
                  provider('authProviders.ldapBindDn', '!=', ''),
                  provider('authProviders.ldapBindPassword', 'is not', null),
                  provider('authProviders.ldapBindPassword', '!=', ''),
                  provider('authProviders.ldapBaseDn', 'is not', null),
                  provider('authProviders.ldapBaseDn', '!=', ''),
                  provider.or([
                    sql<boolean>`lower(${provider.ref('authProviders.ldapUrl')}) LIKE 'ldaps://%'`,
                    provider('authProviders.ldapTlsEnabled', '=', true),
                  ]),
                  sql<boolean>`coalesce(nullif(${provider.ref('authProviders.ldapUserSearchFilter')}, ''), '(mail={{username}})') LIKE '%{{username}}%'`,
                ]),
              ]),
            )
            .where('workspaceId', '=', workspaceId),
        ).as('authProviders'),
      )
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return {
      ...workspace,
      authProviders: workspace.authProviders,
    };
  }

  async create(
    user: User,
    createWorkspaceDto: CreateWorkspaceDto,
    trx?: KyselyTransaction,
  ) {
    const createdWorkspace = await executeTx(
      this.db,
      async (trx) => {
        let hostname = undefined;
        const settings = undefined;

        if (this.environmentService.isCloud()) {
          // generate unique hostname
          hostname = await this.generateHostname(
            createWorkspaceDto.hostname ?? createWorkspaceDto.name,
          );
        }

        // create workspace
        const workspace = await this.workspaceRepo.insertWorkspace(
          {
            name: createWorkspaceDto.name,
            description: createWorkspaceDto.description,
            hostname,
            settings,
          },
          trx,
        );

        // create default group
        const group = await this.groupRepo.createDefaultGroup(workspace.id, {
          userId: user.id,
          trx: trx,
        });

        // add user to workspace
        await trx
          .updateTable('users')
          .set({
            workspaceId: workspace.id,
            role: UserRole.OWNER,
          })
          .where('users.id', '=', user.id)
          .execute();

        // add user to default group created above
        await this.groupUserRepo.insertGroupUser(
          {
            userId: user.id,
            groupId: group.id,
          },
          trx,
        );

        // create default space
        const spaceInfo: CreateSpaceDto = {
          name: 'General',
          slug: 'general',
        };

        const createdSpace = await this.spaceService.create(
          user.id,
          workspace.id,
          spaceInfo,
          trx,
        );

        // and add user to space as owner
        await this.spaceMemberService.addUserToSpace(
          user.id,
          createdSpace.id,
          SpaceRole.ADMIN,
          workspace.id,
          trx,
        );

        // add default group to space as writer
        await this.spaceMemberService.addGroupToSpace(
          group.id,
          createdSpace.id,
          SpaceRole.WRITER,
          workspace.id,
          trx,
        );

        // update default spaceId
        workspace.defaultSpaceId = createdSpace.id;
        await this.workspaceRepo.updateWorkspace(
          {
            defaultSpaceId: createdSpace.id,
          },
          workspace.id,
          trx,
        );

        return workspace;
      },
      trx,
    );

    return createdWorkspace;
  }

  async addUserToWorkspace(
    userId: string,
    workspaceId: string,
    assignedRole?: UserRole,
    trx?: KyselyTransaction,
  ): Promise<void> {
    return await executeTx(
      this.db,
      async (trx) => {
        const workspace = await trx
          .selectFrom('workspaces')
          .select(['id', 'defaultRole'])
          .where('workspaces.id', '=', workspaceId)
          .executeTakeFirst();

        if (!workspace) {
          throw new BadRequestException('Workspace not found');
        }

        await trx
          .updateTable('users')
          .set({
            role: assignedRole ?? workspace.defaultRole,
            workspaceId: workspace.id,
          })
          .where('id', '=', userId)
          .execute();
      },
      trx,
    );
  }

  async update(workspaceId: string, updateWorkspaceDto: UpdateWorkspaceDto) {
    if (typeof updateWorkspaceDto.enforceSso !== 'undefined') {
      await executeTx(this.db, async (trx) => {
        await trx
          .selectFrom('workspaces')
          .select('id')
          .where('id', '=', workspaceId)
          .forUpdate()
          .executeTakeFirstOrThrow();

        if (updateWorkspaceDto.enforceSso) {
          const providers = await trx
            .selectFrom('authProviders')
            .selectAll()
            .where('isEnabled', '=', true)
            .where('deletedAt', 'is', null)
            .where('type', 'in', [...SSO_PROVIDER_TYPES])
            .where('workspaceId', '=', workspaceId)
            .execute();

          if (!(await this.hasAllowedSsoProvider(providers))) {
            throw new BadRequestException(
              'There must be at least one usable and allowed SSO provider to enforce SSO.',
            );
          }
        }

        await this.workspaceRepo.updateWorkspace(
          { enforceSso: updateWorkspaceDto.enforceSso },
          workspaceId,
          trx,
        );
      });
      delete updateWorkspaceDto.enforceSso;
    }

    if (updateWorkspaceDto.emailDomains) {
      const regex =
        /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]/;

      const emailDomains = updateWorkspaceDto.emailDomains || [];

      updateWorkspaceDto.emailDomains = emailDomains
        .map((domain) => regex.exec(domain)?.[0])
        .filter(Boolean);
    }

    if (updateWorkspaceDto.hostname) {
      const hostname = updateWorkspaceDto.hostname;
      if (DISALLOWED_HOSTNAMES.includes(hostname)) {
        throw new BadRequestException('Hostname already exists.');
      }
      if (await this.workspaceRepo.hostnameExists(hostname)) {
        throw new BadRequestException('Hostname already exists.');
      }
    }

    if (typeof updateWorkspaceDto.restrictApiToAdmins !== 'undefined') {
      await this.workspaceRepo.updateApiSettings(
        workspaceId,
        'restrictToAdmins',
        updateWorkspaceDto.restrictApiToAdmins,
      );
      delete updateWorkspaceDto.restrictApiToAdmins;
    }

    if (typeof updateWorkspaceDto.disablePublicSharing !== 'undefined') {
      await executeTx(this.db, async (trx) => {
        await this.workspaceRepo.updateSharingSettings(
          workspaceId,
          'disabled',
          updateWorkspaceDto.disablePublicSharing,
          trx,
        );

        if (updateWorkspaceDto.disablePublicSharing) {
          await this.shareRepo.deleteByWorkspaceId(workspaceId, trx);
        }
      });

      delete updateWorkspaceDto.disablePublicSharing;
    }

    if (typeof updateWorkspaceDto.tagSettings !== 'undefined') {
      await this.workspaceRepo.updateTagSettings(
        workspaceId,
        'disabled',
        updateWorkspaceDto.tagSettings.disabled ?? [],
      );
      delete updateWorkspaceDto.tagSettings;
    }

    await this.workspaceRepo.updateWorkspace(updateWorkspaceDto, workspaceId);

    return this.workspaceRepo.findById(workspaceId, {
      withMemberCount: true,
    });
  }

  private async hasAllowedSsoProvider(
    providers: AuthProvider[],
  ): Promise<boolean> {
    for (const provider of providers) {
      if (!isUsableSsoProvider(provider)) {
        continue;
      }

      const endpoint =
        provider.type === 'oidc'
          ? provider.oidcIssuer
          : provider.type === 'saml'
            ? provider.samlUrl
            : provider.ldapUrl;
      const protocols =
        provider.type === 'ldap'
          ? (['ldap:', 'ldaps:'] as const)
          : (['http:', 'https:'] as const);
      try {
        await this.ssoEndpointPolicy.assertAllowed(
          endpoint,
          protocols,
          'SSO provider',
        );
        return true;
      } catch {
        // Another configured provider may still make enforcement safe.
      }
    }

    return false;
  }

  async getWorkspaceUsers(
    user: User,
    workspaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<User>> {
    return this.userRepo.getUsersPaginated(workspaceId, pagination, user);
  }

  async getWorkspaceVisibleUsersCount(
    user: User,
    workspaceId: string,
  ): Promise<{ count: number }> {
    const count = await this.userRepo.getWorkspaceVisibleUsersCount(
      workspaceId,
      user,
    );

    return { count };
  }

  async filterExistingWorkspaceUserIds(
    workspaceId: string,
    userIds: string[],
  ): Promise<string[]> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    const users = await Promise.all(
      uniqueUserIds.map((userId) => this.userRepo.findById(userId, workspaceId)),
    );
    const visibleUserIds = new Set(
      users
        .filter((user) => user && !user.deletedAt)
        .map((user) => user.id),
    );

    return uniqueUserIds.filter((userId) => visibleUserIds.has(userId));
  }

  async updateWorkspaceUserRole(
    authUser: User,
    userRoleDto: UpdateWorkspaceUserRoleDto,
    workspaceId: string,
  ) {
    const user = await this.userRepo.findById(userRoleDto.userId, workspaceId);

    const newRole = userRoleDto.role.toLowerCase();

    if (!user) {
      throw new BadRequestException('Workspace member not found');
    }

    // prevent ADMIN from managing OWNER role
    if (
      (authUser.role === UserRole.ADMIN && newRole === UserRole.OWNER) ||
      (authUser.role === UserRole.ADMIN && user.role === UserRole.OWNER)
    ) {
      throw new ForbiddenException();
    }

    if (user.role === newRole) {
      return user;
    }

    const workspaceOwnerCount = await this.userRepo.roleCountByWorkspaceId(
      UserRole.OWNER,
      workspaceId,
    );

    if (user.role === UserRole.OWNER && workspaceOwnerCount === 1) {
      throw new BadRequestException(
        'There must be at least one workspace owner',
      );
    }

    await this.userRepo.updateUser(
      {
        role: newRole,
      },
      user.id,
      workspaceId,
    );
  }

  async generateHostname(
    name: string,
    trx?: KyselyTransaction,
  ): Promise<string> {
    let subdomain = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 20)
      .replace(/^-+|-+$/g, ''); //remove any hyphen at the start or end
    // Ensure we leave room for a random suffix.
    const maxSuffixLength = 6;

    if (subdomain.length < 4) {
      subdomain = `${subdomain}-${generateRandomSuffixNumbers(maxSuffixLength)}`;
    }

    if (DISALLOWED_HOSTNAMES.includes(subdomain)) {
      subdomain = `workspace-${generateRandomSuffixNumbers(maxSuffixLength)}`;
    }

    let uniqueHostname = subdomain;

    while (true) {
      const exists = await this.workspaceRepo.hostnameExists(
        uniqueHostname,
        trx,
      );
      if (!exists) {
        break;
      }
      // Append a random suffix and retry.
      const randomSuffix = generateRandomSuffixNumbers(maxSuffixLength);
      uniqueHostname = `${subdomain}-${randomSuffix}`.substring(0, 25);
    }

    return uniqueHostname;
  }

  async checkHostname(hostname: string) {
    const exists = await this.workspaceRepo.hostnameExists(hostname);
    if (!exists) {
      throw new NotFoundException('Hostname not found');
    }
    return { hostname: this.domainService.getUrl(hostname) };
  }


  /**
   * Deactivates a workspace member with guardrail validations.
   *
   * Guardrails:
   * - self-deactivation is forbidden;
   * - an admin cannot deactivate an owner;
   * - the last active owner in a workspace cannot be deactivated.
   */
  async deactivateUser(
    authUser: User,
    userId: string,
    workspaceId: string,
  ): Promise<{ success: true }> {
    const user = await this.userRepo.findById(userId, workspaceId);

    if (!user || user.deletedAt) {
      throw new BadRequestException('Workspace member not found');
    }

    if (authUser.id === userId) {
      throw new BadRequestException('You cannot deactivate yourself');
    }

    if (authUser.role === UserRole.ADMIN && user.role === UserRole.OWNER) {
      throw new BadRequestException(
        'You cannot deactivate a user with owner role',
      );
    }

    const activeWorkspaceOwnerCount =
      await this.userRepo.activeRoleCountByWorkspaceId(
        UserRole.OWNER,
        workspaceId,
      );

    if (
      user.role === UserRole.OWNER &&
      !user.deactivatedAt &&
      activeWorkspaceOwnerCount === 1
    ) {
      throw new BadRequestException(
        'There must be at least one workspace owner',
      );
    }

    if (user.deactivatedAt) {
      await this.userRepo.updateUser(
        {
          deactivatedAt: null,
        },
        userId,
        workspaceId,
      );

      return { success: true };
    }

    await this.userRepo.updateUser(
      {
        deactivatedAt: new Date(),
      },
      userId,
      workspaceId,
    );

    this.eventEmitter.emit(EventName.WORKSPACE_MEMBER_DEACTIVATED, {
      workspaceId,
      userId,
      actorId: authUser.id,
    });

    return { success: true };
  }

  async deleteUser(
    authUser: User,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId, workspaceId);

    if (!user || user.deletedAt) {
      throw new BadRequestException('Workspace member not found');
    }

    const workspaceOwnerCount = await this.userRepo.roleCountByWorkspaceId(
      UserRole.OWNER,
      workspaceId,
    );

    if (user.role === UserRole.OWNER && workspaceOwnerCount === 1) {
      throw new BadRequestException(
        'There must be at least one workspace owner',
      );
    }

    if (authUser.id === userId) {
      throw new BadRequestException('You cannot delete yourself');
    }

    if (authUser.role === UserRole.ADMIN && user.role === UserRole.OWNER) {
      throw new BadRequestException('You cannot delete a user with owner role');
    }

    await executeTx(this.db, async (trx) => {
      await this.userRepo.updateUser(
        {
          name: 'Deleted user',
          email: v4() + '@deleted.docmost.com',
          avatarUrl: null,
          settings: null,
          deletedAt: new Date(),
        },
        userId,
        workspaceId,
        trx,
      );

      await trx.deleteFrom('groupUsers').where('userId', '=', userId).execute();
      await trx
        .deleteFrom('spaceMembers')
        .where('userId', '=', userId)
        .execute();
      await trx
        .deleteFrom('authAccounts')
        .where('userId', '=', userId)
        .execute();

      await this.watcherRepo.deleteByUserAndWorkspace(userId, workspaceId, {
        trx,
      });
    });

    try {
      await this.attachmentQueue.add(QueueJob.DELETE_USER_AVATARS, user);
    } catch (err) {
      // empty
    }
  }
}
