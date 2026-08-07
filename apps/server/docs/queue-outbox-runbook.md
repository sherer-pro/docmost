# Queue Outbox Runbook

The `queue_outbox` table is the database source of truth for side effects that
must not be lost when a domain transaction commits. BullMQ carries only an
empty `PROCESS_QUEUE_OUTBOX` wake-up signal; losing that signal is safe because
the periodic sweep claims due database rows.

Current producers are:

- workspace invitation creation and resend (`workspace_invitation_email`);
- workspace invitation acceptance (`workspace_invitation_accepted_email`);
- page duplication with attachment copies (`duplicate_page_attachments`);
- synchronized template publication and retry dispatch (`page_template_sync`).

The producer inserts its outbox row in the same PostgreSQL transaction as the
corresponding domain change. Do not replace this with a direct BullMQ write or
put invitation tokens into a BullMQ payload.

## Delivery and lifecycle

Rows move through `pending`, `processing`, and one terminal state:
`completed`, `cancelled`, or `failed`.

- The worker claims rows with `FOR UPDATE SKIP LOCKED` and a random owner token.
- A processing lease lasts 2 minutes and is renewed sequentially every 30
  seconds. Completion, cancellation, retry, and failure require the same owner
  token. An expired lease can be reclaimed by another worker.
- A periodic BullMQ signal runs every 15 seconds. Immediate signals are only a
  latency optimization.
- Transient failures use exponential retry delays from 5 seconds up to 15
  minutes. A row becomes `failed` after 20 processing attempts.
- `completed` and `cancelled` rows are deleted after 7 days. `failed` rows are
  retained for diagnosis and explicit recovery.

Delivery is **at least once**, not exactly once. A process can crash after an
external mail provider accepted a message but before PostgreSQL records
completion, so an invitation or acceptance email can be sent more than once.
Attachment duplication reuses deterministic attachment IDs and validates an
existing destination row and storage object, making a reclaimed attempt
idempotent. Template synchronization dispatches a durable sync run whose items,
leases, and applied revisions make reclaimed attempts idempotent. Downstream
search/content-index jobs are also safe to repeat.

## Secret and privacy handling

The raw workspace invitation token exists only in the encrypted
`secret_payload` column. The non-secret JSON payload stores its SHA-256 hash so
the worker can compare the decrypted token with the live invitation row before
sending. A rotated, consumed, deleted, or expired invitation cancels the old
outbox row instead of sending a stale link.

`secret_payload` is cleared for every terminal state. Do not select, export,
log, or copy `payload` or `secret_payload` during routine monitoring. The
regular payload can contain email addresses and other personal data even when
it contains no credential.

## Monitoring

Use aggregate queries that do not read payload columns:

```sql
select
  kind,
  status,
  count(*) as entry_count,
  min(created_at) as oldest_created_at,
  max(attempt_count) as highest_attempt_count
from queue_outbox
group by kind, status
order by kind, status;
```

Inspect bounded failure metadata without reading payloads:

```sql
select id, kind, last_error_code, attempt_count, created_at, failed_at
from queue_outbox
where status = 'failed'
order by failed_at asc
limit 100;
```

Alert on:

- any `failed` row;
- a `pending` row older than the maximum expected retry interval;
- repeated `retry_exhausted` or `permanent_processing_error` codes;
- the `mail_delivery_disabled` warning in a production deployment.

Application logs intentionally contain only the outbox row ID and stable error
codes. Mail recipient addresses, subjects, message bodies, invitation tokens,
URL query values, and raw provider errors must not be added to logs.

## Recovery

1. Correct the database, Redis, storage, or mail-provider failure first.
2. Leave `pending` or `processing` rows alone. The periodic sweep reclaims a due
   row or an expired lease automatically.
3. For a failed invitation email, use the product's **Resend invitation** action.
   The terminal row no longer contains the raw token and must not be requeued.
4. For a failed acceptance email, decide explicitly whether a possible duplicate
   email is acceptable before requeueing or sending an operator message.
5. A failed attachment-duplication row may be requeued only after validating the
   source and destination pages and selecting one exact row ID. Use a database
   transaction and never perform a broad status update:

```sql
begin;

update queue_outbox
set status = 'pending',
    available_at = now(),
    attempt_count = 0,
    last_error_code = null,
    failed_at = null,
    updated_at = now()
where id = 'REPLACE_WITH_EXACT_OUTBOX_UUID'::uuid
  and kind = 'duplicate_page_attachments'
  and status = 'failed';

commit;
```

Confirm that exactly one row changed. If it did not, roll back the investigation
and do not widen the predicate.

## Verification

After changing the schema or processing behavior, run:

```bash
pnpm --filter ./apps/server migration:latest
pnpm --filter ./apps/server test -- --runInBand \
  --runTestsByPath \
  src/integrations/queue/outbox/queue-outbox.service.spec.ts \
  src/integrations/queue/outbox/queue-outbox-bootstrap.service.spec.ts \
  src/core/workspace/services/workspace-invitation.service.spec.ts \
  src/core/page/services/page.service.duplicate.spec.ts
pnpm --filter ./apps/server test:e2e -- --runInBand
```

The e2e suite requires disposable PostgreSQL and Redis services and verifies a
fresh migrated `queue_outbox` schema, deduplication, expired-lease recovery,
owner fencing, and real Redis lease ownership behavior.
