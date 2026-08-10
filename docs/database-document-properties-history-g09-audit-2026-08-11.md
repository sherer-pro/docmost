# G09 database, document properties, and history audit

Date: 2026-08-11

Scope owner: G09

Repository: `sherer-pro/docmost`

## 1. Verdict

**PASS WITH RISKS.** The reproducible G09 security and runtime defects found in this audit were fixed, regression-tested, browser-verified, rebuilt into the production image, and merged into local `main`. No fixed G09 defect blocks release at the audited `main` merge point.

The remaining material risk is the non-atomic boundary between a committed database-cell write and Redis-backed page-history enqueue (`G09-R01`). A storage write can succeed while history recording fails. A safe correction needs the shared transactional/idempotent history-outbox design and therefore was not implemented as a local G09 workaround. The current public database property contract also does not provide number, date/timezone, link, or multi-select property types; those requested cases are recorded as unsupported scope rather than reported as tested.

## 2. Fixed scope and revision history

| Item | Revision |
| --- | --- |
| Release tag | `v1.0.0` -> `446f6ddd68d87b28d6d1e2add90c235495149970` |
| Frozen audit head | `e955a0c8d13be6384a08988f40b4331b9b686ce8` |
| Working `main` at audit start | `f165e03ad870459faf23fdd1660c32719ddc8007` (`v1.0.0-193-gf165e03a`) |
| G09 integration merge | `b2b0f14fcf2795cd0e59907052050a4873199dcf` (`v1.0.0-223-gb2b0f14f`) |
| G09 branch | `codex/g09-databases-history` |
| Isolated worktree | `D:\DevProjects\docmost-qa-G09` |

The required commits were inspected with `git show --stat --summary`, full diffs, tests, and associated documentation:

- `e3d1dddf` - compiled-runtime PostgreSQL loading fix;
- `622c86da` - database end-to-end remediation;
- `a87834aa` - prior QA remediation record.

Post-audit changes touching the scoped or adjacent paths were also inspected before findings were opened. The most relevant were `57411955` (migrate before Nest module bootstrap) and `d12a7596` (migration execution without the runtime camel-case plugin). The complete reviewed post-audit path history also included `b52938c9`, `b4629ad9`, `35bbae08`, `35cdcde6`, `7468790e`, `5b677777`, `12d3c14f`, `6dfdea64`, `583eb96f`, and `4d9824ef`. No prior fix was reopened or reverted.

The audited implementation included:

- `apps/server/src/core/database/**`;
- `apps/client/src/features/database/**`;
- `apps/server/src/core/page/services/page-history*` and the page-history recorder;
- `apps/server/src/database/repos/page/page-history.repo.ts`;
- `apps/client/src/features/page-history/**`;
- document-field, assignee, stakeholder, watcher, AI-role, and reading-time paths;
- database, document-field, watcher, and page-history migrations;
- compiled migration/runtime loading;
- attachment duplication and export only as integration smoke checks.

## 3. Implementation map

### 3.1 Database request and persistence path

1. `database-table-view.tsx`, the cell renderers/editors, filter editor, saved-view controls, header actions, and page conversion actions initiate UI state and mutations.
2. TanStack Query wrappers in `queries/database-query.ts` and `queries/database-table-query.ts` call `database-service.ts`.
3. `database.controller.ts` parses the shared DTO contract and supplies the authenticated user to `DatabaseService`.
4. `database.service.ts` resolves the database root page, row page, effective page access, property ownership, view configuration, conversion, copy, and history events.
5. Kysely repositories persist `databases`, `database_views`, `database_properties`, `database_rows`, and `database_cells` in PostgreSQL. Database rows are ordinary pages linked through `database_rows`.
6. Page changes are handed to `PageHistoryRecorderService`; collaboration history is processed through the Redis-backed history path. Attachment duplication uses the existing page-copy/outbox and local-storage integration rather than aliasing source attachment records.

### 3.2 Document properties and history

- Space settings control visible document fields. Page custom fields carry status, assignee, stakeholder IDs, and AI role; reading time is computed by the client from document content.
- User-valued fields are restricted to space members and read visibility is filtered through page access.
- Watchers use `WatcherService`/`WatcherRepo`; the `20260805T120000-watcher-access-cleanup` migration removes watchers without current space membership, while notification delivery separately rechecks page read access.
- Meaningful page and database-cell changes create page-history change events. `PageHistoryService` now resolves referenced page labels for the requesting viewer instead of trusting persisted labels.
- History deletion remains owner/admin gated. The history list uses cursor pagination; restore/view paths use page authorization.

### 3.3 Migrations and runtime

The central schema migrations reviewed were:

- `20240324T086400-page_history.ts`;
- `20260209T120000-add-contributor_ids-to-page-history.ts`;
- `20260213T085320-watchers.ts` and `20260213T085337-backfill-watchers.ts`;
- `20260214T100000-page-and-space-document-fields-settings.ts`;
- `20260301T120000-databases.ts`;
- `20260301T133000-database-page-node.ts`;
- `20260302T090000-database-rich-description.ts`;
- `20260302T120000-database-property-text-compat.ts`;
- `20260308T150000-page-history-change-events.ts`;
- `20260329T120000-page-access-rules.ts`;
- `20260805T120000-watcher-access-cleanup.ts`;
- `20260805T130000-queue-outbox.ts`.

Production bootstrap dynamically loads the PostgreSQL driver before application module bootstrap, acquires the migration advisory lock, applies migrations without the runtime camel-case plugin, releases the lock, and then starts Nest. Both an empty database and the existing upgraded database were exercised.

### 3.4 Flags, limits, cache, jobs, logs, and recovery

- No database-specific feature flag gates this feature. `PAGE_TEMPLATES_ENABLED` and the AI/RAG flags are adjacent only.
- The list API pages at 100 rows in the exercised UI path. Saved view state is stored in PostgreSQL; the selected view is also retained locally per database/user browser storage key.
- At 100 or more loaded rows, the table uses a bounded 620 px desktop / 520 px mobile viewport and row virtualization.
- TanStack Query is the UI cache. Permission changes were independently checked against the API immediately after revoke/grant; no server-side database result cache was found.
- Page-history recording is asynchronous through Redis. The identified write/history partial-failure boundary is listed as `G09-R01`.
- Attachment copy work uses the shared durable queue-outbox recovery path. Export is a read-only integration consumer and was smoke-checked only.
- Runtime logs expose migration lifecycle and structured component/error class information. No credential or synthetic canary value appeared in the scanned browser artifacts.
- Recovery paths exercised: reload/refetch after optimistic state, permission revoke/grant, Redis-backed service restart through container recreation, upgraded DB bootstrap, and empty DB migration bootstrap.

## 4. Environment and external tools

No source code or test data was sent to a remote SaaS. The external AI/RAG provider was not needed for G09.

| Tool | Provenance and exact version | Use and isolation |
| --- | --- | --- |
| Git worktree | repository-native Git | G09 changes isolated in `D:\DevProjects\docmost-qa-G09`; user-owned `graphify-out/*` changes were preserved |
| Node.js / pnpm | host Node `v24.16.0`; repository-pinned pnpm `10.4.0` | build and test orchestration; production target remains Node 22 |
| Docker Desktop | Docker `29.5.3` | local-only Compose runtime |
| Application image | `docmost-local:dev`, digest `sha256:8ccf5d0f07ba2c49d14760d89afc3abc882e68ea5f9ca9913a7974de041c7801` | built from `main@b2b0f14f`; bound to `127.0.0.1:3000` |
| Node base | official `node:22-slim`, local resolved digest `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3` | production build base resolved locally at build time |
| PostgreSQL | official `postgres:18-alpine`, image ID `sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | existing upgraded DB and temporary empty DB; no published DB port |
| Redis | official `redis:8-alpine`, image ID `sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | existing runtime and isolated empty-DB bootstrap; no published Redis port |
| Playwright | repository-pinned `1.62.1` | repository e2e suites; temporary local TCP forwarders exposed Compose DB/Redis only to loopback and were removed |
| Codex in-app browser | bundled browser control `26.803.41515` | signed-in local browser audit, screenshots, network/DOM/console inspection; no remote browser service |
| Graphify | local `0.9.33` | scoped code graph query; generated graph files were not staged |

The temporary empty-DB app, PostgreSQL, Redis, network, and e2e TCP-forwarder containers were removed after verification. Secrets were loaded from the supplied environment file and were not printed, copied into the report, or passed on command lines.

## 5. Coverage matrix

| Requirement | Static/unit/integration/browser/fault/security evidence | Result |
| --- | --- | --- |
| Create database; convert page to database and back | API and UI creation; browser confirmation dialogs; root/page-tree assertions; reload | PASS |
| Property types and boundary values | Contract, DTO, value normalizer, six supported types; null/empty/invalid, Unicode, long and multiline text, user, select, checkbox, page reference | PASS for supported types; number/date/timezone/link/multi-select are not implemented contracts |
| Property/row CRUD, reorder, inline/keyboard edit | service and helper tests; browser inline edit, multiline paste, reorder/CRUD; optimistic/refetch behavior | PASS |
| Concurrent edits and rollback/reload | two authenticated role sessions, concurrent PATCH, single-cell DB assertion, reload; complete last accepted value retained | PASS WITH RISK `G09-R01` |
| Multiple saved views, filters, sort, columns/order, persistence | unit helpers, API contract, owner and reader browser/API sessions, reload and cross-user list | PASS |
| Document status, assignee, stakeholders, AI role, reading time, visibility | browser update as owner, reader bypass rejection, space-field settings and localized rendering | PASS |
| History meaningful changes, pagination, view/restore, deletion | 24-event fixture, two 10-item cursor pages without overlap, role-gated delete, row history, reference redaction | PASS; malformed cursor dependency remains |
| Copy/duplicate database/row/page with attachments | copy utilities and backend tests; SQL compared source/copy attachment IDs and paths in existing fixture | PASS for aliasing and deterministic records; a new UI copy was not made because the retained fixture was read-only to the audit role |
| ACL matrix and direct row URLs | root close/grant, row close/grant, direct API/URL, reader/writer/owner, foreign-property injection, immediate invalidation | PASS |
| Search/RAG/export integration smoke | scoped read filtering and database markdown/export tests; no full G15 export audit | PASS (smoke only) |
| Compiled PostgreSQL and migrations | production build; existing upgraded DB; isolated empty DB ran 101 migrations; health and table assertions | PASS |
| 1,000-row stress, pagination, rendering | API seeder, 10 x 100 fetches, 1,000 unique IDs, browser DOM count 29, bounded virtual viewport | PASS; no long-duration heap profile |
| Former documented e2e regressions | required history/diffs reviewed; repository server e2e 4 suites / 17 tests; independent ACL, conversion, view, history, paste, and stress reproduction | PASS |
| Negative and canary checks | invalid property, CSRF host/origin mismatch, unauthorized update/delete, stale page reference, artifact secret scan | PASS |
| Restart and partial failure | production container rebuild/recreate, empty/upgraded DB bootstrap; forced history enqueue failure | PASS for restart; history partial failure remains `G09-R01` |

## 6. Executed commands and outcomes

The table records the relevant commands; no failed result was hidden.

| Command/check | Exit/result |
| --- | --- |
| `git status --short`, `git rev-parse HEAD`, `git describe --tags --always` before work | `0`; only pre-existing `graphify-out/*` changes in the main tree |
| required and path-scoped `git log`, `git show --stat --summary`, and `git show` diffs | `0` |
| `corepack pnpm install --frozen-lockfile` | `0` |
| initial server database suite | `0`; 10 suites / 96 tests |
| initial targeted client database suite | `0`; 11 files / 40 tests |
| targeted red server ACL/history tests before fixes | expected red: 4 failures / 52 passes plus an independently reproduced history canary leak |
| targeted server database/page-history tests after fixes | `0`; 4 suites / 71 tests |
| targeted client database/page-history tests after fixes | `0`; 14 files / 58 tests |
| `corepack pnpm test:security` | `0`; server 66 suites / 789 tests and client 6 files / 74 tests (863 total) |
| `corepack pnpm --filter ./apps/server test:e2e` without integration env | non-zero baseline setup failure: required PostgreSQL/Redis endpoints not available to the host process |
| same server e2e with loopback-only local DB/Redis forwarders | `0`; 4 suites / 17 tests; Jest reported the existing forced-worker-exit warning |
| `corepack pnpm run build` | `0`; existing client chunk-size warning over 1,500 kB |
| `corepack pnpm verify:full` | `1`; unrelated AI DOCX extraction test exceeded its 5 s timeout under the parallel full suite; 1 failure / 1,738 passes, 220 passing suites |
| `corepack pnpm --filter ./apps/server test -- --runInBand src/core/ai/services/ai-file.service.spec.ts` | `0`; 2/2, 14.119 s process time, affected assertion completed in 133 ms |
| temporary forced history-enqueue failure test | `0` as a targeted proof: cell upsert completed before recorder rejection; test-only change reverted |
| `docker compose build docmost` on G09 fix head | `0` |
| empty-DB production bootstrap and `/api/health` | `0` / HTTP 200; 101 migrations; required tables present |
| `docker compose build docmost` on merged `main@b2b0f14f` | `0`; final image digest recorded above |
| `docker compose up -d docmost` and final `/api/health` | `0` / HTTP 200; DB and Redis up; log states `No pending database migrations` |
| final post-merge server and client targeted suites | `0`; 71 server and 58 client tests |
| `node apps/client/e2e/ai/sanitize-traces.mjs output/g09-databases-history-20260810` | `0`; no trace archives required rewriting |
| `node apps/client/e2e/ai/scan-artifacts.mjs output/g09-databases-history-20260810` | `0`; `secretCount: 0` |
| `git diff --check` | `0` |

An early accidental full client run exposed an unrelated locale expectation (`de-DE` missing `Inactive`). It was not attributed to G09 and the correct targeted suites passed. The `verify:full` AI DOCX timeout likewise passed immediately when isolated and remains a separate flaky/full-suite baseline observation.

## 7. Findings

| ID | Severity | Component | Reproduction and actual behavior | Expected behavior / root cause | Status |
| --- | --- | --- | --- | --- | --- |
| G09-01 | High | Database ACL | Closing the database root did not consistently gate nested metadata, property, row, cell, and view operations | Every nested operation must authorize the root and, where applicable, the row. Service methods lacked a uniform root-page access boundary | Fixed in `e86e92cc` |
| G09-02 | High | Cell integrity | A property ID owned by another database could be supplied in a cell batch request | Property IDs must belong to the target row's database. Ownership was not validated before upsert | Fixed in `e86e92cc` |
| G09-03 | High | Row history isolation | Detailed row-cell events were also written to root history, exposing row detail and amplifying event volume | Detailed changes belong to the row; root history needs only a sanitized summary | Fixed in `e86e92cc` |
| G09-04 | Medium | Saved views UI | The backend supported saved table views, but the production table did not expose complete view CRUD/filter/sort/column controls | UI implementation stopped short of the persisted view contract | Fixed in `7b1831cc` |
| G09-05 | Medium | Inline paste | Multiline/code text could be interpreted as a matrix paste and split across cells/rows | A single active multiline/code editor must retain newline content | Fixed in `f2f1f01d` |
| G09-06 | Medium | Saved view state | Empty or stale filters could persist and produce inconsistent view behavior after schema changes | Saved view configuration requires normalization against current properties | Fixed in `6cb9d8ab` |
| G09-07 | Medium | Large-table rendering | Loading 1,000 rows allowed an effectively unbounded table viewport, defeating useful virtualization | Large tables need a bounded scroll viewport before row virtualization can control DOM size | Fixed in `2aa6e519` |
| G09-08 | High | History confidentiality | A reader denied access to a referenced page could recover its title from persisted history change metadata | Page labels are authorization-sensitive. Persist only the ID and resolve/redact for the current viewer; legacy payloads also require redaction | Fixed in `08981bcd` |
| G09-R01 | Medium | Write/history consistency | Synthetic recorder failure showed `upsertCell` completed and then the request rejected when Redis-backed history enqueue failed | Data and audit history need an atomic or idempotent durable boundary. A local retry/fallback risks duplicate or missing history | Not fixed; shared history/outbox owner dependency |
| G09-DEP-01 | Low | Common history pagination | `cursor=undefined` returns HTTP 500; a valid cursor paginates correctly | Malformed cursors should return a typed 4xx validation response | Not fixed; common pagination owner dependency |

### 7.1 Fixed finding evidence and impact

**G09-01 / G09-02 / G09-03.** Independent owner, writer, and reader requests covered root denial, row denial, direct row access, immediate grant/revoke, and a foreign property ID. Before the fix, the targeted tests reproduced missing guards and cross-database property acceptance. After the fix, closed roots and rows returned 403, list endpoints omitted unreadable rows, foreign properties returned 400 without a persisted cell, and detailed row changes appeared only in row history. Impact before correction included unauthorized database structure/data access, integrity corruption across databases, and history disclosure.

**G09-04 / G09-06.** The browser created a Unicode-named view, applied a contains filter, descending sort, and hidden column, then reloaded and rechecked through a second role. Persisted API configuration matched the UI. A reader could list/use the view but received 403 for view creation. Stale/empty filters were removed by normalization. One early post-reload snapshot briefly displayed cached prior rows; the settled refetch correctly applied the saved view, so it was not reported as a defect.

**G09-05.** Pasting two Unicode lines into a code cell previously entered the matrix-paste path. The fixed browser run retained both lines in one cell, did not alter the adjacent row, and survived reload.

**G09-07.** The 1,000-row fixture loaded in ten 100-row pages with 1,000 unique IDs. After the fix the browser retained only 29 data-row DOM nodes, displayed a bounded scrollbar, and did not render the last row while positioned at the first row. This is direct virtualization evidence, not a claim of a long-duration memory-leak test.

**G09-08.** A synthetic page-reference canary appeared in a denied reader's history response before the fix. After the fix, the same reader response omitted both title and label while the owner still saw the authorized reference. Newly buffered history contained only the page ID. Stored legacy events were redacted at read time. Artifact scanning found no canary/secret leakage.

### 7.2 Unresolved finding details

**G09-R01 reproduction.** A temporary test replaced `PageHistoryRecorderService.enqueuePageEvents` with a rejecting implementation. `DatabaseService` persisted the cell upsert first, then propagated the history failure. The temporary fixture was reverted and is not in a production commit. The safest remediation is a PostgreSQL outbox row created in the same transaction as the cell mutation, with an idempotency key and a Redis worker that owns retry/dead-letter observability. Acceptance requires fault injection before/after commit, duplicate delivery, worker restart, lease loss, and deterministic one-event history. Rollback would disable the new dispatcher while retaining outbox rows; it must not silently fall back to lossy in-process history.

**G09-DEP-01 reproduction.** A valid cursor returned the next history page without overlap. The literal malformed value `undefined` reached common cursor parsing and returned 500. This is not specific to database history and was left to the common pagination owner to avoid a one-route contract divergence.

## 8. Verified scenarios without a defect

- Database creation from scratch, title/description editing, empty state, page-to-database conversion, and conversion back.
- Supported property types: multiline text, checkbox, code, select, user, and page reference; null/empty/invalid, Unicode, long text, and newline behavior.
- Property and row create/edit/delete/reorder, inline editing, keyboard-driven paste, reload, and complete-value last-accepted concurrency behavior.
- Multiple saved views, current selection, combined filter/sort/visible-column configuration, persistence, reader use, and write denial.
- Status, assignee, stakeholder, AI role, and reading-time presentation plus unauthorized mutation denial.
- Meaningful history events, row history, cursor pagination, owner deletion, reader deletion denial, and authorized/unauthorized page-reference labels.
- Database root and row ACL matrix, direct row access, immediate permission invalidation, and foreign-property rejection.
- Existing attachment-copy fixture: source and copies shared neither attachment IDs nor file paths; targeted duplication tests passed.
- Production compiled PostgreSQL loading on an empty database and the upgraded database.
- 1,000-row pagination and virtualized browser rendering.
- CSRF host/origin rejection, console/unhandled rejection checks, and artifact secret scanning.

Browser console capture contained 22 entries with zero errors, unhandled rejections, or rejection events in the final scenarios.

## 9. Limitations and unverified scenarios

- Number, date/timezone, link, and multi-select database properties are absent from the current shared contract and schema. They were not emulated or claimed as passing.
- Two authenticated roles were exercised through independent sessions, including concurrent API operations. Only the owner used a fully visual in-app browser context; two simultaneous visual browser contexts were not available in the bundled controller.
- The live browser viewport was fixed. The mobile viewport height helper has unit coverage, but a real mobile database layout/accessibility pass was not completed.
- The 1,000-row browser audit proved bounded DOM/rendering and pagination. It did not include a multi-hour heap profile or CPU flame graph, so no broad memory-leak PASS is claimed.
- A fresh UI duplicate was unavailable because the retained attachment fixture was read-only to the audit identity. Existing-copy SQL assertions and targeted duplication tests verified non-aliasing; G15 owns exhaustive export/copy integration.
- History restore/view behavior was exercised on available history types, but destructive restoration of the retained large shared fixture was intentionally avoided.
- RAG/search/export received only ACL/integration smoke coverage; their complete audits belong to their owning contours.
- The full verification gate retains an unrelated, non-deterministic AI DOCX timeout observation even though its isolated rerun passed.
- Runtime startup logged adjacent RAG Sync writer binding retries. They are outside G09 and did not affect database health, PostgreSQL, or Redis.

## 10. Remediation report

| Fix | Production changes | Tests and re-verification | Rollout / rollback / observability |
| --- | --- | --- | --- |
| `e86e92cc` | Uniform database-root and row ACL assertions, filtered space listing, property ownership validation, scoped row/root history | red-to-green service tests; ACL/direct URL/foreign-property browser/API matrix; security suite | normal server deployment; rollback commit only if necessary; observe 400/403 rates and history event volume |
| `7b1831cc` | Saved table view selector and CRUD/filter/sort/column controls with query invalidation and per-browser current view | client helpers/services plus owner/reader persistence and reload browser checks | client rollout; rollback UI commit leaves backend data intact; observe view mutation errors |
| `f2f1f01d` | Single-cell multiline/code paste routing | helper tests and Unicode two-line browser paste/reload | client-only rollback; no schema/data migration |
| `6cb9d8ab` | Saved view normalization drops empty and stale property filters | client helper tests and persisted/reloaded filtered view | client-only rollback; existing stored view JSON remains compatible |
| `2aa6e519` | Bounded responsive ScrollArea activates row virtualization at large row counts | helper tests and 1,000-row DOM/network assertions | CSS/client rollback; monitor browser responsiveness and API page latency |
| `08981bcd` | Persist page-reference IDs, authorize label resolution per viewer, redact legacy unauthorized metadata, pass viewer into history service | red canary test, 6 page-history tests, reader/owner API and browser verification, secret scan | server rollout; no destructive migration; rollback would reopen legacy disclosure and is not recommended; observe history resolution failures without logging labels |

All server/client changes were rebuilt before their browser retest. After the last correction the targeted suites, security suite, e2e suite, production build, upgraded/empty database bootstrap, and final merged-main container health were rerun as described above.

## 11. Evidence and commits

Evidence root:

`D:\DevProjects\docmost-qa-G09\output\g09-databases-history-20260810`

Key evidence:

- `browser/02-database-desktop-baseline.png` - created database and supported typed columns;
- `browser/03-multiline-paste-fixed.png` - multiline Unicode retained in one cell;
- `browser/05-stress-1000-virtualized-fixed.png` - bounded virtualized 1,000-row view;
- `browser/06-saved-view-filter-sort-columns.png` - saved view filter/sort/column state;
- `browser/07-row-history-owner.png` - authorized owner history presentation;
- `trace-sanitization.json` - sanitization result;
- `secret-scan.json` - artifact scan, zero secret matches.

G09 production commits:

1. `e86e92cc` - `fix(database): enforce row data boundaries`
2. `7b1831cc` - `feat(database): expose saved table views`
3. `f2f1f01d` - `fix(database): preserve multiline cell paste`
4. `6cb9d8ab` - `fix(database): normalize saved view state`
5. `2aa6e519` - `fix(database): bound virtualized table viewport`
6. `08981bcd` - `fix(history): redact restricted page references`
7. `b2b0f14f` - `merge: integrate G09 database audit fixes`

Test-only work: the forced history-enqueue failure proof was reverted after it established `G09-R01`. No temporary seeder, fixture, debug bypass, or TCP forwarder remains in the tracked tree or running containers. Generated `graphify-out/*` changes are user-owned/unrelated and were not staged.
