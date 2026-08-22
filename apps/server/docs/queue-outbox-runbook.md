# Queue Outbox Runbook

The `queue_outbox` table is the database source of truth for side effects that
must not be lost when a domain transaction commits. BullMQ carries only an
empty `PROCESS_QUEUE_OUTBOX` wake-up signal; losing that signal is safe because
the periodic sweep claims due database rows.

Current producers are:

- workspace invitation creation and resend (`workspace_invitation_email`);
- workspace invitation acceptance (`workspace_invitation_accepted_email`);
- page duplication with attachment copies (`duplicate_page_attachments`);
- synchronized template publication and retry dispatch (`page_template_sync`);
- immediate notification email delivery (`notification_email`);
- comment-created, comment-edited, comment-resolved, and page-history
  `document-changed` notification dispatch (`notification_dispatch`);
- page, space, trash, and user-avatar storage cleanup
  (`attachment_cleanup`);
- generic, Notion, and confirmed Docmost ZIP import execution (`file_import`).

The producer inserts its outbox row in the same PostgreSQL transaction as the
corresponding domain change. Do not replace this with a direct BullMQ write or
put invitation tokens into a BullMQ payload.

Notification rows and their encrypted immediate-email intents are inserted in
one PostgreSQL transaction. Comment changes and page-history records commit
with their notification-dispatch intents in the same way. Redis receives only
a deterministic dispatch job; if Redis is unavailable after commit, the
15-second sweep recreates it.

## Delivery and lifecycle

Rows move through `pending`, `processing`, and one terminal state:
`completed`, `cancelled`, or `failed`.

- The worker claims rows with `FOR UPDATE SKIP LOCKED` and a random owner token.
- A processing lease lasts 2 minutes and is renewed sequentially every 30
  seconds. Completion, cancellation, retry, and failure require the same owner
  token. An expired lease can be reclaimed by another worker.
- A periodic BullMQ processing signal runs every 15 seconds. Immediate signals
  are only a latency optimization. A separate fixed hourly job performs
  retention cleanup in batches of at most 1,000 rows, capped at 20 batches for
  each terminal retention class per run.
- Transient failures use exponential retry delays from 5 seconds up to 15
  minutes. A row becomes `failed` after 20 processing attempts.
- `completed` and `cancelled` rows are deleted after 7 days. Failed mail and
  notification-delivery rows are redacted and deleted after 90 days. Failed
  attachment cleanup, file import, attachment duplication, and template-sync
  rows are retained until an operator resolves or explicitly removes them, so a
  durable domain intent is never erased merely because its retry budget expired.

Delivery is **at least once**, not exactly once. A process can crash after an
external mail provider accepted a message but before PostgreSQL records
completion, so an invitation or acceptance email can be sent more than once.
The same transport-level duplicate risk applies to immediate notification
email. Notification creation and `emailed_at` finalization are fenced by the
outbox owner and notification deduplication key, so a duplicate delivery does
not create a second in-app notification or another domain change.
Attachment duplication reuses deterministic attachment IDs and validates an
existing destination row and storage object, making a reclaimed attempt
idempotent. Source attachment pins are inserted with the duplicate tree and
outbox row, block page/space hard deletion, and are released only by a fenced
successful dispatch. Failed work remains pinned for operator recovery.
Template synchronization dispatches a durable sync run whose items,
leases, and applied revisions make reclaimed attempts idempotent. Downstream
search/content-index jobs are also safe to repeat.

Attachment cleanup first copies the exact storage paths into
`attachment_cleanup_batches` and `attachment_cleanup_items`, deletes the live
attachment rows, and inserts the outbox row in the same domain transaction.
The worker claims at most 50 items at a time. Missing storage objects count as
success; a partial storage failure remains durable and makes the outbox attempt
retry instead of completing the batch. One dispatch processes at most 20
chunks. A clean larger remainder returns the batch to `pending`, and a
lease-fenced periodic continuation resumes it without spending the outbox error
budget. A crash leaves `processing` with an expiry; the continuation reclaims it
only after that lease expires.

Generic, Notion, and Docmost previews persist the file task and archive artifact
locator in `uploading` before storage upload. Generic/Notion admission and
Docmost confirmation each commit their `pending` state and deterministic
`file_import` outbox row atomically. Unconfirmed Docmost previews have
`options is null` and are never dispatched. Confirmation and cancellation use
the same conditional state transition, so only one can win. Processing has a
renewable owner token; page IDs, slugs, and attachment IDs are stable for the
task. Pages, attachment rows, artifact states, checkpoints, and terminal
success commit under the same lease fence. On the final failed attempt the task
is fenced to `failed` before best-effort storage compensation; the failed-task
reconciler therefore retains ownership if storage is unavailable.

## Secret and privacy handling

The raw workspace invitation token and prepared immediate notification email
envelope exist only in the encrypted `secret_payload` column. The non-secret
invitation JSON payload stores its SHA-256 hash so
the worker can compare the decrypted token with the live invitation row before
sending. A rotated, consumed, deleted, or expired invitation cancels the old
outbox row instead of sending a stale link.

`secret_payload` is cleared for every terminal state. Failed invitation rows
also replace their public payload with opaque workspace, invitation, and user
identifiers and their deduplication key with an opaque row identifier before
retention begins; email addresses, names, hostnames, and token hashes are
discarded. The migration applies the same redaction to existing failed
invitation rows. Do not select, export, log, or copy `payload` or
`secret_payload` during routine monitoring. Nonterminal delivery rows can still
contain email addresses and other personal data even when they contain no
credential.

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

Also alert when an attachment cleanup batch is not `completed`, an import stays
in `uploading` beyond its lease, or an import processing lease is expired. Read
only aggregate state; storage paths and source paths are not routine monitoring
fields.

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

For `attachment_cleanup`, correct storage access and requeue only the exact
failed outbox row. Completed item rows make replay idempotent. For
`file_import`, first inspect the task status and lease: do not reset a live
`processing` owner. A `pending` task or an expired processing lease is reclaimed
automatically. Do not manually delete import artifacts; the worker checks the
committed attachment row before compensation.

## Migration rollback boundary

The durable deletion/import migration cannot be rolled back while it still owns
work that the previous direct-queue runtime cannot recover. Before running its
`down` migration, stop new writes and verify all of the following in the same
maintenance window:

- every `attachment_cleanup_batches` row is `completed`;
- no `uploading`, `pending`, or `processing` import has an artifact locator or
  `file_import` outbox intent;
- no import artifact remains `pending` or `uploaded`.
- no `page_duplicate_attachment_pins` row or recoverable
  `duplicate_page_attachments` outbox entry remains before rolling back the
  attachment-pin migration.

The migration enforces these conditions and aborts before deleting an outbox
intent or dropping a locator table. Drain or recover the exact rows and retry
the precondition; never delete locator rows to force rollback. Historical
successful imports receive an archive locator and cleanup intent during upgrade
because an older worker could commit the database tree and then fail to delete
the ZIP. Unconfirmed Docmost previews (`options is null`) receive a locator but
no execution intent, so an upgrade cannot import them without confirmation.
The bounded five-minute reconciler expires previews left unconfirmed for 24
hours through the same compare-and-set state boundary as confirmation, then
uses the durable artifact locator for storage cleanup.

## Verification

After changing the schema or processing behavior, run:

```bash
pnpm --filter ./apps/server migration:latest
pnpm --filter ./apps/server test --runInBand \
  --runTestsByPath \
  src/integrations/queue/outbox/queue-outbox.service.spec.ts \
  src/integrations/queue/outbox/queue-outbox-bootstrap.service.spec.ts \
  src/core/attachment/services/attachment-cleanup.service.spec.ts \
  src/integrations/import/services/import.service.durability.spec.ts \
  src/integrations/import/services/file-import-task.service.durability.spec.ts \
  src/integrations/queue/services/duplicate-page-attachments.service.spec.ts \
  src/core/workspace/services/workspace-invitation.service.spec.ts \
  src/core/page/services/page.service.duplicate.spec.ts \
  src/core/page/services/page-template.service.spec.ts
pnpm --filter ./apps/server test:e2e --runInBand \
  --runTestsByPath test/app.e2e-spec.ts
```

Do not insert an extra standalone `--` before the Jest options: pnpm passes it
through literally and Jest can silently skip the requested paths or report that
no tests were found.

The targeted e2e spec requires disposable PostgreSQL and Redis services and verifies a
fresh migrated `queue_outbox` schema, deduplication, expired-lease recovery,
owner fencing, concurrent claims, and terminal secret cleanup.

## Aggregated push notification jobs

`push_notification_jobs` is a separate durable PostgreSQL work queue; it is not
an outbox event and its payload must not be copied into BullMQ. A repeatable
BullMQ job only wakes `PushAggregationService` once per minute.

- Claims use `FOR UPDATE SKIP LOCKED`, a random `lease_token`, and a 2-minute
  `lease_expires_at`. The owner renews the lease every 30 seconds.
- Finalize and retry updates require both the current token and the claimed row
  `revision`. Expired work is reclaimed automatically. A stale owner cannot
  change the row after takeover.
- An event arriving during `processing` increments `revision` without stealing
  the active lease. Finalization of the older revision releases the row back to
  `pending`, so the newer aggregate is not lost.
- A lost lease or shutdown is fail-closed: the process stops finalizing claimed
  rows and recovery is performed by the next repeat run after lease expiry.
- `sent` and `cancelled` rows are retained as the authoritative terminal state;
  transient delivery failures return to `pending` with bounded exponential
  delay, and the third failed delivery becomes `cancelled`.

Monitor only aggregate columns:

```sql
select status,
       count(*) as job_count,
       count(*) filter (
         where status = 'processing' and lease_expires_at <= now()
       ) as expired_processing_count
from push_notification_jobs
group by status
order by status;
```

The process-local operational snapshot and structured batch logs contain only
low-cardinality counters: claimed, completed, retried, failed, lease-lost,
reconciled, superseded, batch count, and aggregate duration. Do not add user,
workspace, page, token, endpoint, or payload labels.

The e2e suite also verifies that a new event is preserved during processing,
an expired lease can be reclaimed, the previous token is fenced, and only the
current owner can set the terminal state.
