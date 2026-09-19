import { randomUUID } from 'crypto';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from '../src/database/postgres-client';
import {
  up,
  down,
} from '../src/database/migrations/20260919T180000-space-owned-template-policy';
import { SpaceAdministrationService } from '../src/core/space/services/space-administration.service';
import { SpacePolicyService } from '../src/core/space-policy/space-policy.service';
import { SpaceMemberRepo } from '../src/database/repos/space/space-member.repo';
import { SpaceRepo } from '../src/database/repos/space/space.repo';
import { SpaceService } from '../src/core/space/services/space.service';

const databaseUrl = process.env.SPACES_ADMIN_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('Space administration PostgreSQL acceptance', () => {
  let db: Kysely<any>;
  const schema = `spaces_admin_${randomUUID().replace(/-/g, '')}`;
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const userId = randomUUID();
  const workspace = {
    id: workspaceId,
    enforceMfa: false,
    enforceSso: false,
    settings: {},
  } as any;
  let service: SpaceAdministrationService;
  let spaces: SpaceRepo;
  const environment = { isPageTemplatesEnabled: () => false };
  const events = { emitAsync: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('A dedicated local test database is required');
    const connection = postgres(databaseUrl!, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    db = new Kysely<any>({
      dialect: new PostgresJSDialect({ postgres: connection }),
      plugins: [new CamelCasePlugin()],
    });
    await db.schema.createSchema(schema).execute();
    await sql`create table spaces (id uuid primary key, workspace_id uuid, name text, slug text, description text, logo text, settings jsonb default '{}', archived_at timestamptz, deleted_at timestamptz, updated_at timestamptz default now())`.execute(
      db,
    );
    await sql`create table groups (id uuid primary key, workspace_id uuid, deleted_at timestamptz)`.execute(
      db,
    );
    await sql`create table group_users (group_id uuid, user_id uuid)`.execute(
      db,
    );
    await sql`create table space_members (id uuid primary key default gen_random_uuid(), space_id uuid, user_id uuid, group_id uuid, role text, deleted_at timestamptz)`.execute(
      db,
    );
    await sql`create table pages (id uuid primary key, space_id uuid, content jsonb, deleted_at timestamptz)`.execute(
      db,
    );
    await sql`create table page_access_rules (id uuid primary key default gen_random_uuid(), page_id uuid, space_id uuid, user_id uuid, group_id uuid, principal_type text, effect text)`.execute(
      db,
    );
    await sql`create table page_template_space_policies (space_id uuid primary key, workspace_id uuid, templates_enabled boolean, allow_create_template boolean default true, allow_regular_template boolean default true, allow_synced_template boolean default true, revision int default 1, updated_at timestamptz default now(), updated_by_id uuid)`.execute(
      db,
    );
    await sql`create table page_template_workspace_policies (workspace_id uuid primary key, enabled boolean, revision int default 1, updated_at timestamptz default now())`.execute(
      db,
    );
    await sql`create table page_template_group_policies (workspace_id uuid, space_id uuid, group_id uuid, allowed_actions jsonb, revision int default 1)`.execute(
      db,
    );
    await sql`create table ai_space_configs (workspace_id uuid, space_id uuid, enabled boolean, base_url text, chat_model text, api_key text)`.execute(
      db,
    );
    await sql`create table shares (space_id uuid, workspace_id uuid, slug text)`.execute(
      db,
    );
    await sql`create function f_unaccent(text) returns text language sql immutable as 'select $1'`.execute(
      db,
    );
    spaces = new SpaceRepo(db as any, events as any);
    const members = new SpaceMemberRepo(db as any, undefined as any, spaces);
    service = new SpaceAdministrationService(
      db as any,
      members,
      spaces,
      new SpacePolicyService(db as any),
      environment as any,
    );
  });
  afterAll(async () => {
    if (db) {
      await db.schema.dropSchema(schema).cascade().execute();
      await db.destroy();
    }
  });
  beforeEach(async () => {
    events.emitAsync.mockClear();
    for (const table of [
      'spaces',
      'groups',
      'groupUsers',
      'spaceMembers',
      'pages',
      'pageAccessRules',
      'pageTemplateSpacePolicies',
      'pageTemplateWorkspacePolicies',
      'pageTemplateGroupPolicies',
      'aiSpaceConfigs',
      'shares',
    ])
      await db.deleteFrom(table).execute();
    await sql`drop table if exists page_template_workspace_gate_backup, page_template_workspace_gate_context`.execute(
      db,
    );
  });
  async function addSpace(patch: Record<string, any> = {}) {
    const id = randomUUID();
    return db
      .insertInto('spaces')
      .values({
        id,
        workspaceId,
        name: 'Alpha',
        slug: id.replace(/-/g, ''),
        description: 'Description',
        ...patch,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  const list = (role = 'admin', options: any = {}, session: any = {}) =>
    service.list({ id: userId, role } as any, workspace, session, {
      status: 'active',
      limit: 20,
      ...options,
    });

  it('filters before pagination, keeps a stable name/id order, and supports reverse cursors', async () => {
    for (let index = 0; index < 43; index++)
      await addSpace({
        name: index < 30 ? 'Same' : `Z${index}`,
        description: index === 42 ? 'Needle description' : '',
      });
    await addSpace({ workspaceId: otherWorkspaceId, name: 'Foreign' });
    const first = await list();
    const second = await list('admin', { cursor: first.meta.nextCursor });
    const third = await list('admin', { cursor: second.meta.nextCursor });
    expect([
      first.items.length,
      second.items.length,
      third.items.length,
    ]).toEqual([20, 20, 3]);
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(
          (item) => item.id,
        ),
      ).size,
    ).toBe(43);
    const previous = await list('admin', {
      beforeCursor: second.meta.prevCursor,
    });
    expect(previous.items.map((item) => item.id)).toEqual(
      first.items.map((item) => item.id),
    );
    expect((await list('admin', { query: 'needle' })).items).toHaveLength(1);
    expect(
      (await list('admin', { query: third.items[0].slug })).items,
    ).toHaveLength(1);
  });
  it('distinguishes active, archived, all, and deleted spaces', async () => {
    await addSpace();
    await addSpace({ archivedAt: new Date() });
    await addSpace({ deletedAt: new Date() });
    expect((await list()).items).toHaveLength(1);
    expect((await list('owner', { status: 'archived' })).items).toHaveLength(1);
    expect((await list('owner', { status: 'all' })).items).toHaveLength(2);
  });
  it('rejects malformed cursors as client errors', async () => {
    await expect(list('admin', { cursor: 'broken' })).rejects.toMatchObject({
      status: 400,
    });
    const invalidId = Buffer.from('sortName=alpha&id=invalid').toString(
      'base64url',
    );
    await expect(
      list('admin', { beforeCursor: invalidId }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      list('admin', { cursor: invalidId, beforeCursor: invalidId }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('excludes revoked memberships and inactive or foreign groups, and deduplicates counts', async () => {
    const visible = await addSpace();
    const revoked = await addSpace();
    const inactive = await addSpace();
    const foreign = await addSpace();
    const activeGroup = randomUUID();
    const inactiveGroup = randomUUID();
    const foreignGroup = randomUUID();
    await db
      .insertInto('groups')
      .values([
        { id: activeGroup, workspaceId },
        { id: inactiveGroup, workspaceId, deletedAt: new Date() },
        { id: foreignGroup, workspaceId: otherWorkspaceId },
      ])
      .execute();
    await db
      .insertInto('groupUsers')
      .values(
        [activeGroup, inactiveGroup, foreignGroup].map((groupId) => ({
          groupId,
          userId,
        })),
      )
      .execute();
    await db
      .insertInto('spaceMembers')
      .values([
        { spaceId: visible.id, userId, role: 'reader' },
        { spaceId: visible.id, groupId: activeGroup, role: 'admin' },
        { spaceId: revoked.id, userId, role: 'admin', deletedAt: new Date() },
        { spaceId: inactive.id, groupId: inactiveGroup, role: 'admin' },
        { spaceId: foreign.id, groupId: foreignGroup, role: 'admin' },
      ])
      .execute();
    const accessible = await list('member');
    expect(accessible.items.map((item) => item.id)).toEqual([visible.id]);
    expect(accessible.items[0]).toMatchObject({
      canManage: true,
      memberCount: 1,
    });
    const all = await list('owner');
    expect(
      all.items
        .filter((item) => item.id !== visible.id)
        .map((item) => item.memberCount),
    ).toEqual([0, 0, 0]);
  });
  it('restricts administration details to direct or active group administrators', async () => {
    const direct = await addSpace();
    const grouped = await addSpace();
    const reader = await addSpace();
    const pageOnly = await addSpace();
    await addSpace();
    const groupId = randomUUID();
    await db
      .insertInto('groups')
      .values({ id: groupId, workspaceId })
      .execute();
    await db.insertInto('groupUsers').values({ groupId, userId }).execute();
    await db
      .insertInto('spaceMembers')
      .values([
        { spaceId: direct.id, userId, role: 'admin' },
        { spaceId: grouped.id, groupId, role: 'admin' },
        { spaceId: reader.id, userId, role: 'reader' },
      ])
      .execute();
    const pageId = randomUUID();
    await db
      .insertInto('pages')
      .values({ id: pageId, spaceId: pageOnly.id })
      .execute();
    await db
      .insertInto('pageAccessRules')
      .values({
        pageId,
        spaceId: pageOnly.id,
        userId,
        principalType: 'user',
        effect: 'allow',
      })
      .execute();
    const result = await list('member');
    expect(result.items).toHaveLength(4);
    expect(
      result.items
        .filter((item) => item.canManage)
        .map((item) => item.id)
        .sort(),
    ).toEqual([direct.id, grouped.id].sort());
    for (const item of result.items.filter((item) => !item.canManage))
      expect(item).not.toHaveProperty('features');
  });
  it.each(['enforceMfa', 'enforceSso'])(
    'returns only identity until %s is satisfied',
    async (key) => {
      await addSpace({ settings: { security: { [key]: true } } });
      const item = (await list()).items[0];
      expect(item.requiresStepUp).toBe(true);
      expect(item.canManage).toBe(false);
      expect(Object.keys(item).sort()).toEqual([
        'archivedAt',
        'canManage',
        'id',
        'name',
        'requiresStepUp',
        'slug',
      ]);
      expect(
        (
          await list(
            'admin',
            {},
            { mfaVerifiedAt: new Date(), ssoVerifiedAt: new Date() },
          )
        ).items[0].canManage,
      ).toBe(true);
    },
  );
  it('returns safe batched feature states without provider details', async () => {
    const disabled = await addSpace();
    const enabled = await addSpace();
    const missing = await addSpace();
    await db
      .insertInto('aiSpaceConfigs')
      .values([
        {
          workspaceId,
          spaceId: disabled.id,
          enabled: false,
          baseUrl: 'https://private-provider.invalid',
          chatModel: 'private-model',
          apiKey: 'synthetic-secret',
        },
        {
          workspaceId,
          spaceId: enabled.id,
          enabled: true,
          baseUrl: 'https://private-provider.invalid',
          chatModel: 'private-model',
        },
      ])
      .execute();
    const result = await list();
    const states = new Map(
      result.items.map((item) => [item.id, item.features?.ai]),
    );
    expect(states.get(disabled.id)).toBe('disabled');
    expect(states.get(enabled.id)).toBe('enabled');
    expect(states.get(missing.id)).toBe('not_configured');
    expect(JSON.stringify(result)).not.toMatch(
      /private-provider|private-model|synthetic-secret|apiKey|baseUrl/,
    );
  });

  async function seedPolicies() {
    for (const workspaceEnabled of [true, false, null]) {
      const id = randomUUID();
      if (workspaceEnabled !== null)
        await db
          .insertInto('pageTemplateWorkspacePolicies')
          .values({ workspaceId: id, enabled: workspaceEnabled })
          .execute();
      for (const enabled of [true, false]) {
        const space = await addSpace({ workspaceId: id });
        await db
          .insertInto('pageTemplateSpacePolicies')
          .values({
            workspaceId: id,
            spaceId: space.id,
            templatesEnabled: enabled,
          })
          .execute();
        await db
          .insertInto('pages')
          .values({
            id: randomUUID(),
            spaceId: space.id,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
          })
          .execute();
      }
    }
  }
  it('migrates all gate combinations, ignores the disabled server flag, preserves pages, and rolls back exactly', async () => {
    await seedPolicies();
    await addSpace();
    const before = await db
      .selectFrom('pageTemplateSpacePolicies')
      .selectAll()
      .orderBy('spaceId')
      .execute();
    const pages = await db
      .selectFrom('pages')
      .selectAll()
      .orderBy('id')
      .execute();
    await db.transaction().execute(up);
    const migrated = await db
      .selectFrom('pageTemplateSpacePolicies')
      .selectAll()
      .execute();
    expect(migrated.filter((row) => row.templatesEnabled)).toHaveLength(1);
    expect(
      migrated.every((row) => row.allowSyncedTemplate && row.revision === 2),
    ).toBe(true);
    expect(
      await db.selectFrom('pages').selectAll().orderBy('id').execute(),
    ).toEqual(pages);
    await db.transaction().execute(down);
    expect(
      await db
        .selectFrom('pageTemplateSpacePolicies')
        .selectAll()
        .orderBy('spaceId')
        .execute(),
    ).toEqual(before);
  });
  it.each(['local', 'group', 'new', 'removed'])(
    'refuses rollback after a %s policy change',
    async (kind) => {
      await seedPolicies();
      await db.transaction().execute(up);
      const first = await db
        .selectFrom('pageTemplateSpacePolicies')
        .selectAll()
        .executeTakeFirstOrThrow();
      if (kind === 'local')
        await db
          .updateTable('pageTemplateSpacePolicies')
          .set({ allowSyncedTemplate: false })
          .where('spaceId', '=', first.spaceId)
          .execute();
      if (kind === 'group')
        await db
          .insertInto('pageTemplateGroupPolicies')
          .values({
            workspaceId: first.workspaceId,
            spaceId: first.spaceId,
            groupId: randomUUID(),
            allowedActions: [],
          })
          .execute();
      if (kind === 'new')
        await db
          .insertInto('pageTemplateSpacePolicies')
          .values({
            workspaceId,
            spaceId: randomUUID(),
            templatesEnabled: false,
          })
          .execute();
      if (kind === 'removed')
        await db
          .deleteFrom('pageTemplateSpacePolicies')
          .where('spaceId', '=', first.spaceId)
          .execute();
      await expect(db.transaction().execute(down)).rejects.toThrow(
        'Template policies changed after migration',
      );
      expect(
        await db
          .selectFrom('pageTemplateWorkspaceGateBackup')
          .selectAll()
          .execute(),
      ).toHaveLength(6);
    },
  );
  it('rolls back both settings and share deletion on failure and emits events only after commit', async () => {
    const space = await addSpace({
      settings: { documentFields: { status: true } },
    });
    await db
      .insertInto('shares')
      .values({ spaceId: space.id, workspaceId, slug: 'public-link' })
      .execute();
    let fail = true;
    const shares = {
      deleteBySpaceId: async (
        id: string,
        workspace: string,
        trx: Kysely<any>,
      ) => {
        await trx
          .deleteFrom('shares')
          .where('spaceId', '=', id)
          .where('workspaceId', '=', workspace)
          .execute();
        if (fail) throw new Error('share failure');
      },
    };
    const instance = new SpaceService(
      spaces,
      {} as any,
      shares as any,
      { findById: async () => workspace } as any,
      new SpacePolicyService(db as any),
      {} as any,
      db as any,
      {} as any,
      events as any,
    );
    const patch = {
      spaceId: space.id,
      name: 'Changed',
      dictionaryEnabled: true,
      disablePublicSharing: true,
    };
    await expect(instance.updateSpace(patch, workspaceId)).rejects.toThrow(
      'share failure',
    );
    expect(
      (
        await db
          .selectFrom('spaces')
          .selectAll()
          .where('id', '=', space.id)
          .executeTakeFirstOrThrow()
      ).settings,
    ).toEqual(space.settings);
    expect(await db.selectFrom('shares').selectAll().execute()).toHaveLength(1);
    expect(events.emitAsync).not.toHaveBeenCalled();
    fail = false;
    await instance.updateSpace(patch, workspaceId);
    expect(await db.selectFrom('shares').selectAll().execute()).toHaveLength(0);
    expect(events.emitAsync).toHaveBeenCalledTimes(2);
    expect(
      (
        await db
          .selectFrom('spaces')
          .selectAll()
          .where('id', '=', space.id)
          .executeTakeFirstOrThrow()
      ).settings,
    ).toEqual({
      documentFields: { status: true },
      dictionary: { enabled: true },
      sharing: { disabled: true },
    });
  });
});
