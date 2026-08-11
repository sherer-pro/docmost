# G17 comments and Markdown-with-comments audit — 2026-08-11

## 1. Verdict

**PASS WITH RISKS.** The seven reproducible G17 defects found during the audit were fixed, covered by focused regression tests, exercised against the rebuilt production image, and merged into local `main`. No confirmed G17 release blocker remains.

The residual risks are bounded and explicit:

- the full editor browser matrix ended at 17/23 passing because the environment has no `DRAWIO_URL` runtime and because three adjacent Firefox/mobile scenarios failed outside the G17 ownership boundary;
- page-history restoration of comment anchors was inspected statically but was not independently exercised through a complete browser restore workflow;
- a physical screen reader and physical mobile device were not available;
- the UI has no separate product role named `commenter`; the audit used owner, writer, and reader permissions plus direct API bypass attempts;
- a failure between creating an inline comment row and applying its editor mark can theoretically leave an orphaned comment, but the required collaboration partial failure was not reproduced.

## 2. Fixed scope and history

### Git boundary

- Release tag: `v1.0.0` at `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Fixed audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Primary history range read: `v1.0.0^..e955a0c8`.
- Starting local `main`: `7ad7a4d0d34efc11974d9a31fbd04cdc54069500` (`v1.0.0-234-g7ad7a4d0`).
- G17 branch: `codex/g17-comments-markdown`, created from that current `main` in `D:\DevProjects\docmost-qa-G17`.
- Local `main` immediately before integration: `cc54708927b970132f4148e12901c680f28d3151`.
- G17 integration merge: `e7b44a5e5940cf2f6b16775bac76866976c7a6f9` (`v1.0.0-259-ge7b44a5e`).
- Changes after the fixed audit head that touched the relevant surfaces were read before fixing: `33188a40`, `d3e1253e`, `4d9824ef`, `7468790e`, and `72bbba1d`. Existing fixes were retained.
- The requested relevant commit `e00c4cbd` was inspected with its stat, summary, diff, tests, and shared rendering-policy impact.
- Other relevant commits inspected in the fixed range: `b081e472`, `5a6d905a`, `2b310723`, `1dda5764`, `d7dd6dd7`, `5d12a481`, and `e40ebbf5`.
- Earlier baseline history inspected by path: `df0cfc82`, `3c2f03a9`, `24393c6c`, `0a3c04f8`, `b9bb0d77`, `cf71ffd0`, `fb4a4b83`, and `1a649382`.

### Production fix commits

| Commit | Change |
| --- | --- |
| `13b5bf84` | `fix(comments): protect thread state transitions` |
| `fddace4d` | `fix(export): preserve comment markdown positions` |
| `137e562e` | `fix(comments): align thread controls with access` |
| `84938567` | `fix(comments): label mobile comment surfaces` |
| `fdd342c3` | `fix(editor): avoid duplicating comment anchors on paste` |

### Files, contracts, migrations, and documentation inspected

The following implementation surfaces were read directly, including their related tests and callers where present:

- server comments: `apps/server/src/core/comment/**`;
- comment repository and database types: `apps/server/src/database/repos/comment/**` and the `comments` table definitions;
- client comments: `apps/client/src/features/comment/**`;
- global/mobile comment surface: `apps/client/src/components/layouts/global/global-app-shell.tsx`;
- inline editor integration: `apps/client/src/features/editor/extensions/comment*`, related editor toolbar/dialog code, and `packages/editor-ext/src/lib/comment/**`;
- Markdown integration: the page controller route for `POST /api/pages/actions/copy-markdown-with-comments`, `apps/server/src/integrations/export/copy-markdown-with-comments.service.ts`, its tests, and shared page/export authorization;
- notification smoke integration: comment notification creation, websocket invalidation, `notifications`, `watchers`, `queue_outbox`, and BullMQ wake-up flow;
- database-row presentation: database page/row navigation and comment panel consumers;
- migrations: `20240324T086600-comments.ts`, `20250725T052004-add-new-comments-columns.ts`, `20260213T085259-notifications.ts`, `20260805T120000-watcher-access-cleanup.ts`, and `20260805T130000-queue-outbox.ts`;
- contracts and configuration: comment request/response DTOs, page access abilities, route inventory, root/package scripts, Dockerfile, Compose configuration, `.env.example`, and `.env.compose.example`;
- documentation: `README.md`, `ARCHITECTURE.md`, `apps/server/docs/api-routing-conventions.md`, generated route inventory, the security regression runbook, and the queue-outbox runbook.

No stale public comment route, incomplete G17 migration, or comment feature flag was found. The latest database snapshot contained 101 applied migrations; the newest migration was `20260810T090000-repair-sso-credential-encryption`.

## 3. Implementation map

| Layer | Implementation and boundary |
| --- | --- |
| Page and database-row UI | Comment drawers, page comment section, open/resolved tabs, thread list/items, reply/edit/delete/resolve controls, and row/page navigation live under `apps/client/src/features/comment`. Database rows are pages and reuse the same ACL and comment presentation. |
| Inline editor | The client creates a comment through the API and applies a `comment` mark carrying `commentId`. `packages/editor-ext` renders anchors and now strips only comment marks from pasted slices so copied annotated text cannot clone an existing anchor. |
| Client state | TanStack Query loads page comments and invalidates them after mutations and websocket events. Active inline threads are kept visible even when a long list is collapsed. No comment-specific local cache or offline queue was found. |
| API/contracts | `/comments` endpoints require an authenticated session. `POST /api/pages/actions/copy-markdown-with-comments` uses the page action contract. Mutation inputs are validated; list input is capped at 500. |
| ACL | Reads require effective page read access. Create/update/delete/resolve require effective write/comment access as implemented by `PageAccessService`. Destructive root deletion with replies from other authors additionally requires page management authority. Resolve/reopen applies only to root threads. ACL is rechecked on every API call. |
| Service/repository | `CommentService` validates parent/root relationships, enforces one reply level, applies a 500-comment page limit under a page-row lock, serializes state changes with row locks, and emits notifications only for actual transitions. `CommentRepo` owns PostgreSQL reads and mutations. |
| PostgreSQL | `comments` stores page/workspace/user linkage, parent thread linkage, rich-text JSON, resolved state, timestamps, and inline selection metadata. Comments follow page/database-row lifecycle. No separate comment cache exists. |
| Markdown copy | The page controller authorizes the page and management action, loads all comments and actors, serializes page content, maps editor positions to Markdown line/context locations, and appends open/resolved threads with replies, authors, timestamps, status, selection, line, and nearby context. |
| Redis/queue/websocket | Comment state itself is not cached in Redis. Notifications use durable PostgreSQL `queue_outbox` plus an empty BullMQ/Redis wake-up signal. Realtime events invalidate client comment queries. Delivery policy and retry depth belong to G19 and were smoke-tested only here. |
| Storage/external systems | Comments and Markdown copy do not use object storage or an external comment service. No source or synthetic data was sent to SaaS. |
| Recovery | Database transactions protect row/comment/outbox changes. Queue recovery follows the outbox runbook. Browser reconnect/reload causes an authorized query refresh. Markdown copy is synchronous and returns an error rather than enqueueing partial output. |
| Limits/flags/observability | No G17 feature flag exists. The page limit is 500 comments, and the request list limit is at most 500. Existing application logs and notification/outbox state are available; no dedicated G17 metric was found. Logs were checked for synthetic canaries. |

## 4. Environment and tools

| Tool/runtime | Exact version or digest | Provenance and use | Isolation/data |
| --- | --- | --- | --- |
| Node.js | `v24.16.0` | Locally installed runtime; repository tests and harnesses. The production image remains based on Node 22. | Local checkout and synthetic test data only. |
| pnpm | `10.4.0` | Repository-pinned package manager through Corepack. | Offline frozen-lockfile install was used after missing local test executables were observed. |
| Playwright | `1.62.1` | Repository dependency; multi-context browser, Chromium/Firefox/WebKit acceptance, network and console checks. | Local `127.0.0.1`/`localhost` test deployment only. |
| Codex in-app browser | bundled browser plugin `26.803.61601` | Final visible UX, semantic accessibility tree, and screenshot inspection. | Existing local authenticated session; no remote browsing. |
| Docker Desktop / Compose | `29.5.3` / `5.1.4` | Production-image rebuild and isolated runtime control. | Only the `docmost` Compose project was changed. Other contour stacks were not touched. |
| PostgreSQL | `postgres:18-alpine`, digest `sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | Real persistence, ACL, race, limit, cleanup, and migration assertions. | Local Docker volume; synthetic G17 rows removed after testing. |
| Redis | `redis:8-alpine`, digest `sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | Websocket/BullMQ smoke and canary scan. | Local Docker volume; no secrets printed. |
| Production base image | `node:22-slim`, digest `sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436` | Repository Dockerfile build. | Local BuildKit only. |

No external package, MCP server, HTML scanner, or comment service was added. The existing repository tools covered the protocol, Markdown, browser, and sanitization checks. Authentication and CSRF values were loaded from `C:\Users\Pavel\Downloads\docmost-qa\.env.qa` into process memory; values were not copied into commands, reports, screenshots, or persisted JSON. The artifact sanitizer and secret scanner reported no findings.

The final pre-integration branch image was `sha256:1a77300...`, built from `fdd342c3`. After integration, the deployed image was rebuilt from `e7b44a5e` with image ID `sha256:13a0735a6322bd384a52843a7f3742aca1e23a06c1a5bdb09dd9ef394a862129`; the container became healthy before the final browser check.

Volatile runtime snapshot during the audit: PostgreSQL 155 MB and 101 migrations; Redis DB 0 had 1,157 keys, DB 14 had 8, and DB 15 had 43. These counts are evidence of that run, not deployment contracts.

## 5. Coverage matrix

| Requirement/scenario | Static/unit/integration | Browser/fault/security | Result and evidence |
| --- | --- | --- | --- |
| Page comments at start/middle/end and formatted list/table text | Serializer and selection-location tests; live Unicode/list case | Page and inline comment panels exercised | PASS after G17-04; `live-api-baseline.json`, screenshots 02-03 |
| Reply nesting and deep reply | Parent/root service and controller tests | Direct reply-to-reply request | PASS: one level accepted, deep reply rejected 400 |
| Long thread collapse/expand and active thread | Collapse unit tests | Keyboard-visible `More`/`Collapse`, focus and active thread checked | PASS after G17-05; screenshots 06-07 |
| Pagination and limit | Validation and service limit tests | Real DB 500th/501st creates and list | PASS: 500th 200, 501st 409, limit 501 rejected 400; `live-limit-check.json` |
| Resolve/reopen/open/resolved/hide completed | Service transition tests | Page tabs and direct API transitions | PASS after G17-01/G17-03 |
| Owner/admin/editor/reader and read-only/archive | ACL/static review and controller tests | Owner, writer, reader; permission demotion; archived-space bypass | PASS for available roles; no distinct commenter product role; `live-browser-matrix.json` |
| Edit/delete/resolve races | Row-lock/idempotence tests | Two-context and concurrent API requests | PASS after G17-02/G17-03; final delete state 404 and one resolve notification |
| Realtime invalidation/reconnect | Query and websocket source review | Reader received a writer comment without reload; reload after permission change removed composer | PASS |
| Inline replacement/deletion/move, undo/redo, copy/paste | Editor extension and paste regression tests | Paste/undo/redo harness | PASS for edit/paste lifecycle after G17-07; history restore separately limited |
| Database-row comments and navigation | Shared page/ACL source review | Two rows had isolated threads while switching | PASS; screenshot 10 and `live-browser-matrix.json` |
| Markdown positions and metadata | Expanded export unit suite | Live Unicode/list export and forbidden reader request | PASS after G17-04; line, reply, resolved status, author/time, Unicode, dedupe covered |
| Hidden/forbidden comments | Authorization and export service review | Reader copy returned 403 | PASS |
| Notification once | Service idempotence tests | Concurrent resolve produced one notification; queue/outbox/Redis inspected | PASS smoke; complete delivery remains G19 |
| Accessibility and mobile drawer | Accessible names/states unit and source review | Keyboard create/reply/collapse; semantic dialog name and mobile drawer | PASS for automated/keyboard scope after G17-05/G17-06; physical AT not run |
| Rich text/link/XSS and secret handling | Existing sanitization/security suites | Synthetic canary exported as text; unsafe scheme absent; DB/log/queue/Redis/artifacts scanned | PASS; `live-security-check.json`, `secret-scan.json` |
| ACL recheck/cache invalidation | Controller/PageAccessService tests | Writer demotion and direct API bypass 403 after stale UI/reload | PASS |
| Restart/retry/partial failure | Transaction/outbox and synchronous export review | Production rebuild/restart and reload; queue smoke | PARTIAL: runtime restart passed; inline create-before-mark failure not reproduced |

## 6. Commands and exit codes

The following command ledger records the material commands and their observed exit codes. Commands that deliberately established a red baseline are labeled accordingly.

| Command | Exit | Evidence/result |
| --- | ---: | --- |
| `git status --short` | 0 | Protected pre-existing `graphify-out/*` changes were recorded and preserved. |
| `git rev-parse HEAD` / `git describe --tags --always` | 0 | Starting snapshot recorded as `7ad7a4d0` / `v1.0.0-234-g7ad7a4d0`. |
| `git worktree add -b codex/g17-comments-markdown ../docmost-qa-G17 main` | 0 | Isolated audit branch created. |
| `git log ... -- <G17 paths>` and `git show --stat --summary <commit>` plus `git show <commit> -- <paths>` | 0 | Fixed range, earlier baseline, and post-audit-head diffs reviewed. |
| `corepack pnpm --filter ./apps/server test -- --runInBand comment` before install | 1 | Baseline environment failure: local Jest executable/dependencies were missing. |
| `corepack pnpm --filter ./apps/client test -- src/features/comment` before install | 1 | Baseline environment failure: local Vitest executable/dependencies were missing. |
| `corepack pnpm install --frozen-lockfile --offline` | 0 | Restored repository-pinned dependencies without network resolution. |
| Focused red server tests for reply resolve, cascade delete, and concurrent resolve | 1 | New assertions reproduced all three defects before production changes. |
| Focused red export position test | 1 | Expected Markdown line 6, received line 7 before the fix. |
| Focused red editor paste test | 1 | Expected zero copied comment marks, received one before the fix. |
| `corepack pnpm --filter ./apps/server test -- --runInBand comment` after fixes and after merge | 0 | 5 suites, 23 tests passed. |
| `corepack pnpm --filter ./apps/client test -- src/features/comment` after fixes | 0 | The current script/argument behavior ran 132 files and 638 tests; all passed. A happy-dom teardown `AbortError` was non-fatal. |
| `corepack pnpm run test:editor-ext` after merge | 0 | 15 files, 66 tests passed. |
| `corepack pnpm run test:security` | 0 | Server: 66 suites/790 tests; client: 6 files/74 tests. |
| `corepack pnpm run verify:full` | 0 | Architecture/env/docs/build/lint, server 224 suites/1,761 tests, client 132 files/638 tests, and security suites passed. |
| `corepack pnpm run check:comments:en` | 0 | Source/document comment language check passed before this report. |
| `corepack pnpm run routes:inventory:check` after merge | 0 | Generated inventory matched 312 routes. |
| `corepack pnpm run test:text-contracts` | 0 | One text-contract test passed. |
| `corepack pnpm run test:editor:e2e` | 1 | 17/23 passed in approximately 9.6 minutes; detailed limits below. |
| `node artifacts/g17-comments/live-api-baseline.mjs` | 0 | API, ACL, race, Unicode line-position, and notification assertions persisted. |
| `node artifacts/g17-comments/live-browser-matrix.mjs` | 0 | Two-context roles, websocket, demotion, row isolation, races, and archive behavior persisted. |
| `node artifacts/g17-comments/live-limit-check.mjs` | 0 | Real 500/501 boundary persisted. |
| `node artifacts/g17-comments/live-security-check.mjs` | 0 | XSS/link/canary checks persisted. |
| `node artifacts/g17-comments/live-inline-clipboard.mjs` before fix | 1 | Reproduced duplicated inline anchor. |
| `node artifacts/g17-comments/live-inline-clipboard.mjs` after fix | 0 | Text duplicated as expected while comment mark count remained one through undo/redo. |
| `docker compose build docmost` first attempt | 1 | Transient BuildKit gRPC failure; no code/test conclusion was drawn. |
| `docker compose build docmost` retry and after each production change | 0 | Current branch images built successfully. |
| `docker compose up -d docmost` after each build | 0 | Replaced app container became healthy before browser rechecks. |
| `node artifacts/g17-comments/cleanup-g17.mjs` | 0 | Removed 12 synthetic spaces and 20 synthetic users; follow-up SQL found zero G17 spaces/users/comments. |
| Artifact trace sanitizer and secret scanner | 0 | Zero token replacements required; two configured secrets checked; no findings. |
| `git merge --no-ff --no-verify codex/g17-comments-markdown` on local `main` | 0 | Conflict-free integration as `e7b44a5e`; protected dirty files retained. |

`verify:release` was not run as a single command because its editor browser gate had already failed deterministically in the same final code state. All independently available constituent gates were run. The six editor E2E failures were:

- Chromium and Firefox Draw.io copy-on-write: `iframe.diagrams-iframe` never appeared because `DRAWIO_URL` is not provided to the runtime;
- Chromium and Firefox editing behavior reached the Draw.io step after earlier paste/undo/redo assertions passed, then failed on the same missing iframe;
- Firefox template/transclusion catalog navigation could not find the adjacent page title;
- mobile WebKit timed out because an overlay intercepted the image tap.

The G17-relevant collaboration/offline, complex document marks, editor lifecycle, media/clipboard, synced-block, and mobile assistant-name scenarios passed. The six failures were not changed or claimed as G17 defects. Non-fatal warnings retained as evidence were the Vite chunk-size warning, a Jest worker forced-exit warning after passing assertions, happy-dom teardown `AbortError`, and a PostgreSQL collation warning.

## 7. Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status / fix |
| --- | --- | --- | --- | --- | --- | --- |
| G17-01 | Medium | Comment resolve API | 100% API | Only root threads may resolve / a reply returned 200 | Resolve path did not reject `parentCommentId` | Fixed, `13b5bf84` |
| G17-02 | High | Comment delete ACL | 100% API | Author cannot erase another user's reply by deleting the root / cascade delete succeeded | Ownership check considered only the root while FK cascade deleted the whole thread | Fixed, `13b5bf84` |
| G17-03 | Medium | Resolve concurrency/notifications | 100% with two requests | One state transition and one notification / duplicate transition notification | Read-then-write was not row-locked or idempotent | Fixed, `13b5bf84` |
| G17-04 | Medium | Markdown location | 100% Unicode/list fixture | Report actual one-based Markdown line / reported one line too high | Position mapper added an extra line offset | Fixed, `fddace4d` |
| G17-05 | Medium | Thread UI/permissions/a11y | 100% UI | Collapse reversible and controls follow current access / one-way expansion and stale owner actions | Collapse and action visibility were derived from incomplete local conditions | Fixed, `137e562e` |
| G17-06 | Low | Mobile drawer accessibility | 100% semantic tree | Comment dialog named Comments / named AI assistant | Shared drawer reused the wrong accessible title | Fixed, `84938567` |
| G17-07 | Medium | Inline copy/paste integrity | 100% editor | Pasted text must not reuse source `commentId` / duplicate anchor created | Editor paste preserved the comment mark and its identity | Fixed, `fdd342c3` |

### G17-01 — reply resolution bypass

- Reproduction: owner/writer created a root and reply, then sent the resolve mutation for the reply identifier.
- Baseline response: 200; expected: 400 because replies inherit root state.
- Fix: the service validates the target as a root comment before changing resolution state. The controller/service regression suite covers resolve and reopen.
- Impact: invalid per-reply state and inconsistent open/resolved presentation; no cross-workspace exposure.
- Recheck: focused server tests and the live API harness passed on the rebuilt image.

### G17-02 — root-author cascade deletes another user's reply

- Reproduction: a writer owned the root, an owner added a child reply, and the writer deleted the root through the API.
- Baseline: delete succeeded and the foreign child disappeared through database cascade. Expected: 403 unless the actor can manage the page/thread.
- Fix: deletion now detects replies by other authors and requires page move/delete/share management capability before deleting the root. Simple self-owned deletions remain allowed.
- Security/data impact: authorization bypass causing irreversible deletion of another user's comment.
- Recheck: delete returned 403 and the child still returned 200; focused ACL tests and the security suite passed.

### G17-03 — duplicate resolve notification under race

- Reproduction: two simultaneous authenticated resolve requests targeted the same open root.
- Baseline: both requests observed open state and emitted a transition notification. Expected: one durable transition notification.
- Fix: repository access locks the comment row for transition evaluation, and the service treats an already achieved state as an idempotent success without another notification.
- Impact: duplicate notification/outbox activity and confusing audit behavior; no comment loss.
- Recheck: both requests returned 200, final state was resolved, and exactly one resolved notification existed.

### G17-04 — off-by-one Markdown location

- Reproduction: copy a page containing Unicode and list content with an inline comment whose selection maps to Markdown line 6.
- Baseline: metadata reported line 7. Expected: line 6.
- Fix: line mapping now derives the one-based line directly from the Markdown prefix and handles start/middle/end, unavailable positions, context, and deduplication in focused tests.
- Impact: exported review metadata pointed reviewers at the wrong line.
- Recheck: live response and independently counted Markdown both reported line 6; export tests passed.

### G17-05 — irreversible collapse and stale action visibility

- Reproduction: expand a long thread, navigate an active resolved inline comment, and demote a writer while an existing query is visible.
- Baseline: `More` had no inverse collapse action, incomplete disclosure semantics, and edit/delete visibility could survive when `canComment` was false.
- Fix: reversible `More`/`Collapse` controls now expose `aria-expanded` and `aria-controls`; active items stay visible; resolved toggle state is announced; inline selection activation uses a localized keyboard-accessible button; action visibility combines ownership with current comment capability.
- Impact: keyboard/accessibility friction and misleading actions after permission changes. The server always remained the final enforcement boundary.
- Recheck: keyboard focus and expanded/collapsed states passed; demoted writer lost UI capability after refresh and direct API writes returned 403.

### G17-06 — wrong mobile dialog accessible name

- Reproduction: open the mobile comments drawer and inspect the accessibility tree.
- Baseline: the dialog name was `AI assistant`. Expected: `Comments`.
- Fix: the shared mobile surface receives the correct localized comment title and the body disclosure uses proper state semantics.
- Impact: screen-reader users could not reliably identify the active surface.
- Recheck: the final merged deployment exposed `role=dialog`, `aria-labelledby`, and accessible name `Comments`; console error list was empty.

### G17-07 — duplicated inline comment anchor on paste

- Reproduction: copy a slice containing a comment mark and paste it elsewhere in the same page.
- Baseline: text appeared twice and the same `commentId` mark appeared twice. Expected: duplicated text but only the original anchor.
- Fix: the editor extension recursively strips only the comment mark from pasted content while preserving text, structure, and unrelated marks.
- Impact: one thread appeared attached to unrelated content, producing misleading navigation and exports.
- Recheck: before paste one mark, after paste one mark and two text occurrences, after undo one mark, after redo one mark; focused extension and full editor-extension tests passed.

## 8. Verified scenarios without a defect

- Page and inline comment create/reply/edit/delete on real content, including formatted text and a list.
- One-level reply model and explicit deep-reply rejection.
- Open/resolved tabs, resolve/reopen, active resolved selection, hide/show completed behavior.
- 500-comment boundary and invalid list limits.
- Owner/writer/reader allowed and denied actions, archived space, reload after permission demotion, and direct API bypass.
- Realtime arrival in a second simultaneous reader context without reload.
- Edit/delete race converged to a deleted record (404) without cross-page leakage.
- Database-row comment isolation while switching between rows/pages.
- Markdown author, timestamp, reply, resolved status, Unicode, context, selection, line, and deduplication output.
- Forbidden Markdown copy returned 403.
- Rich-text HTML was exported as inert text, unsafe link scheme was absent, and no XSS executed in the UI.
- Synthetic canary existed only in the intended comment row/export and was absent from notification records, outbox payloads, logs, Redis values, and retained artifacts.
- Notification creation occurred once for the concurrent resolve transition.
- Keyboard comment creation/reply/disclosure and focus retention.
- Production rebuild, application restart, health recovery, page reload, and empty browser console in the final merged smoke.

## 9. Limitations and unverified scenarios

- There is no separately assignable `commenter` role in this product snapshot. The closest available writer/editor permissions and reader denials were tested; no claim is made for a nonexistent role.
- Workspace admin did not have an independent interactive browser context. Owner, writer, and reader contexts plus direct API requests covered the effective boundaries.
- Page-history restoration and moving/deleting inline anchors across a historical restore were not completed end to end in the browser. Source behavior and editor lifecycle tests were reviewed, but this remains unverified runtime behavior.
- A collaboration or network failure precisely after inline comment creation but before mark application was not injected. Potential orphan recovery remains a residual design risk rather than a confirmed defect.
- The maximum 500-comment boundary was exercised against PostgreSQL and the complete list response. A separate visible browser rendering and Markdown copy of all 500 entries was not run.
- Notification enqueue/idempotence was smoke-tested. SMTP/push/digest delivery policy, retry expiry, and full recovery belong to G19.
- No physical screen reader, physical phone, multi-touch gesture, or real mobile browser was available. Automated semantic inspection, keyboard behavior, and emulated mobile WebKit were used.
- No migration down/up destructive exercise was needed because fixes changed no schema or public contract. Existing relevant migrations were inspected and the deployed migration ledger was verified.
- `verify:release` remained unavailable as a single green gate for the exact browser-environment and adjacent failures listed in section 6.

## 10. Fix report, rollout, and residual risk

| Finding | Production change and tests | Revalidation | Rollout/rollback/observability |
| --- | --- | --- | --- |
| G17-01 | Root-only resolve guard; service/controller tests | API 400, focused/server/security green | Ordinary app deploy; rollback `13b5bf84` only together with G17-02/03 risk acceptance. Watch 4xx resolve errors. |
| G17-02 | Foreign-reply destructive ACL check; controller/service tests | API 403, child retained, security green | No schema/contract change. Watch forbidden delete rate and comment deletion audit logs. |
| G17-03 | Row-locked idempotent transitions; concurrency tests | 200/200 with one notification | PostgreSQL lock only; no migration. Watch duplicate notification/outbox counts and lock latency. |
| G17-04 | Correct Markdown position mapper and expanded serializer tests | Live line 6 equals independent count | Synchronous application deploy. Rollback restores inaccurate locations but not page data. Watch export errors. |
| G17-05 | Reversible disclosure, active visibility, current capability helper, keyboard labels | Browser keyboard/role/demotion checks and client suite | Client-only behavior; rollback commit if unexpected UI regression. Server ACL remains authoritative. |
| G17-06 | Correct localized mobile title and disclosure semantics | Final merged dialog semantic name `Comments`, no console errors | Client-only, safe rollback. Use accessibility name checks as acceptance. |
| G17-07 | Paste transform removes only comment marks; extension tests | Live paste/undo/redo and 66 editor-ext tests | Client/editor extension deploy; no stored-data migration. Rollback would reintroduce duplicated anchors. |

Acceptance criteria achieved for confirmed defects:

- invalid reply resolution is rejected;
- a root author cannot cascade-delete another author's reply without management authority;
- concurrent identical transitions emit one notification;
- exported location matches the actual Markdown line;
- long-thread disclosure is reversible, stateful, keyboard operable, and permission-aware;
- the mobile comment dialog is correctly named;
- pasted content does not clone comment identities;
- focused, full, security, rebuilt-image API, and browser checks pass within the documented environmental limits.

No contract, schema, or migration changed. Rollout is the normal application image replacement. Rollback is commit-level and requires reverting the applicable fix commit, with `13b5bf84` treated as one security/state-transition unit. Remaining observability is existing structured application logs, PostgreSQL comment/notification/outbox rows, and client console/network traces; no new metric was introduced.

## 11. Evidence, cleanup, and integration

Evidence is retained outside Git under `D:\DevProjects\docmost-qa-G17\artifacts\g17-comments`:

- screenshots `01-baseline-page.png` through `11-main-merged-mobile-comments.png` (the rejected login-wall capture was deleted);
- `live-api-baseline.json` and its reproducible harness;
- `live-browser-matrix.json` and its two-context harness;
- `live-limit-check.json`, `live-security-check.json`, and `live-inline-clipboard.json` with their harnesses;
- `trace-sanitization.json` and `secret-scan.json`;
- `cleanup-g17.mjs`.

The harnesses, fixtures, screenshots, and JSON evidence are test-only and intentionally uncommitted. They contain only synthetic data after sanitization. Cleanup permanently removed 12 G17 test spaces and 20 G17 test users; follow-up SQL found zero matching spaces, users, or comments. Recovery would require a database backup.

The five production commits were merged conflict-free into local `main` as `e7b44a5e`. Files under `graphify-out/*` were dirty before the audit; their changes were not staged, committed, reverted, or overwritten. No push, pull request, tag, or release was created.

The final post-report `main` commit and describe value are recorded in the task handoff because a report cannot include the hash of the commit that contains itself.
