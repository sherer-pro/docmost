import type postgresTypes from 'postgres';
import Redis from 'ioredis';
import { CamelCasePlugin, Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { v7 as uuid7 } from 'uuid';
import { postgres } from '../src/database/postgres-client';
import { QueueOutboxRepo } from '../src/database/repos/queue-outbox/queue-outbox.repo';
import type { DB } from '../src/database/types/db';
import type { KyselyDB } from '../src/database/types/kysely.types';

jest.setTimeout(30_000);

describe('server infrastructure (e2e)', () => {
  let database: postgresTypes.Sql;
  let repositoryClient: postgresTypes.Sql;
  let kysely: KyselyDB;
  let outboxRepo: QueueOutboxRepo;
  let redis: Redis;

  beforeAll(async () => {
    database = postgres(process.env.DATABASE_URL!, { max: 2 });
    repositoryClient = postgres(process.env.DATABASE_URL!, { max: 2 });
    kysely = new Kysely<DB>({
      dialect: new PostgresJSDialect({ postgres: repositoryClient }),
      plugins: [new CamelCasePlugin()],
    });
    outboxRepo = new QueueOutboxRepo(kysely);
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    await Promise.all([database`select 1`, redis.ping()]);
  });

  afterAll(async () => {
    await Promise.all([
      kysely?.destroy(),
      database?.end({ timeout: 5 }),
      redis?.quit(),
    ]);
  });

  it('connects to PostgreSQL and Redis', async () => {
    const [databaseResult, redisResult] = await Promise.all([
      database<{ healthy: number }[]>`select 1 as healthy`,
      redis.ping(),
    ]);

    expect(databaseResult[0].healthy).toBe(1);
    expect(redisResult).toBe('PONG');
  });

  it('persists a deduplicated pending record on the migrated outbox schema', async () => {
    const id = uuid7();
    const invitationId = uuid7();
    const acceptedUserId = uuid7();
    const dedupeKey = `e2e-outbox:${invitationId}`;
    const payload = {
      invitationId,
      acceptedUserId,
      recipientEmail: 'recipient@example.test',
      invitedUserName: 'Test User',
      invitedUserEmail: 'invitee@example.test',
    };

    try {
      const inserted = await database<{ id: string }[]>`
        insert into queue_outbox (
          id,
          kind,
          payload,
          status,
          available_at,
          dedupe_key
        ) values (
          ${id}::uuid,
          'workspace_invitation_accepted_email',
          ${database.json(payload)},
          'pending',
          now() + interval '1 hour',
          ${dedupeKey}
        )
        returning id
      `;
      const duplicate = await database<{ id: string }[]>`
        insert into queue_outbox (
          kind,
          payload,
          status,
          available_at,
          dedupe_key
        ) values (
          'workspace_invitation_accepted_email',
          ${database.json(payload)},
          'pending',
          now() + interval '1 hour',
          ${dedupeKey}
        )
        on conflict (dedupe_key) do nothing
        returning id
      `;
      const [persisted] = await database<
        { id: string; status: string; secret_payload: string | null }[]
      >`
        select id, status, secret_payload
        from queue_outbox
        where dedupe_key = ${dedupeKey}
      `;

      expect(inserted).toEqual([{ id }]);
      expect(duplicate).toHaveLength(0);
      expect(persisted).toEqual({
        id,
        status: 'pending',
        secret_payload: null,
      });
    } finally {
      await database`
        delete from queue_outbox
        where dedupe_key = ${dedupeKey}
      `;
    }
  });

  it('reclaims only an expired outbox lease and fences the previous owner', async () => {
    const firstLeaseToken = uuid7();
    const secondLeaseToken = uuid7();
    const dedupeKey = `e2e-outbox-lease:${uuid7()}`;
    const id = await outboxRepo.enqueue({
      kind: 'workspace_invitation_accepted_email',
      payload: { scenario: 'lease-e2e' },
      secretPayload: 'synthetic-secret-payload',
      dedupeKey,
    });

    expect(id).toBeDefined();
    try {
      const firstClaim = await outboxRepo.claimNext(firstLeaseToken, 60_000);
      expect(firstClaim).toMatchObject({
        id,
        status: 'processing',
        attemptCount: 1,
        leaseToken: firstLeaseToken,
      });
      await expect(
        outboxRepo.claimNext(secondLeaseToken, 60_000),
      ).resolves.toBeUndefined();
      await expect(
        outboxRepo.renewLease(id!, secondLeaseToken, 60_000),
      ).resolves.toBe(false);

      await database`
        update queue_outbox
        set lease_expires_at = now() - interval '1 second'
        where id = ${id!}::uuid
      `;

      const reclaimed = await outboxRepo.claimNext(secondLeaseToken, 60_000);
      expect(reclaimed).toMatchObject({
        id,
        status: 'processing',
        attemptCount: 2,
        leaseToken: secondLeaseToken,
      });
      await expect(
        outboxRepo.markCompleted(id!, firstLeaseToken),
      ).resolves.toBe(false);
      await expect(
        outboxRepo.markCompleted(id!, secondLeaseToken),
      ).resolves.toBe(true);

      const [persisted] = await database<
        { status: string; secret_payload: string | null }[]
      >`
        select status, secret_payload
        from queue_outbox
        where id = ${id!}::uuid
      `;
      expect(persisted).toEqual({
        status: 'completed',
        secret_payload: null,
      });
    } finally {
      await database`
        delete from queue_outbox
        where dedupe_key = ${dedupeKey}
      `;
    }
  });
});
