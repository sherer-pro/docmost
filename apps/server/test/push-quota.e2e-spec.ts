import { randomUUID } from 'node:crypto';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from '../src/database/postgres-client';
import { PushSubscriptionRepo } from '../src/database/repos/push-subscription/push-subscription.repo';

const databaseUrl = process.env.PUSH_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('Push quota PostgreSQL concurrency acceptance', () => {
  const schema = `push_audit_${randomUUID().replace(/-/g, '')}`;
  const userId = randomUUID();
  const workspaceId = randomUUID();
  let db: Kysely<any>;
  let repo: PushSubscriptionRepo;
  const subscription = (index: number) => ({
    userId,
    workspaceId,
    endpoint: `https://push.example.test/${index}`,
    p256dh: 'synthetic-key',
    auth: 'synthetic-auth',
  });
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('A dedicated local test database is required');
    db = new Kysely<any>({
      dialect: new PostgresJSDialect({
        postgres: postgres(databaseUrl!, {
          max: 16,
          onnotice: () => {},
          connection: { search_path: schema },
        }),
      }),
      plugins: [new CamelCasePlugin()],
    });
    await db.schema.createSchema(schema).execute();
    await sql`create table users (id uuid primary key, workspace_id uuid not null)`.execute(
      db,
    );
    await sql`create table push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null, workspace_id uuid not null, endpoint text unique not null, p256dh text, auth text, user_agent text, last_seen_at timestamptz, revoked_at timestamptz, updated_at timestamptz default now())`.execute(
      db,
    );
    await db.insertInto('users').values({ id: userId, workspaceId }).execute();
    repo = new PushSubscriptionRepo(db as any);
  });
  afterAll(async () => {
    if (db) {
      await db.schema.dropSchema(schema).cascade().execute();
      await db.destroy();
    }
  });
  beforeEach(async () => {
    await db.deleteFrom('pushSubscriptions').execute();
  });
  it('serializes concurrent first registrations at ten devices', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, index) =>
        repo.upsert(subscription(index)),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(10);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason.getStatus()).toBe(429);
    expect(await repo.findActiveByUserId(userId)).toHaveLength(10);
  });
  it('allows renewals of legacy excess devices without admitting another device', async () => {
    await db
      .insertInto('pushSubscriptions')
      .values(Array.from({ length: 12 }, (_, index) => subscription(index)))
      .execute();
    await expect(repo.upsert(subscription(0))).resolves.toBeDefined();
    await expect(repo.upsert(subscription(12))).rejects.toMatchObject({
      status: 429,
    });
    expect(await repo.findActiveByUserId(userId)).toHaveLength(12);
  });
  it('counts reactivation as admission and permits it only after a slot is free', async () => {
    await db
      .insertInto('pushSubscriptions')
      .values(
        Array.from({ length: 11 }, (_, index) => ({
          ...subscription(index),
          revokedAt: index === 10 ? new Date() : null,
        })),
      )
      .execute();
    await expect(repo.upsert(subscription(10))).rejects.toMatchObject({
      status: 429,
    });
    await repo.revokeByEndpointForUser(subscription(0).endpoint, userId);
    await expect(repo.upsert(subscription(10))).resolves.toBeDefined();
    expect(await repo.findActiveByUserId(userId)).toHaveLength(10);
  });
});
