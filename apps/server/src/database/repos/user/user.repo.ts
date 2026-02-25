import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { Users } from '@docmost/db/types/db';
import { hashPassword } from '../../../common/helpers';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableUser,
  UpdatableUser,
  User,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder, SelectQueryBuilder, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { UserRole } from '../../../common/helpers/types/permission';

@Injectable()
export class UserRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  public baseFields: Array<keyof Users> = [
    'id',
    'email',
    'name',
    'emailVerifiedAt',
    'avatarUrl',
    'role',
    'workspaceId',
    'locale',
    'timezone',
    'settings',
    'lastLoginAt',
    'deactivatedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'hasGeneratedPassword',
  ];

  async findById(
    userId: string,
    workspaceId: string,
    opts?: {
      includePassword?: boolean;
      includeUserMfa?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<User> {
    const db = dbOrTx(this.db, opts?.trx);
    return db
      .selectFrom('users')
      .select(this.baseFields)
      .$if(opts?.includePassword, (qb) => qb.select('password'))
      .$if(opts?.includeUserMfa, (qb) => qb.select(this.withUserMfa))
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async findByEmail(
    email: string,
    workspaceId: string,
    opts?: {
      includePassword?: boolean;
      includeUserMfa?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<User> {
    const db = dbOrTx(this.db, opts?.trx);
    return db
      .selectFrom('users')
      .select(this.baseFields)
      .$if(opts?.includePassword, (qb) => qb.select('password'))
      .$if(opts?.includeUserMfa, (qb) => qb.select(this.withUserMfa))
      .where(sql`LOWER(email)`, '=', sql`LOWER(${email})`)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async updateUser(
    updatableUser: UpdatableUser,
    userId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);

    return await db
      .updateTable('users')
      .set({ ...updatableUser, updatedAt: new Date() })
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async updateLastLogin(userId: string, workspaceId: string) {
    return await this.db
      .updateTable('users')
      .set({
        lastLoginAt: new Date(),
      })
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async insertUser(
    insertableUser: InsertableUser,
    trx?: KyselyTransaction,
  ): Promise<User> {
    const user: InsertableUser = {
      name:
        insertableUser.name || insertableUser.email.split('@')[0].toLowerCase(),
      email: insertableUser.email.toLowerCase(),
      password: await hashPassword(insertableUser.password),
      locale: 'en-US',
      role: insertableUser?.role,
      lastLoginAt: new Date(),
    };

    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('users')
      .values({ ...insertableUser, ...user })
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async roleCountByWorkspaceId(
    role: string,
    workspaceId: string,
  ): Promise<number> {
    const { count } = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.count('role').as('count'))
      .where('role', '=', role)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    return count as number;
  }

  /**
   * Returns the number of active users with a specific role in a workspace.
   *
   * Active users are users that are neither deleted nor deactivated.
   */
  async activeRoleCountByWorkspaceId(
    role: string,
    workspaceId: string,
  ): Promise<number> {
    const { count } = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.count('role').as('count'))
      .where('role', '=', role)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();

    return count as number;
  }


  /**
   * Checks whether a member can access the members directory.
   *
   * A member gets access if they belong to at least one non-default group
   * or at least one non-default space (directly or through a group).
   */
  async hasNonDefaultGroupMembership(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const membership = await this.db
      .selectFrom('workspaces')
      .select('workspaces.id')
      .where('workspaces.id', '=', workspaceId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('groupUsers as viewerGroupUsers')
            .innerJoin(
              'groups as viewerGroups',
              'viewerGroups.id',
              'viewerGroupUsers.groupId',
            )
            .select('viewerGroupUsers.groupId')
            .where('viewerGroupUsers.userId', '=', userId)
            .where('viewerGroups.workspaceId', '=', workspaceId)
            .where('viewerGroups.isDefault', '=', false),
        ),
      )
      .executeTakeFirst();

    if (membership) {
      return true;
    }

    const spaceMembership = await this.db
      .selectFrom('spaceMembers as viewerSpaceMembers')
      .innerJoin('spaces', 'spaces.id', 'viewerSpaceMembers.spaceId')
      .innerJoin('workspaces', 'workspaces.id', 'spaces.workspaceId')
      .leftJoin(
        'groupUsers as viewerSpaceGroupUsers',
        'viewerSpaceGroupUsers.groupId',
        'viewerSpaceMembers.groupId',
      )
      .select('viewerSpaceMembers.spaceId')
      .where('spaces.workspaceId', '=', workspaceId)
      .where('spaces.deletedAt', 'is', null)
      .whereRef('spaces.id', '!=', 'workspaces.defaultSpaceId')
      .where('viewerSpaceMembers.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('viewerSpaceMembers.userId', '=', userId),
          eb('viewerSpaceGroupUsers.userId', '=', userId),
        ]),
      )
      .executeTakeFirst();

    return Boolean(spaceMembership);
  }

  /**
   * Applies member visibility restrictions for workspace members list.
   *
   * Access rules:
   * - admin/owner can see all users in the workspace;
   * - member users can see users sharing at least one non-default group;
   * - member users can also see users sharing at least one non-default space.
   */
  private applyWorkspaceMemberVisibility<O>(
    query: SelectQueryBuilder<any, 'users', O>,
    workspaceId: string,
    authUser: User,
  ): SelectQueryBuilder<any, 'users', O> {
    if (authUser.role !== UserRole.MEMBER) {
      return query;
    }

    return query.where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('groupUsers as viewerGroupUsers')
            .innerJoin(
              'groups as viewerGroups',
              'viewerGroups.id',
              'viewerGroupUsers.groupId',
            )
            .innerJoin(
              'groupUsers as candidateGroupUsers',
              'candidateGroupUsers.groupId',
              'viewerGroupUsers.groupId',
            )
            .select('candidateGroupUsers.groupId')
            .whereRef('candidateGroupUsers.userId', '=', 'users.id')
            .where('viewerGroupUsers.userId', '=', authUser.id)
            .where('viewerGroups.workspaceId', '=', workspaceId)
            .where('viewerGroups.isDefault', '=', false),
        ),
        eb.exists(
          eb
            .selectFrom('spaceMembers as viewerSpaceMembers')
            .innerJoin('spaces', 'spaces.id', 'viewerSpaceMembers.spaceId')
            .innerJoin('workspaces', 'workspaces.id', 'spaces.workspaceId')
            .leftJoin(
              'groupUsers as viewerSpaceGroupUsers',
              'viewerSpaceGroupUsers.groupId',
              'viewerSpaceMembers.groupId',
            )
            .innerJoin(
              'spaceMembers as candidateSpaceMembers',
              'candidateSpaceMembers.spaceId',
              'viewerSpaceMembers.spaceId',
            )
            .leftJoin(
              'groupUsers as candidateSpaceGroupUsers',
              'candidateSpaceGroupUsers.groupId',
              'candidateSpaceMembers.groupId',
            )
            .select('candidateSpaceMembers.spaceId')
            .where('spaces.workspaceId', '=', workspaceId)
            .where('spaces.deletedAt', 'is', null)
            .whereRef('spaces.id', '!=', 'workspaces.defaultSpaceId')
            .where('viewerSpaceMembers.deletedAt', 'is', null)
            .where('candidateSpaceMembers.deletedAt', 'is', null)
            .where((innerEb) =>
              innerEb.or([
                innerEb('viewerSpaceMembers.userId', '=', authUser.id),
                innerEb('viewerSpaceGroupUsers.userId', '=', authUser.id),
              ]),
            )
            .where((innerEb) =>
              innerEb.or([
                innerEb.exists(
                  innerEb
                    .selectFrom('users as candidateUsers')
                    .select('candidateUsers.id')
                    .whereRef(
                      'candidateUsers.id',
                      '=',
                      'candidateSpaceMembers.userId',
                    )
                    .whereRef('candidateUsers.id', '=', 'users.id'),
                ),
                innerEb.exists(
                  innerEb
                    .selectFrom('users as candidateUsers')
                    .select('candidateUsers.id')
                    .whereRef(
                      'candidateUsers.id',
                      '=',
                      'candidateSpaceGroupUsers.userId',
                    )
                    .whereRef('candidateUsers.id', '=', 'users.id'),
                ),
              ]),
            ),
        ),
      ]),
    );
  }

  async getWorkspaceVisibleUsersCount(
    workspaceId: string,
    authUser: User,
  ): Promise<number> {
    const query = this.applyWorkspaceMemberVisibility(
      this.db
        .selectFrom('users')
        .select((eb) => eb.fn.count('users.id').distinct().as('count'))
        .where('users.workspaceId', '=', workspaceId)
        .where('users.deletedAt', 'is', null),
      workspaceId,
      authUser,
    );

    const result = await query.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async getUsersPaginated(
    workspaceId: string,
    pagination: PaginationOptions,
    authUser: User,
  ) {
    let query = this.applyWorkspaceMemberVisibility(
      this.db
        .selectFrom('users')
        .select(this.baseFields)
        .where('users.workspaceId', '=', workspaceId)
        .where('users.deletedAt', 'is', null),
      workspaceId,
      authUser,
    );

    if (pagination.query) {
      query = query.where((eb) =>
        eb(
          sql`f_unaccent(users.name)`,
          'ilike',
          sql`f_unaccent(${'%' + pagination.query + '%'})`,
        ).or(
          sql`users.email`,
          'ilike',
          sql`f_unaccent(${'%' + pagination.query + '%'})`,
        ),
      );
    }

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  /**
   * Возвращает список пользователей для подсказок с учетом правил видимости.
   *
   * Для роли MEMBER применяются те же ограничения, что и в каталоге участников:
   * пользователь видит только тех, с кем есть общие группы или пространства.
   */
  async getVisibleUsersForSuggestion(
    workspaceId: string,
    query: string,
    limit: number,
    authUser: User,
  ) {
    let usersQuery = this.applyWorkspaceMemberVisibility(
      this.db
        .selectFrom('users')
        .select(['id', 'name', 'email', 'avatarUrl'])
        .where('users.workspaceId', '=', workspaceId)
        .where('users.deletedAt', 'is', null),
      workspaceId,
      authUser,
    );

    if (query) {
      usersQuery = usersQuery.where((eb) =>
        eb.or([
          eb(
            sql`LOWER(f_unaccent(users.name))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
          eb(sql`users.email`, 'ilike', sql`f_unaccent(${`%${query}%`})`),
        ]),
      );
    }

    return usersQuery.limit(limit).execute();
  }


  async updatePreference(
    userId: string,
    prefKey: string,
    prefValue: string | boolean,
  ) {
    return await this.db
      .updateTable('users')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('preferences', COALESCE(settings->'preferences', '{}'::jsonb) 
                || jsonb_build_object('${sql.raw(prefKey)}', ${sql.lit(prefValue)}))`,
        updatedAt: new Date(),
      })
      .where('id', '=', userId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  withUserMfa(eb: ExpressionBuilder<any, 'users'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('userMfa')
        .select([
          'userMfa.id',
          'userMfa.method',
          'userMfa.isEnabled',
          'userMfa.secret',
          'userMfa.backupCodes',
          'userMfa.createdAt',
          'userMfa.updatedAt',
        ])
        .whereRef('userMfa.userId', '=', 'users.id')
        .whereRef('userMfa.workspaceId', '=', 'users.workspaceId'),
    ).as('mfa');
  }
}
