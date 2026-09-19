import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { Space, User, Workspace } from '@docmost/db/types/entity.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { SpacePolicyService } from '../../space-policy/space-policy.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { SpaceAdministrationDto } from '../dto/space-administration.dto';
import type {
  SpaceAdministrationItem,
  SpaceAdministrationResponse,
} from '@docmost/api-contract';

@Injectable()
export class SpaceAdministrationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly members: SpaceMemberRepo,
    private readonly spaces: SpaceRepo,
    private readonly policies: SpacePolicyService,
    private readonly environment: EnvironmentService,
  ) {}

  async list(
    user: User,
    workspace: Workspace,
    session: any,
    options: SpaceAdministrationDto,
  ): Promise<SpaceAdministrationResponse> {
    if (options.cursor && options.beforeCursor) {
      throw new BadRequestException('Use only one pagination cursor');
    }
    const workspaceAdmin = user.role === 'owner' || user.role === 'admin';
    let query = this.db
      .selectFrom('spaces')
      .select([
        'spaces.id',
        'spaces.name',
        'spaces.slug',
        'spaces.description',
        'spaces.logo',
        'spaces.archivedAt',
        'spaces.settings',
      ])
      .select((eb) => this.spaces.withMemberCount(eb))
      .select(sql<string>`lower(spaces.name)`.as('sortName'))
      .where('spaces.workspaceId', '=', workspace.id)
      .where('spaces.deletedAt', 'is', null);
    if (!workspaceAdmin) {
      query = query.where(
        'spaces.id',
        'in',
        this.members.getUserSpaceIdsQuery(user.id, {
          includeArchived: true,
          activeMembershipsOnly: true,
        }),
      );
    }
    if (options.status !== 'all') {
      query = query.where(
        'spaces.archivedAt',
        options.status === 'archived' ? 'is not' : 'is',
        null,
      );
    }
    if (options.query?.trim()) {
      const pattern = `%${options.query.trim().replace(/[\\%_]/g, '\\$&')}%`;
      query = query.where((eb) =>
        eb.or([
          sql<boolean>`f_unaccent(spaces.name) ilike f_unaccent(${pattern})`,
          sql<boolean>`f_unaccent(coalesce(spaces.description, '')) ilike f_unaccent(${pattern})`,
          eb('spaces.slug', 'ilike', pattern),
        ]),
      );
    }
    const result = await executeWithCursorPagination(query, {
      perPage: options.limit,
      cursor: options.cursor,
      beforeCursor: options.beforeCursor,
      fields: [
        {
          expression: sql`lower(spaces.name)`,
          key: 'sortName' as const,
          direction: 'asc' as const,
        },
        {
          expression: 'spaces.id' as const,
          key: 'id' as const,
          direction: 'asc' as const,
        },
      ],
      decodeCursor: (cursor) => {
        try {
          const entries = [
            ...new URLSearchParams(
              Buffer.from(cursor, 'base64url').toString('utf8'),
            ),
          ];
          if (
            entries.length !== 2 ||
            entries[0][0] !== 'sortName' ||
            entries[1][0] !== 'id' ||
            !isUUID(entries[1][1])
          ) {
            throw new Error('Invalid cursor fields');
          }
          return { sortName: entries[0][1], id: entries[1][1] };
        } catch {
          throw new BadRequestException('Invalid space administration cursor');
        }
      },
      parseCursor: (cursor) => ({ sortName: cursor.sortName, id: cursor.id }),
    });
    const ids = result.items.map((item) => item.id);
    if (!ids.length) return { ...result, items: [] };
    const [admins, templates, ai] = await Promise.all([
      workspaceAdmin
        ? Promise.resolve([])
        : this.db
            .selectFrom('spaceMembers as member')
            .leftJoin('groupUsers as gu', 'gu.groupId', 'member.groupId')
            .leftJoin('groups as g', 'g.id', 'member.groupId')
            .select('member.spaceId')
            .distinct()
            .where('member.spaceId', 'in', ids)
            .where('member.role', '=', 'admin')
            .where('member.deletedAt', 'is', null)
            .where((eb) =>
              eb.or([
                eb('member.userId', '=', user.id),
                eb.and([
                  eb('gu.userId', '=', user.id),
                  eb('g.workspaceId', '=', workspace.id),
                  eb('g.deletedAt', 'is', null),
                ]),
              ]),
            )
            .execute(),
      this.db
        .selectFrom('pageTemplateSpacePolicies')
        .select(['spaceId', 'templatesEnabled'])
        .where('workspaceId', '=', workspace.id)
        .where('spaceId', 'in', ids)
        .execute(),
      this.db
        .selectFrom('aiSpaceConfigs')
        .select(['spaceId', 'enabled'])
        .select(
          sql<boolean>`coalesce(length(base_url) > 0 and length(chat_model) > 0, false)`.as(
            'configured',
          ),
        )
        .where('workspaceId', '=', workspace.id)
        .where('spaceId', 'in', ids)
        .execute(),
    ]);
    const adminIds = new Set(admins.map((item) => item.spaceId));
    const templateMap = new Map(
      templates.map((item) => [item.spaceId, item.templatesEnabled]),
    );
    const aiMap = new Map(ai.map((item) => [item.spaceId, item]));
    return {
      ...result,
      items: result.items.map((space): SpaceAdministrationItem => {
        const policy = this.policies.resolveFromSettings(
          workspace,
          space.settings,
        );
        const requiresStepUp = !this.policies.evaluateAuthentication(
          policy.effective,
          session ?? {},
        ).satisfied;
        const canManage =
          !requiresStepUp && (workspaceAdmin || adminIds.has(space.id));
        const identity = {
          id: space.id,
          name: space.name,
          slug: space.slug,
          archivedAt: space.archivedAt
            ? new Date(space.archivedAt).toISOString()
            : null,
          requiresStepUp,
          canManage,
        };
        if (requiresStepUp) return identity;
        const basic = {
          ...identity,
          description: space.description,
          logo: space.logo,
        };
        if (!canManage) return basic;
        const config = aiMap.get(space.id);
        return {
          ...basic,
          memberCount: space.memberCount,
          access: policy.effective,
          features: {
            templates: !this.environment.isPageTemplatesEnabled()
              ? 'server_disabled'
              : templateMap.get(space.id)
                ? 'enabled'
                : 'disabled',
            dictionary: (space.settings as any)?.dictionary?.enabled === true,
            ai: !config?.configured
              ? 'not_configured'
              : config.enabled
                ? 'enabled'
                : 'disabled',
          },
        };
      }),
    };
  }
}
