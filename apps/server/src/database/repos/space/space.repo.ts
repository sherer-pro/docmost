import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableSpace,
  HeadingNumberingSettings,
  Space,
  SpaceCustomLinksSettings,
  SpaceDictionarySettings,
  SpaceDocumentFieldsSettings,
  SpaceTagSettings,
  UpdatableSpace,
} from '@docmost/db/types/entity.types';
import { ExpressionBuilder, sql } from 'kysely';
import {
  PaginationOptions,
  shouldIncludeArchived,
} from '../../pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import type { DB } from '@docmost/db/types/db';
import { validate as isValidUUID } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';

const SPACE_SHARING_SETTINGS_KEYS = ['disabled'] as const;
type SpaceSharingSettingsKey = (typeof SPACE_SHARING_SETTINGS_KEYS)[number];

@Injectable()
export class SpaceRepo {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private eventEmitter: EventEmitter2,
  ) {}

  async findById(
    spaceId: string,
    workspaceId: string,
    opts?: {
      includeMemberCount?: boolean;
      withLock?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<Space> {
    const db = dbOrTx(this.db, opts?.trx);

    let query = db
      .selectFrom('spaces')
      .selectAll('spaces')
      .$if(opts?.includeMemberCount, (qb) => qb.select(this.withMemberCount))
      .where('workspaceId', '=', workspaceId);

    /**
     * Backward compatibility for existing clients:
     * some API calls still send a space slug (for example "general")
     * instead of a UUID.
     *
     * Without this branch PostgreSQL tries to cast the slug to uuid,
     * raises 22P02, and breaks critical UI loading flows.
     */
    if (isValidUUID(spaceId)) {
      query = query.where('id', '=', spaceId);
    } else {
      query = query.where(sql`LOWER(slug)`, '=', sql`LOWER(${spaceId})`);
    }

    if (opts?.withLock && opts?.trx) {
      query = query.forUpdate();
    }

    return query.executeTakeFirst();
  }

  async findBySlug(
    slug: string,
    workspaceId: string,
    opts?: { includeMemberCount?: boolean; trx?: KyselyTransaction },
  ): Promise<Space> {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('spaces')
      .selectAll('spaces')
      .$if(opts?.includeMemberCount, (qb) => qb.select(this.withMemberCount))
      .where(sql`LOWER(slug)`, '=', sql`LOWER(${slug})`)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async hasImportCleanupBlockers(
    spaceId: string,
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    const activeTask = await trx
      .selectFrom('fileTasks')
      .select('id')
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('type', '=', 'import')
      .where('status', 'in', ['uploading', 'pending', 'processing'])
      .forUpdate()
      .limit(1)
      .executeTakeFirst();
    if (activeTask) return true;

    const uncompensatedArtifact = await trx
      .selectFrom('fileTasks as task')
      .innerJoin(
        'fileTaskImportArtifacts as artifact',
        'artifact.fileTaskId',
        'task.id',
      )
      .select('artifact.id')
      .where('task.spaceId', '=', spaceId)
      .where('task.workspaceId', '=', workspaceId)
      .where('task.type', '=', 'import')
      .where('task.status', 'in', ['success', 'failed'])
      .where((eb) =>
        eb.or([
          eb.and([
            eb('artifact.artifactType', '=', 'archive'),
            eb('artifact.status', '!=', 'cleaned'),
          ]),
          eb.and([
            eb('artifact.artifactType', '=', 'attachment'),
            eb('artifact.status', 'in', ['pending', 'uploaded']),
          ]),
        ]),
      )
      .forUpdate()
      .limit(1)
      .executeTakeFirst();
    return Boolean(uncompensatedArtifact);
  }

  async slugExists(
    slug: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const db = dbOrTx(this.db, trx);
    let { count } = await db
      .selectFrom('spaces')
      .select((eb) => eb.fn.count('id').as('count'))
      .where(sql`LOWER(slug)`, '=', sql`LOWER(${slug})`)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    count = count as number;
    return count != 0;
  }

  async updateSpace(
    updatableSpace: UpdatableSpace,
    spaceId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('spaces')
      .set({ ...updatableSpace, updatedAt: new Date() })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async archiveSpace(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.db
      .updateTable('spaces')
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
    if (space) {
      this.eventEmitter.emit(EventName.SPACE_UPDATED, { spaceId: space.id });
    }
    return space;
  }

  async unarchiveSpace(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.db
      .updateTable('spaces')
      .set({
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
    if (space) {
      this.eventEmitter.emit(EventName.SPACE_UPDATED, { spaceId: space.id });
    }
    return space;
  }

  async updateSharingSettings(
    spaceId: string,
    workspaceId: string,
    prefKey: SpaceSharingSettingsKey,
    prefValue: string | boolean,
    trx?: KyselyTransaction,
  ) {
    if (!SPACE_SHARING_SETTINGS_KEYS.includes(prefKey)) {
      throw new Error(`Unsupported space sharing setting key: ${prefKey}`);
    }

    return dbOrTx(this.db, trx)
      .updateTable('spaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('sharing', COALESCE(settings->'sharing', '{}'::jsonb)
          || jsonb_build_object(
            ${prefKey}::text,
            (${JSON.stringify(prefValue)}::text)::jsonb
          ))`,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateDocumentFieldsSettings(
    spaceId: string,
    workspaceId: string,
    documentFields: SpaceDocumentFieldsSettings,
  ) {
    const query = this.db
      .updateTable('spaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('documentFields', COALESCE(settings->'documentFields', '{}'::jsonb)
          || ${sql.lit(JSON.stringify(documentFields))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll();

    return query.executeTakeFirst();
  }

  async updateDictionarySettings(
    spaceId: string,
    workspaceId: string,
    dictionary: SpaceDictionarySettings,
  ) {
    const query = this.db
      .updateTable('spaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('dictionary', COALESCE(settings->'dictionary', '{}'::jsonb)
          || ${sql.lit(JSON.stringify(dictionary))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll();

    return query.executeTakeFirst();
  }

  async updateTagSettings(
    spaceId: string,
    workspaceId: string,
    tags: SpaceTagSettings,
  ) {
    return this.db
      .updateTable('spaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('tags', COALESCE(settings->'tags', '{}'::jsonb)
          || ${sql.lit(JSON.stringify(tags))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateHeadingNumberingSettings(
    spaceId: string,
    workspaceId: string,
    headingNumbering: HeadingNumberingSettings,
  ) {
    return this.db
      .updateTable('spaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('headingNumbering', COALESCE(settings->'headingNumbering', '{}'::jsonb)
          || ${sql.lit(JSON.stringify(headingNumbering))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateCustomLinksSettings(
    spaceId: string,
    workspaceId: string,
    customLinks: SpaceCustomLinksSettings,
  ) {
    return this.db
      .updateTable('spaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('customLinks', ${sql.lit(JSON.stringify(customLinks))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async insertSpace(
    insertableSpace: InsertableSpace,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('spaces')
      .values(insertableSpace)
      .returningAll()
      .executeTakeFirst();
  }

  async getSpacesInWorkspace(
    workspaceId: string,
    pagination: PaginationOptions,
  ) {
    // todo: show spaces user have access based on visibility and memberships
    let query = this.db
      .selectFrom('spaces')
      .selectAll('spaces')
      .select((eb) => [this.withMemberCount(eb)])
      .where('workspaceId', '=', workspaceId);

    if (!shouldIncludeArchived(pagination)) {
      query = query.where('archivedAt', 'is', null);
    }

    if (pagination.query) {
      query = query.where((eb) =>
        eb(
          sql`f_unaccent(name)`,
          'ilike',
          sql`f_unaccent(${'%' + pagination.query + '%'})`,
        ).or(
          sql`f_unaccent(description)`,
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

  withMemberCount(eb: ExpressionBuilder<DB, 'spaces'>) {
    /**
     * We form a unified set of space participants:
     * - direct members via space_members.user_id;
     * - participants received through groups.
     *
     * For the second branch, we explicitly exclude null so that COUNT(*) is lower
     * did not take into account empty lines from LEFT JOIN.
     */
    const subquery = eb
      .selectFrom('spaceMembers')
      .select('spaceMembers.userId')
      .where('spaceMembers.userId', 'is not', null)
      .whereRef('spaceMembers.spaceId', '=', 'spaces.id')
      .union(
        eb
          .selectFrom('spaceMembers')
          .where('spaceMembers.groupId', 'is not', null)
          .leftJoin('groups', 'groups.id', 'spaceMembers.groupId')
          .leftJoin('groupUsers', 'groupUsers.groupId', 'groups.id')
          .select('groupUsers.userId')
          .where('groupUsers.userId', 'is not', null)
          .whereRef('spaceMembers.spaceId', '=', 'spaces.id'),
      )
      .as('userId');

    return eb
      .selectFrom(subquery)
      .select(() => sql<number>`COUNT(*)::int`.as('count'))
      .as('memberCount');
  }

  async deleteSpace(
    spaceId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('spaces')
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .execute();

    this.eventEmitter.emit(EventName.SPACE_DELETED, {
      spaceId,
    });
  }
}
