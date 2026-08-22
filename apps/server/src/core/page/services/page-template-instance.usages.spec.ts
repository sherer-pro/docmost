jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
jest.mock('../../../collaboration/collaboration.util', () => ({
  ...jest.requireActual('../../../collaboration/collaboration.util'),
  strictJsonToNode: jest.fn(() => ({ type: { name: 'doc' } })),
}));

import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { PageTemplateInstanceService } from './page-template-instance.service';

class TestPostgresDialect {
  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return new DummyDriver();
  }

  createIntrospector(db: Kysely<any>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

const user = {
  id: '019fdaa0-0000-7000-8000-000000000010',
  workspaceId: '019fdaa0-0000-7000-8000-000000000020',
} as any;
const templatePageId = '019fdaa0-0000-7000-8000-000000000050';
const sourceSpaceId = '019fdaa0-0000-7000-8000-000000000030';
const usagePageId = '019fdaa0-0000-7000-8000-000000000110';

function buildService(db: any, pageAccessService: any) {
  return new PageTemplateInstanceService(
    db,
    {} as any,
    {} as any,
    pageAccessService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function makeQuery() {
  const query: any = {};
  for (const method of ['innerJoin', 'select', 'where', 'orderBy', 'limit']) {
    query[method] = jest.fn(() => query);
  }
  query.$if = jest.fn((condition: boolean, callback: (value: any) => any) =>
    condition ? callback(query) : query,
  );
  return query;
}

describe('PageTemplateInstanceService usage ACL snapshot', () => {
  const compileDb = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
    plugins: [new CamelCasePlugin()],
  });

  afterAll(async () => {
    await compileDb.destroy();
  });

  it('compiles canonical user, group-deny, and space membership precedence without an ID array', () => {
    const service = buildService(compileDb, {});
    const predicate = (service as any).buildUsageReadablePredicate(user.id);
    const compiled = compileDb
      .selectFrom('pages as child')
      .select('child.id')
      .where(predicate)
      .compile();

    expect(compiled.sql).toContain('page_access_rules as usage_user_allow');
    expect(compiled.sql).toContain('page_access_rules as usage_user_rule');
    expect(compiled.sql).toContain('page_access_rules as usage_group_allow');
    expect(compiled.sql).toContain('page_access_rules as usage_group_deny');
    expect(compiled.sql).toContain('page_access_rules as usage_group_rule');
    expect(compiled.sql).toContain('space_members as usage_space_member');
    expect(compiled.sql).toContain('group_users as usage_space_group_member');
    expect(compiled.sql).toContain('"child"."space_id"');
    expect(compiled.sql).not.toContain(' = any(');
    expect(compiled.parameters.some((value) => Array.isArray(value))).toBe(
      false,
    );
    expect(
      compiled.parameters.filter((value) => value === user.id),
    ).toHaveLength(7);
  });

  it('does not mix a concurrent grant into counts or rows until the next RR transaction', async () => {
    const row = {
      childPageId: usagePageId,
      status: 'active',
      appliedRevision: 1,
      lastErrorCode: null,
      slugId: 'usage-page',
      title: 'Usage page',
      icon: null,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      parentPageId: null,
      deletedAt: null,
    };
    let liveReadable = false;
    let grantAfterFirstCount = true;
    const transactionBuilder: any = {};
    transactionBuilder.setIsolationLevel = jest.fn(() => transactionBuilder);
    transactionBuilder.execute = jest.fn(
      async (callback: (value: any) => Promise<unknown>) => {
        const readableAtTransactionStart = liveReadable;
        let queryIndex = 0;
        const trx = {
          selectFrom: jest.fn(() => {
            const query = makeQuery();
            if (queryIndex++ === 0) {
              query.executeTakeFirst = jest.fn(async () => {
                if (grantAfterFirstCount) {
                  liveReadable = true;
                  grantAfterFirstCount = false;
                }
                return {
                  totalCount: 1,
                  readableCount: readableAtTransactionStart ? 1 : 0,
                };
              });
            } else {
              query.execute = jest
                .fn()
                .mockResolvedValue(readableAtTransactionStart ? [row] : []);
            }
            return query;
          }),
        };
        return callback(trx);
      },
    );
    const pageAccessService = {
      isWorkspaceBypassUser: jest.fn().mockReturnValue(false),
      getSidebarAccessSnapshot: jest.fn(),
      getEffectiveAccessForPages: jest.fn(),
    };
    const service = buildService(
      { transaction: jest.fn(() => transactionBuilder) },
      pageAccessService,
    );
    jest.spyOn(service as any, 'requireManagedTemplate').mockResolvedValue({
      id: templatePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
    });

    await expect(
      service.listUsages(templatePageId, { limit: 20 }, user),
    ).resolves.toEqual({
      totalCount: 1,
      hiddenCount: 1,
      items: [],
      nextCursor: null,
    });
    await expect(
      service.listUsages(templatePageId, { limit: 20 }, user),
    ).resolves.toMatchObject({
      totalCount: 1,
      hiddenCount: 0,
      items: [{ childPageId: usagePageId }],
      nextCursor: null,
    });
    expect(transactionBuilder.setIsolationLevel).toHaveBeenNthCalledWith(
      1,
      'repeatable read',
    );
    expect(transactionBuilder.setIsolationLevel).toHaveBeenNthCalledWith(
      2,
      'repeatable read',
    );
    expect(pageAccessService.getSidebarAccessSnapshot).not.toHaveBeenCalled();
    expect(pageAccessService.getEffectiveAccessForPages).not.toHaveBeenCalled();
  });
});
