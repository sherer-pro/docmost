# RAG, Open WebUI, and embedded rag-sync audit — 2026-08-07

## Executive result

The audited implementation is the embedded runtime in
`apps/server/src/core/rag-sync`. The historical standalone `apps/rag-sync`
directory was not used or modified by this audit.

Three security and consistency gaps were confirmed and fixed:

1. Public RAG feeds used cursors that did not bind a page to a stable snapshot
   or to its feed and authorization scope.
2. External retrieval results were filtered before the outbound call, but a
   source could become inaccessible before the result reached the model or
   while the model was streaming.
3. The writer checked an abort signal at the outer quantum boundary, but did
   not consistently check it around every remote list, upload, delete, poll,
   DNS, and response-read boundary.

The resulting design uses opaque v2 snapshot cursors, a shared live-source
access guard, persisted run dependencies, fail-closed streaming, and stricter
lease-loss abort checks. No production environment variable or database
migration was added.

The local deterministic contract suite, isolated two-replica Chromium flow,
and pinned real Open WebUI compatibility suite pass. The real compatibility
suite is also provided as a manual and weekly job.

## Scope and trust boundaries

The review covered:

- the RAG API controller, export service, DTOs, rate/concurrency admission, and
  API-key authorization;
- created, updated, deleted, attachment, and blocked-content feeds;
- cursor encoding, authorization scope, and checkpoint handling;
- page, database, database-row, and attachment identity/liveness rules;
- external `http-json-v1` and `open-webui-knowledge-v1` retrieval adapters;
- AI prompt construction, source citations, run dependencies, streaming, and
  conversation history;
- embedded rag-sync binding discovery, source processing, Redis state,
  reconciliation, drain, target ownership, leases, and the Open WebUI writer;
- deployment environment validation and documentation contracts.

The supplied `localhost:3000` session cookies and any existing Knowledge Base
were deliberately not used. Browser and integration tests ran against a fresh
stack exposed only at `http://127.0.0.1:3200` and were destroyed after the run.

## Implemented corrections

### Live source access and AI fail-closed behavior

`AiSourceAccessService` is now the internal authority for resolving a source
identity against the current workspace, space, page/database-row state,
attachment replacement state, exclusion policy, and effective page ACL.

The retrieval service obtains the full allowed source set before calling an
external adapter and resolves only the returned identities again after that
call. Retrieval dependencies are stored before provider execution. The run
executor rechecks those dependencies before provider work, between agent/model
steps, before every stream flush, and inside final persistence.

If access changes, the stable error is `source_access_changed`. The server
clears partial answer text, reasoning, and citations. The client discards
pending deltas, removes the local streaming run, refetches the message, and
renders the existing restricted-content state. History also treats excluded,
deleted, archived, and replaced source identities as inaccessible.

This preserves shared-Knowledge semantics: a personal ACL revoke does not
delete a file that remains readable by another user, but the revoked user
cannot retrieve it or read an old AI answer that depended on it. Physical
remote deletion remains tied to deletion, exclusion, archived row/attachment
state, target replacement, and space drain.

### Opaque RAG feed cursor v2

Every public feed cursor now binds:

- cursor version and feed kind;
- workspace and space;
- authorization/scope fingerprint;
- the original `updatedSince` or `deletedSince` watermark;
- a database-derived snapshot upper bound;
- the last `(timestamp, id)` position.

Every page is read inside the original fixed range. The response advances its
terminal watermark to the snapshot upper bound only when `hasMore` is false.
Cursor reuse across feed, workspace, space, scope, or watermark is rejected as
`400 Invalid RAG feed cursor`. Version 1 is intentionally unsupported.

The embedded synchronizer persists the feed cursor with its starting
watermark and commits a checkpoint only after the snapshot reaches its terminal
page. An empty terminal snapshot advances the checkpoint as well.

### Lease and remote-operation boundary

Binding-lease or global-slot renewal loss aborts the active quantum. Abort
checks now bracket URL policy/DNS work, fetch, response reads, upload, delete,
Knowledge listing, and processing polls. Once aborted, the writer cannot start
a new remote request and the fenced state store rejects stale-owner writes.

### Reproducible compatibility infrastructure

The fixture implements the exact writer and retrieval shapes used by Docmost,
fixed 30-item Knowledge pagination, metadata hydration, operation-ID counters,
and programmable timeout, disconnect, `429`, `500`, malformed, and delayed
side-effect faults. It supports mixed valid/unreadable files and both retrieval
adapters.

`tests/rag-sync/compose.yml` provides PostgreSQL, Redis, two Docmost replicas,
the fixture, and Toxiproxy. The `real-open-webui` profile adds the pinned real
Open WebUI image. Failure artifacts are written below `output/audit` while a
successful browser run removes its stack and volumes.

## Scenario matrix

Status meanings:

- **E2E passed**: exercised against the isolated Docker stack and Chromium.
- **Contract passed**: exercised against the deterministic HTTP fixture.
- **Focused passed**: exercised by a targeted Jest test at the relevant
  boundary.
- **Compatibility job**: exercised by the pinned real-Open-WebUI manual/weekly
  job; it is not a PR gate.
- **Residual**: the listed destructive infrastructure event was not performed
  as a full black-box test in the local run.

| # | Scenario | Evidence and result |
|---:|---|---|
| 1 | Initial full sync | **Focused passed / Contract passed.** Ownership metadata, deterministic operation IDs, adoption, duplicate cleanup, and 30-item pagination are covered. Repeating an adopted operation does not upload again. |
| 2 | Incremental create/update/delete | **Focused passed.** Deletions are processed before updates; checkpoints commit only at terminal pages; changed source tuples create a new operation and stale mappings are cleaned. |
| 3 | Rename/move | **Focused passed.** The source tuple/content identity controls replacement, while citations are resolved from current local page metadata instead of trusting remote URLs. A move with unchanged content is not required to upload again. |
| 4 | Database and rows | **Focused passed.** Resumable row offsets, archived/deleted row reclassification, bounded deletion cascades, and stale-row reconciliation are covered. |
| 5 | PDF/DOCX attachments | **Contract passed / Real compatibility passed.** Generated PDF/DOCX fixtures validate filename, MIME type, SHA-256, unique text, processing, retrieval, and deletion contracts against Open WebUI v0.11.0. |
| 6 | Replacement attachment | **Focused passed.** Authoritative attachment identity and content hash select the new upload; unsupported/replaced earlier uploads are marked for cleanup; replay is idempotent. |
| 7 | ACL revoke | **E2E passed / Focused passed.** Delayed retrieval is filtered after revoke. Mid-provider revoke fails with `source_access_changed`, clears partial output/citations, and leaves the shared remote file available to another reader. |
| 8 | Content exclusion | **Focused passed.** Scope changes abort active work; late excluded uploads are deleted; retrieval and history use the same live exclusion guard. |
| 9 | Space deletion | **Focused passed.** Archived spaces remain discoverable for drain, drain requires stable empty observations, and target claims are released only after fenced cleanup. |
| 10 | Key revoke | **Contract passed / Focused passed.** Fixture writer-key revoke is immediate; management tests cover encrypted rotation and missing-key isolation. Existing RAG API-key authorization tests cover revoked keys. |
| 11 | Creator removed/downgraded | **Focused coverage in API-key/page-access suites.** Every request rechecks membership and the creator's current readable-page snapshot. No separate black-box browser downgrade was run. |
| 12 | Worker restart | **Focused passed; Residual.** Upload intents, operation adoption, database progress, scan cursors, and replay checkpoints survive process-local loss. A live container kill during a large import is not yet a PR fixture assertion. |
| 13 | Redis restart | **Focused passed; Residual.** Remote v2 ownership scanning, orphan adoption, reconciliation, and corrupt-state isolation are covered. A live Redis container restart during a quantum is not yet a PR fixture assertion. |
| 14 | Lease loss during upload/delete | **Focused passed.** Renewal loss aborts the quantum; blocked attachment streams are destroyed; writer tests prove no DNS/request starts after abort. Toxiproxy supplies delayed-side-effect transport faults, but the local black-box run did not delete a Redis lease during a live upload. |
| 15 | Two workers | **Focused passed / E2E topology passed.** The stack runs two replicas; binding ownership tests allow one owner and renewal-loss abort. The browser flow exercised the shared queue, while duplicate fixture operation IDs remained zero. |
| 16 | Timeout, 429, 500, malformed | **Contract passed.** Writer/retrieval endpoints exercise status, malformed JSON, disconnect, timeout, bounded response reads, retry classification, and safe errors without response-body leakage. |
| 17 | One unreadable file | **Focused passed.** A metadata hydration `403` or malformed neighbor drops only that hit and keeps valid results. Candidate and body byte limits are independent. |
| 18 | Cursor pagination | **Focused passed.** Pages/updates/deleted/attachment/blocked SQL uses millisecond precision, `(timestamp,id)` tie-breaking, fixed upper bounds, feed/scope/watermark validation, and v1 rejection. |
| 19 | Source becomes inaccessible | **E2E passed.** Chromium observed a cited `[C1]` answer, then the restricted history state after revoke. A delayed provider request revoked mid-run emitted no new answer/citation and persisted an empty failed message with `source_access_changed`. |
| 20 | No stale content after deletion | **Focused passed / Contract passed.** Reconciliation removes detached, duplicate, legacy-owned, late-accepted, deleted, excluded, and drained content; stable drain checks leave no owned mapping or file. |

Additional focused coverage verifies RAG admission limits, Redis renewal/fencing,
corrupt mapping/progress isolation, environment bounds, credential encryption,
and omission of writer credentials from runtime binding objects.

## Verification evidence

The following commands were executed locally on 2026-08-07:

- `pnpm test:rag-sync:contract` — passed: 3 fixture contract tests and 16 Jest
  suites, 156 Jest tests.
- `pnpm test:rag-sync:e2e` (through the equivalent isolated runner with an
  already built image) — passed: two replicas, PostgreSQL, Redis, fixture,
  Toxiproxy, Chromium citation UI, history restriction, and mid-stream revoke.
- `pnpm test:rag-sync:open-webui` — passed against the pinned Open WebUI
  v0.11.0 image: Knowledge CRUD, MD/PDF/DOCX upload and processing, retrieval,
  and deletion.
- in-app browser inspection at `http://127.0.0.1:3200` — independently observed
  the restricted AI-message text for the synthetic member; the tab and test
  stack were then removed.
- `pnpm check:env` — passed.
- `pnpm check:ai-docs` — passed: 20 critical routes and 14 migrations.
- `pnpm check:rag-docs` — passed: 15 RAG routes.
- `pnpm routes:inventory:check` — passed: 306 routes.
- production Docker build used by the isolated E2E — passed for server and
  client.
- `pnpm verify:full` — passed: environment and documentation checks, all four
  builds, server/client lint, 202 backend suites (1,560 tests), 123 frontend
  files (579 tests), 65 backend security suites (738 tests), and 6 frontend
  security files (74 tests).

## Pinned provenance

- Open WebUI: `ghcr.io/open-webui/open-webui:v0.11.0@sha256:72c0ba641ba75e7aa52655cb242570906ececd09b1140fb736483038a22b3228`
- Toxiproxy: `ghcr.io/shopify/toxiproxy:2.12.0@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e`
- PostgreSQL: `postgres:18-alpine@sha256:9a8d3f40b43c47f8ea5822e34014e55d4f62bfb1612f028322768520b97f35d5`
- Redis: `redis:8-alpine@sha256:978a61231148674bbcf9ed7be38dd46c3f4aeab5054d81760bb5e4781fc4a50d`
- Node fixture: `node:22-alpine@sha256:c6103993e75f3e11725fd7dac53644579e5b0518c01718c6a3801b974d39255`

The external compatibility contract was checked against the official
[Open WebUI v0.11.0 release](https://github.com/open-webui/open-webui/releases/tag/v0.11.0),
[Knowledge router](https://github.com/open-webui/open-webui/blob/v0.11.0/backend/open_webui/routers/knowledge.py),
[retrieval router](https://github.com/open-webui/open-webui/blob/v0.11.0/backend/open_webui/routers/retrieval.py),
and the official
[Toxiproxy v2.12.0 release](https://github.com/Shopify/toxiproxy/releases/tag/v2.12.0).

## Residual risks and follow-up

1. The feed snapshot is based on application timestamps and a database clock
   upper bound. A very long transaction that writes an old application
   timestamp but commits only after the terminal checkpoint remains a
   theoretical gap. The embedded worker's overlap window mitigates this, but a
   transaction-commit sequence or append-only change ledger would eliminate it.
2. The public feed scope fingerprint binds the stable principal identity and
   exclusion-policy fingerprint rather than the changing page set. A policy or
   principal-role change intentionally invalidates the cursor and requires a
   snapshot restart; ordinary concurrent content changes do not.
3. Live container-kill, Redis-restart, and lease-deletion tests are represented
   by deterministic state/abort tests rather than three independent destructive
   PR scenarios. They should be added to a slower nightly chaos job if the
   runtime becomes operationally critical.
4. Real Open WebUI startup may download an embedding model on first use. The
   weekly job therefore remains separate from the deterministic PR fixture.
