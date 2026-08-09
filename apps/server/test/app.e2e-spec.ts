import type postgresTypes from 'postgres';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CamelCasePlugin, Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { v7 as uuid7 } from 'uuid';
import { postgres } from '../src/database/postgres-client';
import { QueueOutboxRepo } from '../src/database/repos/queue-outbox/queue-outbox.repo';
import { PushNotificationJobRepo } from '../src/database/repos/push-notification-job/push-notification-job.repo';
import { SpaceRepo } from '../src/database/repos/space/space.repo';
import { UserRepo } from '../src/database/repos/user/user.repo';
import type { DB } from '../src/database/types/db';
import type { KyselyDB } from '../src/database/types/kysely.types';

jest.setTimeout(30_000);

describe('server infrastructure (e2e)', () => {
  let database: postgresTypes.Sql;
  let repositoryClient: postgresTypes.Sql;
  let kysely: KyselyDB;
  let outboxRepo: QueueOutboxRepo;
  let pushNotificationJobRepo: PushNotificationJobRepo;
  let spaceRepo: SpaceRepo;
  let userRepo: UserRepo;
  let redis: Redis;

  beforeAll(async () => {
    database = postgres(process.env.DATABASE_URL!, { max: 2 });
    repositoryClient = postgres(process.env.DATABASE_URL!, { max: 2 });
    kysely = new Kysely<DB>({
      dialect: new PostgresJSDialect({ postgres: repositoryClient }),
      plugins: [new CamelCasePlugin()],
    });
    outboxRepo = new QueueOutboxRepo(kysely);
    pushNotificationJobRepo = new PushNotificationJobRepo(kysely);
    spaceRepo = new SpaceRepo(kysely, new EventEmitter2());
    userRepo = new UserRepo(kysely);
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

  it('stores user preference primitives as native JSONB values', async () => {
    const workspaceId = uuid7();
    const userId = uuid7();
    const pageId = uuid7();
    const spaceId = uuid7();

    try {
      await database`
        insert into workspaces (id, name)
        values (${workspaceId}::uuid, 'Preference types e2e')
      `;
      await database`
        insert into users (id, name, email, role, workspace_id)
        values (
          ${userId}::uuid,
          'Preference types user',
          ${`preference-types-${userId}@example.test`},
          'owner',
          ${workspaceId}::uuid
        )
      `;
      await database`
        insert into spaces (id, name, slug, workspace_id)
        values (${spaceId}::uuid, 'Preference types space', ${`preference-types-${spaceId}`}, ${workspaceId}::uuid)
      `;

      await userRepo.updatePreference(userId, workspaceId, 'aiPanelOpen', true);
      await userRepo.updatePreference(userId, workspaceId, 'aiPanelWidth', 420);
      await userRepo.updatePreference(userId, workspaceId, 'aiPanelTab', 'ai');
      await userRepo.updatePageEditModeByPageId(
        userId,
        workspaceId,
        pageId,
        'edit',
      );
      await spaceRepo.updateSharingSettings(
        spaceId,
        workspaceId,
        'disabled',
        true,
      );

      const [stored] = await database<
        Array<{
          open_type: string;
          width_type: string;
          tab_type: string;
          open_value: string;
          width_value: string;
          tab_value: string;
          page_mode_type: string;
          page_mode_value: string;
        }>
      >`
        select
          jsonb_typeof(settings #> '{preferences,aiPanelOpen}') as open_type,
          jsonb_typeof(settings #> '{preferences,aiPanelWidth}') as width_type,
          jsonb_typeof(settings #> '{preferences,aiPanelTab}') as tab_type,
          settings #>> '{preferences,aiPanelOpen}' as open_value,
          settings #>> '{preferences,aiPanelWidth}' as width_value,
          settings #>> '{preferences,aiPanelTab}' as tab_value,
          jsonb_typeof(settings #> ARRAY['preferences', 'pageEditModeByPageId', ${pageId}::text]) as page_mode_type,
          settings #>> ARRAY['preferences', 'pageEditModeByPageId', ${pageId}::text] as page_mode_value
        from users
        where id = ${userId}::uuid
      `;
      const [storedSpace] = await database<
        Array<{ disabled_type: string; disabled_value: string }>
      >`
        select
          jsonb_typeof(settings #> '{sharing,disabled}') as disabled_type,
          settings #>> '{sharing,disabled}' as disabled_value
        from spaces
        where id = ${spaceId}::uuid
      `;

      expect(stored).toEqual({
        open_type: 'boolean',
        width_type: 'number',
        tab_type: 'string',
        open_value: 'true',
        width_value: '420',
        tab_value: 'ai',
        page_mode_type: 'string',
        page_mode_value: 'edit',
      });
      expect(storedSpace).toEqual({
        disabled_type: 'boolean',
        disabled_value: 'true',
      });
    } finally {
      await database`delete from users where id = ${userId}::uuid`;
      await database`delete from workspaces where id = ${workspaceId}::uuid`;
    }
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
      const [firstAttempt, competingAttempt] = await Promise.all([
        outboxRepo.claimNext(firstLeaseToken, 60_000),
        outboxRepo.claimNext(secondLeaseToken, 60_000),
      ]);
      const firstClaim = firstAttempt ?? competingAttempt;
      const firstOwnerToken = firstAttempt
        ? firstLeaseToken
        : secondLeaseToken;
      const takeoverToken = firstAttempt ? secondLeaseToken : firstLeaseToken;
      expect(firstClaim).toMatchObject({
        id,
        status: 'processing',
        attemptCount: 1,
        leaseToken: firstOwnerToken,
      });
      expect(firstAttempt === undefined || competingAttempt === undefined).toBe(
        true,
      );
      await expect(
        outboxRepo.renewLease(id!, takeoverToken, 60_000),
      ).resolves.toBe(false);

      await database`
        update queue_outbox
        set lease_expires_at = now() - interval '1 second'
        where id = ${id!}::uuid
      `;

      const reclaimed = await outboxRepo.claimNext(takeoverToken, 60_000);
      expect(reclaimed).toMatchObject({
        id,
        status: 'processing',
        attemptCount: 2,
        leaseToken: takeoverToken,
      });
      await expect(
        outboxRepo.markCompleted(id!, firstOwnerToken),
      ).resolves.toBe(false);
      await expect(
        outboxRepo.markForRetry(
          id!,
          firstOwnerToken,
          new Date(),
          'forged_owner',
        ),
      ).resolves.toBe(false);
      await expect(
        outboxRepo.markFailed(id!, firstOwnerToken, 'forged_owner'),
      ).resolves.toBe(false);
      await expect(
        outboxRepo.markCompleted(id!, takeoverToken),
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

  it('fences expired push aggregation owners without losing a newer event', async () => {
    const workspaceId = uuid7();
    const userId = uuid7();
    const spaceId = uuid7();
    const pageId = uuid7();
    const windowKey = `1h:${new Date().toISOString()}`;

    try {
      await database`
        insert into workspaces (id, name)
        values (${workspaceId}::uuid, 'Push lease e2e')
      `;
      await database`
        insert into users (id, name, email, role, workspace_id)
        values (
          ${userId}::uuid,
          'Push lease user',
          ${`push-lease-${userId}@example.test`},
          'owner',
          ${workspaceId}::uuid
        )
      `;
      await database`
        insert into spaces (id, name, slug, workspace_id)
        values (
          ${spaceId}::uuid,
          'Push lease space',
          ${`push-lease-${spaceId}`},
          ${workspaceId}::uuid
        )
      `;
      await database`
        insert into pages (id, slug_id, title, space_id, workspace_id)
        values (
          ${pageId}::uuid,
          ${`push-lease-${pageId}`},
          'Push lease page',
          ${spaceId}::uuid,
          ${workspaceId}::uuid
        )
      `;

      await pushNotificationJobRepo.upsertPending({
        userId,
        workspaceId,
        pageId,
        windowKey,
        idempotencyKey: `push-lease:${pageId}:1`,
        sendAfter: new Date(0),
        payload: { event: 1 },
      });

      const firstClaim = await pushNotificationJobRepo.claimDuePending(
        1,
        60_000,
      );
      expect(firstClaim.jobs).toHaveLength(1);
      expect(firstClaim.jobs[0]).toMatchObject({
        status: 'processing',
        revision: 1,
      });

      await pushNotificationJobRepo.upsertPending({
        userId,
        workspaceId,
        pageId,
        windowKey,
        idempotencyKey: `push-lease:${pageId}:2`,
        sendAfter: new Date(0),
        payload: { event: 2 },
      });
      await expect(
        pushNotificationJobRepo.finalizeClaimed({
          leaseToken: firstClaim.leaseToken,
          sent: [{ id: firstClaim.jobs[0].id, revision: 1 }],
          cancelled: [],
          retry: [],
        }),
      ).resolves.toEqual({
        sent: 0,
        cancelled: 0,
        retried: 0,
        superseded: 1,
      });

      const secondClaim = await pushNotificationJobRepo.claimDuePending(
        1,
        60_000,
      );
      expect(secondClaim.jobs[0]).toMatchObject({
        status: 'processing',
        revision: 2,
        eventsCount: 2,
      });
      await database`
        update push_notification_jobs
        set lease_expires_at = now() - interval '1 second'
        where id = ${secondClaim.jobs[0].id}::uuid
      `;

      const takeover = await pushNotificationJobRepo.claimDuePending(1, 60_000);
      expect(takeover.jobs).toHaveLength(1);
      await expect(
        pushNotificationJobRepo.finalizeClaimed({
          leaseToken: secondClaim.leaseToken,
          sent: [{ id: secondClaim.jobs[0].id, revision: 2 }],
          cancelled: [],
          retry: [],
        }),
      ).resolves.toMatchObject({ sent: 0 });
      await expect(
        pushNotificationJobRepo.finalizeClaimed({
          leaseToken: takeover.leaseToken,
          sent: [{ id: takeover.jobs[0].id, revision: 2 }],
          cancelled: [],
          retry: [],
        }),
      ).resolves.toMatchObject({ sent: 1 });

      const [persisted] = await database<
        Array<{
          status: string;
          revision: number;
          events_count: number;
          lease_token: string | null;
        }>
      >`
        select status, revision, events_count, lease_token
        from push_notification_jobs
        where id = ${takeover.jobs[0].id}::uuid
      `;
      expect(persisted).toEqual({
        status: 'sent',
        revision: 2,
        events_count: 2,
        lease_token: null,
      });
    } finally {
      await database`delete from workspaces where id = ${workspaceId}::uuid`;
    }
  });
});
