import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { DB, Users } from '@docmost/db/types/db';
import { hashPassword } from '../../../common/helpers';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableUser,
  UpdatableUser,
  User,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder, sql } from 'kysely';
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
   * Checks whether a user belongs to at least one non-default group in a workspace.
   *
   * Used to control access to the workspace members directory for member users.
   */
  async hasNonDefaultGroupMembership(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const groupMembership = await this.db
      .selectFrom('groupUsers as groupUsers')
      .innerJoin('groups as groups', 'groups.id', 'groupUsers.groupId')
      .select('groupUsers.groupId')
      .where('groupUsers.userId', '=', userId)
      .where('groups.workspaceId', '=', workspaceId)
      .where('groups.isDefault', '=', false)
      .executeTakeFirst();

    return Boolean(groupMembership);
  }

  /**
   * Returns workspace users with group-based visibility restrictions applied.
   *
   * Access rules:
   * - admin/owner can see all users in the workspace;
   * - member users can only see users sharing at least one non-default group;
   * - if a user belongs to no non-default groups, access is denied.
   */
  async getUsersPaginated(
    workspaceId: string,
    pagination: PaginationOptions,
    authUser: User,
  ) {
    let query = this.db
      .selectFrom('users')
      .select(this.baseFields)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null);

    if (authUser.role === UserRole.MEMBER) {
      const hasNonDefaultGroup = await this.hasNonDefaultGroupMembership(
        authUser.id,
        workspaceId,
      );

      // If a user has no custom group memberships, the members page is not accessible.
      if (!hasNonDefaultGroup) {
        throw new ForbiddenException('You are not a member of any group');
      }

      // Limit the result to users who share at least one group with the current user.
      // Use `where(... exists(...))` because this Kysely version does not expose `whereExists`.
      query = query.where((eb) =>
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
      );
    }

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

  withUserMfa(eb: ExpressionBuilder<DB, 'users'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('userMfa')
        .select([
          'userMfa.id',
          'userMfa.method',
          'userMfa.isEnabled',
          'userMfa.createdAt',
        ])
        .whereRef('userMfa.userId', '=', 'users.id'),
    ).as('mfa');
  }
}
