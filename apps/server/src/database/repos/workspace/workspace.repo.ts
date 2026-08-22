import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertableWorkspace,
  UpdatableWorkspace,
  Workspace,
} from '@docmost/db/types/entity.types';
import { ExpressionBuilder, sql } from 'kysely';
import type { DB, Workspaces } from '@docmost/db/types/db';

const WORKSPACE_API_SETTINGS_KEYS = ['restrictToAdmins'] as const;
const WORKSPACE_SHARING_SETTINGS_KEYS = ['disabled'] as const;

type WorkspaceApiSettingsKey = (typeof WORKSPACE_API_SETTINGS_KEYS)[number];
type WorkspaceSharingSettingsKey =
  (typeof WORKSPACE_SHARING_SETTINGS_KEYS)[number];

export function jsonbPreferenceValue(prefValue: string | boolean) {
  return typeof prefValue === 'boolean'
    ? sql`${prefValue}::boolean`
    : sql`${prefValue}::text`;
}

@Injectable()
export class WorkspaceRepo {
  public baseFields: Array<keyof Workspaces> = [
    'id',
    'name',
    'pageHistoryRetentionDays',
    'description',
    'logo',
    'hostname',
    'customDomain',
    'settings',
    'defaultRole',
    'emailDomains',
    'defaultSpaceId',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'enforceSso',
    'enforceMfa',
  ];
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(
    workspaceId: string,
    opts?: {
      withLock?: boolean;
      withMemberCount?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<Workspace> {
    const db = dbOrTx(this.db, opts?.trx);

    let query = db
      .selectFrom('workspaces')
      .select(this.baseFields)
      .where('id', '=', workspaceId);

    if (opts?.withMemberCount) {
      query = query.select(this.withMemberCount);
    }

    if (opts?.withLock && opts?.trx) {
      query = query.forUpdate();
    }

    return query.executeTakeFirst();
  }

  async findFirst(): Promise<Workspace> {
    return await this.db
      .selectFrom('workspaces')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  async findByHostname(hostname: string): Promise<Workspace> {
    return await this.db
      .selectFrom('workspaces')
      .selectAll()
      .where(sql`LOWER(hostname)`, '=', sql`LOWER(${hostname})`)
      .executeTakeFirst();
  }

  async hostnameExists(
    hostname: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    if (hostname?.length < 1) return false;

    const db = dbOrTx(this.db, trx);
    let { count } = await db
      .selectFrom('workspaces')
      .select((eb) => eb.fn.count('id').as('count'))
      .where(sql`LOWER(hostname)`, '=', sql`LOWER(${hostname})`)
      .executeTakeFirst();
    count = count as number;
    return count != 0;
  }

  async updateWorkspace(
    updatableWorkspace: UpdatableWorkspace,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Workspace> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('workspaces')
      .set({ ...updatableWorkspace, updatedAt: new Date() })
      .where('id', '=', workspaceId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async insertWorkspace(
    insertableWorkspace: InsertableWorkspace,
    trx?: KyselyTransaction,
  ): Promise<Workspace> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('workspaces')
      .values(insertableWorkspace)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async count(): Promise<number> {
    const { count } = await this.db
      .selectFrom('workspaces')
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst();
    return count as number;
  }

  withMemberCount(eb: ExpressionBuilder<DB, 'workspaces'>) {
    return eb
      .selectFrom('users')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('users.deactivatedAt', 'is', null)
      .where('users.deletedAt', 'is', null)
      .whereRef('users.workspaceId', '=', 'workspaces.id')
      .as('memberCount');
  }

  async getActiveUserCount(workspaceId: string): Promise<number> {
    const result = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  async updateApiSettings(
    workspaceId: string,
    prefKey: WorkspaceApiSettingsKey,
    prefValue: string | boolean,
  ) {
    if (!WORKSPACE_API_SETTINGS_KEYS.includes(prefKey)) {
      throw new Error(`Unsupported workspace API setting key: ${prefKey}`);
    }

    const value = jsonbPreferenceValue(prefValue);

    return this.db
      .updateTable('workspaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('api', COALESCE(settings->'api', '{}'::jsonb)
                || jsonb_build_object(${prefKey}::text, ${value}))`,
        updatedAt: new Date(),
      })
      .where('id', '=', workspaceId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async updateSharingSettings(
    workspaceId: string,
    prefKey: WorkspaceSharingSettingsKey,
    prefValue: string | boolean,
    trx?: KyselyTransaction,
  ) {
    if (!WORKSPACE_SHARING_SETTINGS_KEYS.includes(prefKey)) {
      throw new Error(`Unsupported workspace sharing setting key: ${prefKey}`);
    }

    const value = jsonbPreferenceValue(prefValue);

    return dbOrTx(this.db, trx)
      .updateTable('workspaces')
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('sharing', COALESCE(settings->'sharing', '{}'::jsonb)
                || jsonb_build_object(${prefKey}::text, ${value}))`,
        updatedAt: new Date(),
      })
      .where('id', '=', workspaceId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }
}
