# G18: Realtime collaboration, Yjs persistence and presence audit

Date: 2026-08-09

Fixed history slice: `v1.0.0^..e955a0c8`

Release tag: `v1.0.0` (`446f6ddd68d87b28d6d1e2add90c235495149970`)

Audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`

Working base: `a1f9d8188ebf54cac7bd93b868efca58f02b7918` (`v1.0.0-124-ga1f9d818`)

Audit branch: `codex/g18-collaboration`

## 1. Verdict

**PASS WITH RISKS** for G18 after the fixes listed below.

No remaining release blocker was reproduced in the generic realtime collaboration infrastructure. Three production defects were reproduced and fixed:

1. an unauthenticated collaboration WebSocket could use the `ws` 100 MiB default frame limit;
2. an asynchronous Redis forwarding failure left the proxied client open and created an unhandled rejection boundary;
3. lease loss could leave a dirty document loaded because the persistence unload guard vetoed the unload, allowing stale retries after ownership moved.

The final two-instance fault harness passed all 10 checks, the final multi-role browser presence harness passed all 6 checks, the focused Chromium and Firefox collaboration/offline browser matrix passed, and the security suite passed. The residual risks are:

- the real four-hour collaboration-token expiry was not awaited wall-clock; refresh was checked statically and session revocation was checked at runtime;
- an exact PostgreSQL kill between the final statement and transaction commit was not injected; the transaction and post-commit boundaries were covered by unit tests, while a real DB hard-stop plus lease loss was covered at runtime;
- the full editor matrix contains seven failures owned by Draw.io/editor/synced-block contours, although the G18 collaboration case passed in both desktop browsers;
- Axe found pre-existing editor/public-share ARIA defects outside the realtime-infrastructure ownership boundary;
- a full `verify:full` run is red on one unrelated AI localization count assertion (30 expected, 31 present).

These limitations prevent an unqualified repository-wide PASS, but none invalidates the final G18 behavior proven below.

## 2. Scope, history and implementation map

### 2.1 History reviewed

The audit inspected commit metadata, stats and diffs rather than relying on commit messages:

- `3f7682ae` — failure-safe Yjs persistence, transactional page/Yjs/text/transclusion updates, dirty retries, unload veto and isolated post-commit side effects;
- `b081e472` — random-token document leases, owner-checked Lua renew/release, sequential renewals and close-on-loss behavior;
- `ac7146d8` — Socket.IO relay room and nested-operation isolation;
- `01c805c2` — client active-user/presence surfaces;
- `2652053d` — editor and collaboration-provider lifecycle;
- `60ff6a43` — active-session binding and revocation;
- `74e91554` — Redis collaboration affinity and proxying;
- `c54d9abb` in `e955a0c8..working base` — shutdown of Redis clients and proxy sockets.

The only collaboration-specific post-audit-head production change was `c54d9abb`. Its shutdown behavior was retained. The test-only Redis E2E fix in this audit gives each server its own source Redis client so the test models the production topology after that change.

### 2.2 Files and contracts reviewed

- server: `apps/server/src/collaboration/**`, `apps/server/src/ws/**`, `apps/server/src/core/presence/**`, collaboration token/session/authentication code under `apps/server/src/core/auth` and `apps/server/src/core/session`;
- client: the Hocuspocus/Yjs provider and editor lifecycle under `apps/client/src/features/editor`, presence hooks/components under `apps/client/src/features/presence`, Socket.IO hooks and `apps/client/src/lib/config.ts`;
- shared behavior: Yjs/Tiptap helpers and relevant `packages/editor-ext` integrations;
- persistence: `pages`, `page_history`, `user_sessions`, page repositories and transaction helpers;
- configuration/docs: `Dockerfile`, `docker-compose.yml`, `.env.example`, `ARCHITECTURE.md`, `README.md`, generated routes and relevant audit/runbook material;
- tests: collaboration, Redis sync, persistence, authentication, Socket.IO, session, presence, server E2E and editor Playwright specs.

No public API contract or migration was changed by G18.

### 2.3 End-to-end implementation map

| Layer | Current implementation and boundary |
| --- | --- |
| UI/editor | Each page uses a Yjs document named `page.<pageId>`. `IndexeddbPersistence` restores local updates. `HocuspocusProvider` obtains a page-scoped token, reconnects after auth refresh and disconnects long-hidden tabs. Duplicate tabs use independent awareness clients and converge through the same document. |
| Token API | `GET /api/auth/collab-token?pageId=...` issues a four-hour collaboration token bound to the active `sessionId`; the client query is stale for three hours. The Hocuspocus authentication extension revalidates token type, active session, page/workspace access, SSO and MFA state. |
| Collaboration WebSocket | The dedicated `CollabWsAdapter` upgrades only the configured `/collab` path. After G18 it rejects payloads above 16 MiB at the `ws` parser. Hocuspocus handles authorization and Yjs sync. |
| Redis affinity | `RedisSyncExtension` uses `collabLock:<document>`, a random `collab-<hostname>-<nanoid>` owner, a 10 s TTL and owner-checked Lua renew/release every 5 s. Pub/sub proxies sockets and custom events between instances. Lease renewal is sequential. |
| Persistence | `PersistenceExtension` serializes Yjs into Tiptap JSON/text/state and updates the page row inside one Kysely transaction. Retryable DB errors mark a document dirty and schedule 1/2/5/10/30 s retries; unload is normally vetoed while dirty. G18 adds a lease-loss-only discard boundary so a server that no longer owns the lease cannot retain/retry stale dirty state. |
| History/side effects | Page history, notifications, events and link indexing execute only after the authoritative transaction. Their failures are isolated from the committed document state. BullMQ/Redis is used for asynchronous side effects. |
| Socket.IO relay | Each relay/presence operation revalidates the session. Clients may join their own user room, workspace room and authorized space rooms. Only `broadcast` envelopes and allowlisted nested operations are accepted; mismatched room/workspace/space identifiers are rejected. |
| Presence | Redis records each connection for 45 s and each user connection set for 90 s. The client heartbeat is 15 s. Results are grouped by user and `sessionId`, with page/space/workspace location, idle/clear and disconnect cleanup. |
| Recovery | Client IndexedDB replays offline updates. Persistence retries DB failures. Redis lease loss closes clients, discards dirty local state and unloads the local document. Another server takes over only after owner release or TTL expiry. Redis/DB/server restart is fail-closed and clients reconnect. |

### 2.4 Flags, limits, cache and observability

- core collaboration has no product feature flag;
- `COLLAB_DISABLE_REDIS=false` enables multi-instance affinity; `COLLAB_SHOW_STATS` controls Hocuspocus statistics;
- `COLLAB_URL` and `COLLAB_PORT` select the separate collaboration service at current HEAD;
- Hocuspocus persistence debounce: 10 s with a 45 s maximum debounce;
- lease: 10 s TTL, 5 s renewal; custom-event response TTL: 30 s;
- collaboration token: 4 h; client token cache: 3 h;
- WebSocket payload limit after G18: 16 MiB;
- presence: 15 s heartbeat, 45 s connection TTL, 90 s user-set TTL;
- history aggregation/buffer limits remain in `apps/server/src/collaboration/constants.ts`;
- relevant logs are generic and contain page IDs/reasons, not credentials or Yjs payloads; health checks expose only dependency status.

## 3. Environment and external tools

All runtime data was synthetic and remained in a dedicated local Compose project. No repository source or test data was sent to SaaS.

| Tool/runtime | Provenance and exact version/digest | Use and isolation |
| --- | --- | --- |
| Branch image | `docmost-g18:e68110f3`, image ID `sha256:e2cf7d5d2ca26aeed2d707ee1ea94330f2b8c391bdea99dd0ef7de55090bfdd5` | Built from production commit `e68110f3`; later branch commits before the report were test-only. API on `127.0.0.1:3180`, collaboration on `127.0.0.1:3181`. |
| Node base | official `node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436` | Pinned by the repository Dockerfile. |
| PostgreSQL | official `postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | Dedicated `docmost-g18` volume and host loopback port 3182. |
| Redis | official `redis:8-alpine@sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | Dedicated `docmost-g18` volume and host loopback port 3183. |
| Playwright | Microsoft Playwright `1.62.1`, browsers installed by the repository | Chromium/Firefox/WebKit and multi-context browser checks, entirely local. |
| Docker Desktop | Docker Engine `29.5.3` | Process/container restart, DB/Redis hard-stop and recovery. |
| Host toolchain | Node `v24.16.0`, pnpm `10.4.0` | Repository tests and synthetic harnesses. Production remained Node 22. |
| Graphify | locally installed repository-analysis skill | Static relationship query only; generated files were restored and not committed. |

Toxiproxy and a third-party WebSocket CLI were not installed: native Docker stop/restart plus direct `ws` and Playwright clients covered the required fault and protocol paths without adding another trust boundary.

The production-like image was rebuilt after all three production fixes. It was not rebuilt after test-only commits because they do not change the image. Temporary harness sources were deleted after the final rerun. The isolated Compose project is removed after report finalization; its test volumes are intentionally disposable.

## 4. Coverage matrix

| Requirement/scenario | Checks | Result and evidence |
| --- | --- | --- |
| Two/three browsers edit text, formatting and tables | Focused Playwright uses two authenticated contexts; runtime harness uses two instances and duplicate tab; assertions inspect text, bold marks, table structure and Yjs hash | **PASS** Chromium and Firefox. `editor-e2e/playwright-results.json`, screenshots `06-*`; `runtime-results.json` check 2. |
| Offline/IndexedDB, disconnect, duplicate tab, abrupt close | Browser offline interruption plus reload; runtime offline replay and duplicate-tab abrupt close | **PASS**. `editor-e2e/screenshots/*-08-offline-interruption.png`; runtime checks 4-5. Real 4 h expiry is a limitation. |
| Two collaboration servers and single-writer lease | Separate `docmost` and `collab` processes against one Redis; Redis owner key observed; release/takeover asserted | **PASS**. Runtime checks 2, 3 and 10; real Redis E2E 4 suites/16 tests. |
| Redis renewal/pubsub failure and partition | Owner key replaced, Redis restarted, clients observed closing/reconnecting; dirty state discarded before unload | **PASS** for renewal/pubsub outage and takeover. Unit tests assert ordering; runtime checks 8 and 10. |
| DB persistence failure before/after transaction | Unit transaction/failure-boundary assertions plus real DB hard-stop after dirty edit, forced lease loss, DB recovery and authoritative replay | **PASS WITH LIMITATION**. No exact instruction-level kill immediately around COMMIT. Runtime checks 7-8. |
| Session revoke/logout with open socket | Current writer session revoked while socket remains open; a post-revoke token call is 401 and update is rejected | **PASS**. Runtime check 9. |
| WebSocket authorization and malformed input | Unit/security tests cover foreign workspace/space/user room, mismatched IDs, malformed/nested operations and spoofed presence. Direct 17 MiB frame closes with 1009 | **PASS**. 66 security suites / 773 server tests; wire close code 1009. |
| Presence across devices and Redis restart | One writer in two sessions/three tabs plus owner; page switch, Redis restart, one-device close and all-device close | **PASS** 6/6. `browser-presence-results.json`, `10-presence-multi-session.png`, `11-presence-cleared.png`. Expected 401-before-login and restart WebSocket warnings only. |
| Large document/update rate/backpressure | 2 MiB text plus 1000 updates, convergence and restart | **PASS** without duplicate state/history observed. API memory 497.8 MiB; collab memory 438.6 MiB after load. No long soak. |
| Template/transclusion/agent smoke | Full editor matrix ran templates/transclusion; existing AI/Yjs operation unit tests ran in the 214-suite server run | **PARTIAL**. Template lifecycle passed; synced-block full-matrix tests failed on a neighboring live-update assertion and are not claimed as G18 PASS. |
| Reload/restart determinism | collaboration process restart followed by fresh provider state/hash comparison | **PASS**. Runtime check 7. |
| Accessibility and console | Axe in Chromium/Firefox; console/network capture; screenshots inspected | **PASS for G18 mechanics; dependency findings remain**. Offline page has zero Axe violations; editor/share ARIA issues are recorded below. |

## 5. Commands and exit codes

The table records all material execution commands. Repeated read-only `rg`, `git show`, `git diff`, `docker inspect/logs/stats` and JSON inspection commands exited 0 unless noted.

| Command/check | Exit | Notes |
| --- | ---: | --- |
| `git status --short`, `git rev-parse HEAD`, `git describe --tags --always` | 0 | Initial main status preserved user-owned `graphify-out/*`; working base recorded above. |
| `git worktree add -b codex/g18-collaboration ../docmost-qa-G18 main` | 0 | Clean isolated worktree. |
| `git log` / `git show --stat --summary` / diff reads for fixed and post-audit ranges | 0 | Commits in section 2 reviewed. |
| Graphify index/query commands | 0 | Static map only; generated changes restored. |
| Initial user-shaped server Jest filter | 0 | 51 tests; corrected because pnpm passed the extra `--` differently than intended. |
| `corepack pnpm --filter ./apps/server exec jest --config jest.config.cjs --runInBand collaboration ws redis-sync presence` | 0 | Final focused result: 11 suites, 55 tests. |
| Targeted red tests for G18-01/02/03 | 1 | Expected red phase: no payload cap, no rejection catch/close, no lease-loss dirty discard. Test harness mock/timer corrections were also made before accepting red evidence. |
| `corepack pnpm --filter ./apps/server build` | 0 | Production server build. |
| `corepack pnpm --filter ./apps/server lint` | 0 | Focused and final lint. |
| Targeted client Vitest collaboration/presence files | 0 | 3 files, 10 tests. |
| `docker compose -p docmost-g18 ... build/up` | 0 | Dedicated image and volumes. A first smoke using `127.0.0.1` as Origin returned CSRF 403; rerun with `localhost` matched configured Origin. |
| `CI_SMOKE_BASE_URL=http://localhost:3180 CI_SMOKE_COLLAB_URL=http://localhost:3181 node scripts/ci-production-smoke.mjs` | 0 | Production image/API/collaboration smoke. |
| Focused `corepack pnpm --filter ./apps/client test:editor:e2e` | 0 | Final: Chromium and Firefox, 2/2. Initial run exited 1 because the existing spec omitted the Playwright `browser` fixture from its helper argument; fixed test-only. |
| Temporary G18 runtime harness | 0 | Final: 10/10. Earlier exit-1 iterations were harness assertion/timing problems (foreign token issuance versus socket denial, readiness order, graceful stop, wrong session field, rate limiting and missing explicit process exit), not accepted product defects. |
| Temporary G18 browser-presence harness | 0 | Final: 6/6. Initial exit 1 tried to edit the intentionally huge load-test page; removed as duplicate of the focused editor assertion. |
| `corepack pnpm --filter ./apps/server exec jest --config test/jest-e2e.json --runInBand` | 0 | Final: 4 suites, 16 tests. Earlier exit 1 variants passed `--` as a pattern, supplied an invalid `schema` URL option, then exposed the shared-client false-negative fixed test-only. |
| `corepack pnpm run test:security` | 0 | Server: 66 suites / 773 tests. Client: 6 files / 74 tests. |
| Full unfiltered `corepack pnpm --filter ./apps/client test:editor:e2e` | 1 | 10 passed, 7 failed in neighboring Draw.io/editor/synced-block paths. G18 collaboration case passed in both browsers. |
| Direct 17 MiB `ws` frame against `/collab` | 0 | Server closed with WebSocket code 1009; a first one-line invocation had PowerShell quoting error and exited 1 before making a connection. |
| `corepack pnpm verify:full` | 1 | Contracts, architecture, env/docs, build, lint, 214 server suites / 1673 tests and client build passed; client unit was 598/599 with the unrelated AI guide 30-versus-31 count failure. |
| Artifact sanitization generated by editor runner | 0 | Focused: 19 replacements, 0 findings. Full: 14 trace archives, 19,663 replacements, 0 credential findings. |
| `node apps/client/e2e/ai/scan-artifacts.mjs <G18 evidence>` | 0 | Two final passes: real auth/CSRF values plus writer canary, then real values plus owner canary; zero findings. |
| `git diff --check` | 0 | Clean before report commit. |

Non-material command errors were three Windows shell-glob/quoting mistakes during exploration and an initial malformed E2E database URL; none executed a product mutation and all corrected commands are represented above.

## 6. Findings summary

| ID | Severity | Component | Reproducibility | Expected / actual | Status | Fix commit |
| --- | --- | --- | --- | --- | --- | --- |
| G18-01 | High | collaboration WebSocket | Deterministic static + wire | A bounded collaboration frame; adapter inherited `ws` 100 MiB default, exposing pre-auth resource pressure | Fixed and verified | `f4b6f5b0` |
| G18-02 | Medium | Redis proxy forwarding | Deterministic injected rejection | Forwarding failure must fail closed; rejected promise was ignored and client remained open | Fixed and verified | `f9be54a5` |
| G18-03 | High | Redis lease / persistence | Deterministic unit + runtime fault | Lost owner must unload before more work; dirty unload veto left stale document/retries resident | Fixed and verified | `e68110f3` |
| G18-T01 | Low | editor E2E harness | Deterministic | Multi-user helper must receive Playwright browser; missing argument crashed before member context | Test-only fixed | `04b1a723` |
| G18-T02 | Low | Redis E2E harness | Deterministic | Two extensions must own independent clients; shared source client made shutdown test fail with `Connection is closed` | Test-only fixed | `32b783b7` |
| G18-DEP-A11Y | Medium | generic editor/public share | Chromium + Firefox | Editor textboxes need valid role/name/ARIA; Axe reports invalid/prohibited `aria-multiline`/`aria-label` and unnamed readonly textboxes | Not fixed; owner: editor/accessibility | — |
| G18-DEP-DB | Medium | generic application dependency recovery | Deterministic DB/Redis restart | Dependency outages should be handled without process-level unhandled events; logs contain `UnhandledRejection` for DB and unhandled ioredis error events during forced outage | Not fixed; owner: reliability/queue/bootstrap | — |
| G18-DEP-AI | Low | AI localization test | Deterministic | Localization assertion must match contract; 30 expected versus 31 actual guide keys | Not fixed; owner: AI/docs localization | — |

The seven full-editor failures are retained as dependency evidence rather than duplicated findings: Draw.io iframe absent in both browsers, generic editor scenario failure in both browsers, synced-block live-update assertion failure in both browsers, and a Firefox complex-document failure. Their traces and screenshots are in `full-editor-e2e/playwright-artifacts/`.

## 7. Finding details and evidence

### G18-01 — oversized collaboration frames

1. Inspect `CollabWsAdapter`: `WebSocketServer` was created with only `{ noServer: true }`.
2. The installed `ws` default is 100 MiB, while no Docmost collaboration limit was documented or enforced.
3. Red unit assertion showed `maxPayload` was not the intended 16 MiB.
4. Fix: introduce `COLLAB_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024` and pass it to `WebSocketServer`.
5. Acceptance: adapter test is green; a real 17 MiB frame against the rebuilt image closes with code 1009; health remains green.

Impact: a remote client reaching `/collab` could force substantially larger allocations before application-level authorization, increasing denial-of-service risk. No data exposure was found.

### G18-02 — Redis forwarding rejection did not fail closed

1. Inject `redisSync.onSocketMessage()` returning a rejected promise.
2. Before the fix, the `message` handler neither awaited nor caught it and did not close the proxied socket.
3. Fix: attach a rejection handler, emit only a generic error and close the wrapped client with code 1011 and a safe reason.
4. Acceptance: targeted unit test asserts catch and close; security, focused and runtime suites are green.

Impact: an outage or partition could create unhandled rejection noise and leave a client believing its writes were accepted. No payload or credential is added to logs.

### G18-03 — dirty document could survive lease loss

1. Make persistence fail with a retryable state so the document is dirty and has a retry timer.
2. Transfer the Redis lease to another server.
3. The old behavior closed connections and called `unloadDocument`, but `beforeUnloadDocument` rejected dirty unloads. The document remained in the Hocuspocus map and retained its retries/contributors.
4. Fix: Redis lease-loss handling calls a persistence-owned `onLeaseLoss` callback before unload. It cancels dirty retries and contributors only for the ownership-loss path, then unloads.
5. Acceptance: unit tests assert ordering and state removal; real DB hard-stop plus forced lease transfer recovers authoritative content; takeover occurs only after release.

Impact: this was a split-brain persistence risk. The old owner could retry stale local state after the new owner started serving the document. The fix deliberately discards only unpersisted local state after authoritative ownership is lost; clients retain offline edits and replay through the new owner.

Rollout/rollback: no schema or contract migration. Deploy all collaboration instances together. Rollback is the three production commits in reverse order; rolling back G18-03 reintroduces the stale-retry risk and is not recommended. Monitor generic forwarding failures, lease-loss logs, reconnect rates and persistence retry counts.

### Dependency findings

- Axe JSON under `editor-e2e/axe-results/` reproduces the editor/share ARIA failures in both desktop browsers. The offline interruption page has no violations.
- The forced dependency outage produced generic `NestApplication` unhandled DB rejection logs and ioredis unhandled error events. G18 clients still failed closed and recovered, but the global error ownership is outside collaboration.
- `verify:full` stopped on `apps/client/src/features/ai/utils/ai-localization.test.ts:213`, not on a G18 path.

## 8. Scenarios checked without a G18 defect

- authorized two-role simultaneous edits and deterministic Yjs convergence;
- bold formatting and table structure convergence;
- duplicate tab and abrupt close;
- IndexedDB/offline replay and reload;
- collaboration process restart and fresh authoritative state;
- owner-checked renew/release and takeover only after release/expiry;
- Redis restart, pub/sub reconnect and presence recovery;
- DB unavailable, dirty document, lease loss, DB recovery and replay;
- session revocation with an already open collaboration socket;
- foreign page socket denial even when the page-scoped token endpoint returns a token;
- foreign/mismatched Socket.IO rooms, malformed/nested relay events and spoofed presence;
- 17 MiB WebSocket rejection;
- 2 MiB document and 1000-update burst;
- presence grouping across two sessions and three tabs, page switch and clear;
- public share remains readonly;
- template/transclusion integration smoke where the neighboring test itself completed.

## 9. Limitations and untested work

- No four-hour wall-clock token-expiry wait; the 3 h/4 h refresh contract was read and post-revoke denial was exercised.
- No long multi-hour soak or precise throughput SLA. The 1000-update/2 MiB burst is a bounded stress check, not capacity certification.
- No exact fault injection inside PostgreSQL immediately before or after COMMIT. The transaction assertions and real process outage cover adjacent boundaries, not every instruction interleaving.
- No packet-level asymmetric partition or kernel proxy. Docker dependency restart/network failure was used; Toxiproxy was unnecessary for the reproduced defects.
- The main test installation supplied one production `docmost` service plus one production `collab` service, which are two Hocuspocus server processes sharing Redis. It did not run three collab processes.
- Full editor failures and ARIA issues remain with their owning contours; therefore no repository-wide release PASS is claimed.
- `verify:release` was not claimed: it requires the documented production-like full audit environment and would also inherit the known `verify:full` AI localization failure and full editor failures.

## 10. Fix report and acceptance criteria

| Defect | Production files | Tests added/changed | Final acceptance | Residual risk |
| --- | --- | --- | --- | --- |
| G18-01 | `collaboration/constants.ts`, `adapter/collab-ws.adapter.ts` | adapter unit spec | 16 MiB configured; 17 MiB wire frame closes 1009; builds/security/runtime green | Limit is fixed, not deployment-configurable; 16 MiB must remain sufficient for supported documents. |
| G18-02 | `collaboration.gateway.ts` | gateway injected-failure spec | rejection caught, generic log, close 1011; no credential content | Repeated Redis outage still causes reconnect churn by design. |
| G18-03 | gateway, persistence extension, Redis sync extension/types | persistence and Redis lease-loss specs | dirty timers/contributors cleared before unload; runtime DB/lease recovery green | Clients must reconnect/replay unpersisted edits; observability is log-based. |

Test-only commits:

- `04b1a723` — pass Playwright `browser` into the collaboration helper;
- `fc82dca6` — assert bold/table convergence and run Axe in the focused spec;
- `32b783b7` — give two Redis E2E extensions independent source clients.

Production commits:

- `f4b6f5b0` — payload cap;
- `f9be54a5` — Redis forwarding fail-closed;
- `e68110f3` — lease-loss dirty discard.

Acceptance criteria are met when the final focused Jest, server E2E, security, production smoke, focused browser, runtime and presence runs remain green on the merged code. Repository-wide acceptance additionally requires the owning contours to resolve the AI localization, editor matrix and ARIA dependencies.

## 11. Evidence, cleanup and integration

Evidence root (ignored by Git):

`D:\DevProjects\docmost-qa-G18\output\audit\g18-realtime-collaboration-2026-08-09`

Key evidence:

- `runtime-results.json` — final 10/10 fault/concurrency run;
- `browser-presence-results.json` — final 6/6 presence run;
- `10-presence-multi-session.png`, `11-presence-cleared.png`;
- `editor-e2e/playwright-results.json`, screenshots, Axe JSON and console capture;
- `full-editor-e2e/playwright-results.json`, failed traces/screenshots and sanitization report;
- `secret-scan.json`, `secret-scan-writer-canary.json` — zero findings;
- `docker-compose.g18.override.yml` — isolated topology without credentials.

The synthetic runtime/browser harness source files were deleted after the final green runs. The Graphify output was restored. No canary, auth token, CSRF token or password is present in the retained evidence according to both final scans. Failed trace archives were sanitized before scanning.

The audit branch is merged into local `main` with `--no-ff` after this report commit and a final focused post-merge check. The resulting `main` hash is reported in the accompanying final handoff because a commit cannot embed its own final hash without changing it. No push, pull request, tag or release is performed.
