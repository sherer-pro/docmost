import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { BadRequestException } from '@nestjs/common';
import { AiContentPolicyService } from './ai-content-policy.service';

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

describe('AiContentPolicyService', () => {
  let queries: string[] = [];
  const db = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
    plugins: [new CamelCasePlugin()],
    log: (event) => {
      if (event.level === 'query') queries.push(event.query.sql);
    },
  });
  const service = new AiContentPolicyService(
    db as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    queries = [];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('uses a depth-bounded recursive tree and stable page ordering', async () => {
    await service.getEffectivePolicy('space', 'workspace');

    const recursive = queries.find((query) =>
      query.toLowerCase().includes('with recursive excluded_pages'),
    );
    expect(recursive).toBeDefined();
    expect(recursive).toContain('include_descendants');
    expect(recursive).toContain('ep.level <');
    expect(recursive).toContain('select distinct id');
    expect(recursive).toContain('order by id');
  });

  it('deduplicates rules by page id and enforces the 100-rule limit', () => {
    expect(
      (service as any).normalizeExclusions({
        exclusions: [
          { pageId: 'one', includeDescendants: false },
          { pageId: 'one', includeDescendants: true },
        ],
      }),
    ).toEqual([{ pageId: 'one', includeDescendants: true }]);

    expect(() =>
      (service as any).normalizeExclusions({
        exclusions: Array.from({ length: 101 }, (_, index) => ({
          pageId: `page-${index}`,
          includeDescendants: false,
        })),
      }),
    ).toThrow(BadRequestException);
  });
});
