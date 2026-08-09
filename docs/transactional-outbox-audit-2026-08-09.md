# G24 Transactional Outbox, Queue Recovery, and Privacy-Safe Logging Audit

Date: 2026-08-09

Baseline: `a010ea734f9625d22c886a8d62114b99495f8d07`

## Verdict

**Pass with documented limitations after remediation.** No unresolved critical,
high, or medium-severity defect was found in the audited outbox boundary. The
audit fixed one medium privacy issue in page-template failure metadata and one
low-severity verification defect in the operator runbook. It also added missing
recovery, fencing, producer-atomicity, and attachment-copy regression coverage.

The result is evidence for the audited PostgreSQL/Redis/log-driver setup. It is
not a claim that every external SMTP or object-storage provider has been tested.

## Scope and method

The review covered the current implementation, the outbox migration and
runbook, and the relevant history, including the initial transactional outbox
change (`b081e472`), notification/lease hardening (`4d9824ef`), worker log
redaction (`6f65ae26`), and later queue producers (`583eb96f`).

The following boundaries were traced from producer transaction through worker
finalization:

| Flow | Domain/outbox atomicity | Recovery and idempotence evidence |
| --- | --- | --- |
| Invitation create and resend | Invitation mutation and encrypted email dispatch are written in the same Kysely transaction; the queue kick occurs after commit. | Expired invitations cancel without mail, the token hash is verified before delivery, and terminal transitions clear the secret. A dropped immediate BullMQ kick was recovered by the periodic sweep. |
| Invitation accept | User/membership/invitation acceptance and acceptance-email dispatch share one transaction. | An injected outbox insert failure rolled back the user creation and left the invitation pending. Successful acceptance produced a completed terminal dispatch with no retained secret. |
| Page duplication attachments | Page duplication and deterministic attachment mapping dispatch share one transaction. | Deterministic destination IDs, destination ownership/path validation, and storage existence checks allow a partial retry to resume without aliasing or recopying a consistent destination. |
| Synced template publish and retry | Revision/run changes and the template-sync dispatch share the same transaction; the queue kick occurs after commit. | New tests cover both publish and explicit retry. The run has an independent lease and recoverable partial progress. |
| Notifications | Notification rows and dispatch records use the transactional outbox contract. | Existing deduplication, lease fencing, bounded retries, and privacy-safe queue logging remain covered by the security suite. |

The outbox repository uses `FOR UPDATE SKIP LOCKED`, random lease-owner tokens,
expired-lease reclamation, and token-fenced renew/complete/retry/fail updates.
The worker has a 15-second recovery sweep, sequential lease renewal, bounded
exponential retry, a 20-attempt budget, and terminal retention cleanup.

## Environment

- Windows host and PowerShell; isolated worktree
  `D:\DevProjects\docmost-qa-G24`.
- Node.js 22-compatible project toolchain through Corepack and `pnpm@10.4.0`.
- Docker Server `29.5.3`, Linux/amd64; Docker Compose `v5.1.4`.
- Isolated Compose project `docmost-g24` with PostgreSQL 18, Redis 8, API, and
  collaboration containers. The application image was built from the audited
  worktree; manifest digest:
  `sha256:51851fab6c805dbdf25f80e2ab89f023fbe1614e2e785c382d51ada0576222f7`.
- Synthetic browser users, invitations, pages, credentials, and canaries only.
  No real deployment database, Redis instance, mail provider, or storage bucket
  was used.

## Fault and recovery matrix

| Scenario | Observed result |
| --- | --- |
| Invitation-create outbox insert fails inside the transaction | UI returned an error; database counts remained `invitations=0`, `outbox=0`. |
| Invitation-acceptance outbox insert fails inside the transaction | UI returned an error; database counts remained `users=0`, `accepted_outbox=0`, while the invitation remained unaccepted and retryable. |
| Immediate BullMQ wake-up is removed | The record was observed as `pending`, `attempts=0`, with an encrypted secret; the periodic sweep later completed it at `attempts=1` and cleared the secret. |
| Two workers claim the same available record concurrently | Exactly one claimant acquired it. After forced lease expiry, the other claimant reclaimed it with `attemptCount=2`. |
| Previous lease owner attempts terminal transitions after takeover | Complete, retry, and fail operations from the previous owner all returned false; only the current owner completed the record. |
| External side effect succeeds and final database update fails | Deterministic unit injection proved the email call occurred once and no incorrect retry/failure transition was written; the processing record remains available for lease-expiry recovery. This is deliberately at-least-once and may duplicate the external side effect. |
| Attachment copy is only partially complete | Retry reused the validated existing destination, copied only the missing object, and requeued downstream indexing/extraction. A destination in another workspace was rejected without copy, insert, or downstream jobs. |
| Invitation expires or encrypted token does not match its hash | Expired dispatch was cancelled without mail; a hash mismatch became a terminal failure without mail. |
| Raw storage/provider error contains a path/canary | Page-template failure metadata now accepts only bounded stable snake-case codes and otherwise stores `page_template_operation_failed`. |

SQL failpoints were scoped to synthetic addresses and removed immediately after
each assertion. The test stack and its volumes are disposable and are removed
after verification.

## Findings and remediation

### G24-01: arbitrary page-template failure text could reach logs and database

Severity before fix: **Medium**.

`PageTemplateService.errorCode` accepted an arbitrary `Error.message`. The
value is persisted in template operation/sync failure fields and can be logged,
so a provider or storage error could disclose a path, query value, credential
fragment, or personal data. The service now accepts only an explicit bounded
snake-case semantic code and otherwise uses
`page_template_operation_failed`. A canary regression test covers the fallback.

### G24-02: runbook Jest commands could provide false confidence

Severity before fix: **Low**.

The standalone `--` in the documented pnpm commands was passed literally to
Jest. One reproduction silently omitted the intended page-duplication suite;
the E2E form exited with "No tests found". The runbook now uses exact
`--runTestsByPath` commands, includes attachment-copy and page-template tests,
and warns against the extra separator.

### G24-03: recovery contracts lacked direct regression coverage

Severity before fix: **Low**.

Coverage was added for concurrent claim/exactly-one ownership, expired-lease
takeover, all stale-owner terminal operations, bounded retry delay, terminal
secret cleanup, expired and hash-mismatched invitations, the post-side-effect
finalization window, template publish/retry transaction ordering, and partial
attachment-copy recovery without cross-workspace aliasing.

## Privacy and secret lifecycle

- Invitation tokens are encrypted in `secret_payload`, verified against the
  invitation hash before mail delivery, and cleared on completed, failed, or
  cancelled terminal states.
- URL and mail logs use metadata-only events. The log mail driver emits a
  diagnostic delivery-disabled event instead of recipients, subjects, bodies,
  or invitation URLs.
- Container and browser-console scans found zero occurrences of the synthetic
  email, password, invitation query, mail subject, raw secret, and privacy
  canary. The browser console contained one expected HTTP 400 entry from the
  deliberately injected rollback test and no sensitive values.
- Queue worker failure logs retain stable job/error codes, not raw provider
  errors. Page-template failure metadata now follows the same rule.

## Verification

| Command or check | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Exit 0. |
| Targeted six-suite server command from the corrected runbook | Exit 0; 6 suites, 40 tests. |
| `corepack pnpm --filter ./apps/server test:e2e --runInBand --runTestsByPath test/app.e2e-spec.ts` | Exit 0; 5 tests against real PostgreSQL and Redis. |
| `corepack pnpm verify:quick` | Exit 0; backend 212 suites/1669 tests, server security 66 suites/772 tests, client security 6 files/74 tests, lint/env/build/release gates passed. Jest reported its existing graceful-exit/open-handle warning after the backend stage, but returned success and the remaining stages completed. |
| `corepack pnpm check:comments:en` | Exit 0. |
| `corepack pnpm test:text-contracts` | Exit 0. |
| `corepack pnpm routes:inventory:check` | Exit 0; 310 routes. |
| `docker build -t docmost:g24-a010ea73 .` | Exit 0; all four Nx production builds completed. |
| Browser owner/member workflow | Owner invitation, member acceptance, member page creation/duplication, owner visibility, and post-fix owner/member login were observed. Screenshots are retained under ignored `output/g24/browser/`. |
| Privacy scans | Zero synthetic secret/PII canary matches in server logs and browser console. |
| `git diff --check` | Exit 0; only configured line-ending conversion warnings. |

The first final-image E2E rerun exited 1 before executing its assertions because
the disposable Compose URL still contained Prisma's `?schema=public` query
parameter, which the direct `postgres` client treated as an unsupported server
startup parameter. Removing that query component for the E2E process produced
the successful 5/5 result above; the application containers continued to use
their unchanged Compose URL.

The broader `test:e2e --runInBand` attempt was **not fully green**: 15 tests
passed and one existing collaboration Redis-sync test failed with
`Connection is closed`; the app, CSRF, AI-profile, and targeted outbox
infrastructure tests passed. Therefore this audit does not claim full E2E suite
sign-off.

## Residual limitations and operational risk

- Delivery is intentionally at least once. If an SMTP provider accepts a
  message and the process loses the database before finalization, the expired
  lease can redeliver it. The stable dispatch ID must remain available for
  provider-side deduplication where the provider supports it.
- Mail behavior was exercised with the diagnostic log driver, not a real SMTP
  or Postmark account. Provider acceptance, timeout, and provider-side
  deduplication still need deployment-specific testing.
- Attachment recovery was tested deterministically at the service/storage
  contract boundary, not against S3, MinIO, or a forced filesystem outage.
- Template publish and retry atomicity were covered at the service transaction
  boundary, not through a complete multi-consumer browser scenario.
- Two real authorization roles were exercised sequentially in the in-app
  browser. A second simultaneous Chrome automation context was attempted but
  blocked by the local browser-control confirmation path, so simultaneous
  multi-session behavior is not claimed.
- The unrelated Redis-sync E2E failure must be resolved or independently
  waived before a repository-wide E2E release sign-off.

## Release decision

The G24 outbox, lease recovery, secret lifecycle, and privacy-safe logging
boundary is acceptable for integration with the limitations above. Before a
production release, run the corrected outbox command in the runbook, the full
release pipeline, a provider-specific mail failure/retry exercise, an
object-storage partial-copy exercise, and the unresolved collaboration Redis
E2E check.
