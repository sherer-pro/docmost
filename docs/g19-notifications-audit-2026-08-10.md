# G19 Notifications audit — 2026-08-10

## 1. Verdict

**PASS WITH RISKS** on the final audited branch state.

The G19 release boundary is not blocked by a reproducible notification defect after the fixes listed below. Eight defects were reproduced and fixed. The final targeted, integration, security, production-build, lint, and browser checks passed. `verify:full` reached the complete client unit-test stage and then returned exit code 1 only for two pre-existing, out-of-scope client localization assertions: missing German `Inactive` and the AI administrator guide key count (`30` expected, `31` actual).

Residual risks:

- SMTP and Web Push remain at-least-once external side effects. A process crash after provider acceptance but before the local success marker can produce a duplicate on retry. This is documented behavior and cannot be eliminated without provider-side idempotency or a delivery-status reconciliation contract.
- The in-app Chromium profile had `Notification.permission === "denied"`. The denied-permission branch was exercised, while a real granted browser subscription and push-service delivery could not be completed because the browser controller does not permit changing the browser's notification setting. Backend Web Push, 404/410 subscription revocation, retry, aggregation, VAPID-missing, and service-worker click behavior were covered independently.
- The shared workspace avatar in the application header still fails WCAG color contrast. All notification-center actor avatar violations were fixed; the remaining header avatar is owned by the shared shell rather than G19.
- No physical mobile device or screen-reader session was available. Responsive Chromium and axe-core checks do not replace those checks.
- The targeted Jest command reports a worker that needs force-exit after all assertions pass. This is a test-harness teardown risk, not a notification assertion failure.

## 2. Fixed scope

| Item | Value |
| --- | --- |
| Release tag | `v1.0.0` = `446f6ddd68d87b28d6d1e2add90c235495149970` |
| Fixed audit head | `e955a0c8d13be6384a08988f40b4331b9b686ce8` |
| History boundary | `v1.0.0^..e955a0c8` |
| Main at branch creation | `11d6b7cdd5be846c8097dcb67e3c2a3bb356d19c` (`v1.0.0-160-g11d6b7cd`) |
| Audit branch | `codex/g19-notifications` |
| Final audited branch commit before this report | `7468790e7ce128489cbfe7debac4abacc1254d94` |
| Runtime image | branch commit `7468790e`; `docmost-local:dev` image ID `sha256:6c596489316f039c0ca5c24dee6fb1b591f73e273dd4d9a43da4fff7b053831c` |

The main tree was dirty before the audit only in `graphify-out/*`. The work was isolated in `D:\DevProjects\docmost-qa-G19`; no main-tree Graphify artifacts were overwritten.

### History reviewed

The full diff, test changes, migrations, and contracts were inspected for the primary notification hardening commit `5a6d905a`. Related history inspected included `2b310723`, `b081e472`, `d7dd6dd7`, `1e339e65`, and `b57c15c5`. Post-audit-head changes on owned/integrated paths were inspected for `4d9824ef`, `6f65ae26`, `6dfdea64`, and `d12a7596`; their fixes were preserved and not reopened.

### Files and contracts reviewed

- Server: `apps/server/src/core/notification/**`, `apps/server/src/core/push/**`, notification queue processors, transactional mail templates, mail processor, queue outbox, notification/push/watcher repositories, page/comment/history event producers, WebSocket invalidation, environment validation, and queue constants.
- Client: notification center components, query/service/types, account notification preferences, comment and mention UI, push subscription UI, `apps/client/public/sw.js`, and service-worker tests.
- Data: notification, push subscription/job, queue outbox, watcher, access-rule, page, user, and settings tables.
- Migrations: `20260806T120000-notification-delivery-hardening`, `20260805T120000-watcher-access-cleanup`, `20260809T140000-notification-dispatch-outbox`, and the current migration ledger/status.
- API: `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/mark-read`, `POST /api/notifications/mark-all-read`, `POST /api/notifications/archive`, `GET /api/push/vapid-public-key`, and push subscription create/delete routes. The generated route inventory was updated for the recipient-scoped archive route; no public schema or migration was changed for test convenience.

## 3. Implementation map

| Layer | Implementation and controls |
| --- | --- |
| Producers | Comment creation/reply/mention/resolution, page mention, assignment, stakeholder addition, and significant updates emit one of eight `NotificationType` values. Stable event IDs and per-recipient deduplication keys are created at the producer boundary; actor self-actions are suppressed. |
| In-app API/UI | Authenticated notification GET/count/read/read-all/archive routes use the authenticated user ID. The client uses infinite cursor pagination, WebSocket invalidation, reload-safe preferences, accessible action controls, and recipient-scoped dismissal. |
| Persistence | PostgreSQL `notifications` has a unique `deduplication_key`; `queue_outbox` provides leased, fenced, recoverable dispatch; `push_notification_jobs` has unique idempotency/window keys and a lease; `push_subscriptions` are user/workspace scoped. |
| Access policy | Delivery rechecks current user active state, page read access, space membership, read/archive/email state, channel preference, and deleted page state at production and again at delayed delivery. Watcher cleanup removes lost space members, while page access is rechecked independently for every delivery. |
| Immediate email | Notification row and `notification_email` outbox entry are created transactionally. The outbox worker decrypts the private message payload, rehydrates the notification, rechecks delivery eligibility, then hands it to the mail queue. The mail processor performs a second current-state check before provider send. |
| Digest email | A repeatable BullMQ job runs every 60 seconds. PostgreSQL selects fair pending users, filters active users and current preferences, applies 1h/3h/6h/24h windows, filters unread/unarchived/access-allowed events before the display limit, localizes RU/EN, queues one digest, and marks only the included rows after successful send. |
| Web Push | Immediate or page/time-window aggregation writes leased jobs. The dispatcher rechecks current delivery policy, sends a privacy-minimized aggregate payload, revokes permanent 404/410 subscriptions, retains transient failures, records successful subscription IDs, and reschedules only failed endpoints with stable idempotency. |
| Browser service worker | `push` displays the server-provided aggregate notification. `notificationclick` closes the notification, focuses a same-origin visible client when available, otherwise opens the safe relative URL. |
| Jobs/recovery | Notification email and dispatch use the transactional queue outbox; the BullMQ job is only a wake-up. Periodic outbox recovery runs every 15 seconds. Email and push aggregation run every 60 seconds. Processing leases are owner-fenced; expired work is reclaimed. Structured metrics/logs contain event codes and counts, not recipients, bodies, endpoints, or raw provider errors. |
| Configuration | Email driver/SMTP env, Web Push VAPID public/private keys and subject, per-user `emailEnabled`, `pushEnabled`, `emailFrequency`, and `pushFrequency`. Supported frequencies are `immediate`, `1h`, `3h`, `6h`, and `24h`; invalid values are rejected. No G19 feature flag gates the core notification center. |
| External systems | PostgreSQL is authoritative storage; Redis/BullMQ is scheduling/wake-up/lease infrastructure; SMTP and browser push services are external at-least-once side effects; local storage is not used for notification content. |

## 4. Environment and external tools

| Tool | Provenance/version | Isolation and data |
| --- | --- | --- |
| Docmost test stack | Docker Desktop `29.5.3`; PostgreSQL `18-alpine`; Redis `8-alpine`; final app image ID above | Bound to loopback where published. Existing test database/Redis were used as authorized. Secrets were loaded from `.env.qa`/Docker secrets and never copied to evidence. |
| Mailpit | Official `axllent/mailpit:v1.30.7`, pinned image digest `sha256:d5ecbb067db3705fa953d79e1b7f81ef84038df67aba6c52825d8c02a1ea748a` | Local container `docmost-g19-mailpit`; SMTP `1025`, UI/API loopback `18025`; synthetic recipients only; no persistent volume. Selected because the repository's default log driver cannot prove SMTP envelopes, retries, locale, or body links. |
| In-app browser | Product-provided Chromium browser controller | Two authenticated sessions/roles were used where supported. Notification permission was denied by the profile and could not be changed through the permitted controller. No SaaS browser received source or test data. |
| axe-core | Local `axe-core@4.12.1` | Injected into the local test page only; results remained local. |
| Node/pnpm | Host Node `v24.16.0`; repository-pinned pnpm `10.4.0` | Repository-native build/test scripts. Production target remains Node 22 as defined by the image. |

Mailpit source and pin were verified against the official v1.30.7 release and official Docker installation documentation. The temporary container and Compose override are removed during audit cleanup.

## 5. Coverage matrix

| Requirement/scenario | Static/unit/integration/browser/fault/security evidence | Result |
| --- | --- | --- |
| All event types, actor/recipient/self/multiple-recipient behavior | Producer diff/assertion review; `comment.notification.spec.ts`; page notification tests; live UI creation of all 8 types; exact center copy/link/actor/page inspection | PASS after G19-005 |
| Stable IDs, replay, concurrency, before/after-crash behavior | Unique notification key; outbox/job idempotency keys; concurrent service tests; repeated BullMQ jobs; lease recovery tests; explicit known provider-acceptance window | PASS WITH documented at-least-once risk |
| Immediate email | Mailpit envelope/body/link inspection; channel/read/access rechecks; SMTP stop/start transient recovery; one message after recovery | PASS after G19-001 |
| Digests 1h/3h/6h/24h | Four synthetic users across RU/EN; two eligible unread events each; read/archived exclusions; localized subjects/plural/action/links; forced jobs and DB markers | PASS after G19-004/G19-008 |
| Mark read/read all/archive/pagination | UI and API; DB independent assertions; archive `204`; mobile scrolling `20 -> 35`; first/next cursor requests | PASS after G19-003 |
| Access revoke/remove watcher | Live queued email during SMTP outage followed by page deny; cancelled outbox/no Mailpit message; direct URL/API denied; restore observed without restart; migration/hooks/repository tests reviewed | PASS |
| Per-channel preferences | UI save/reload for all valid frequencies; enable/disable; multi-session reload; invalid `2h` API value returned `400` | PASS |
| Web Push | Permission-denied UI path; VAPID missing unit branch; 404/410 revoke; transient retry without successful-endpoint duplication; aggregate payload; service-worker focus/open behavior | PASS WITH granted-browser limitation |
| Provider failures/retries/privacy | SMTP stop/start; transient and permanent Web Push specs; retry exhaustion; provider-error redaction; log/DB/artifact secret scans | PASS |
| Deleted/archived page and inactive recipient | Deleted page filtered at context and policy boundaries; archived notification excluded; live deactivated user received a baseline digest before fix, then Mailpit stayed `3 -> 3` and `emailed_at` stayed `NULL` on the rebuilt fix | PASS after G19-008 |
| Accessibility/mobile | Desktop/mobile screenshots; keyboard mention selection; 32px action targets; accessible labels; axe on preferences and center; post-fix notification avatar contrast | PASS WITH shared-header contrast risk |

## 6. Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status / fix |
| --- | --- | --- | --- | --- | --- | --- |
| G19-001 | High | Immediate email/outbox | Deterministic unit and queue-state replay | Read/archived/access-lost/disabled events must not send / queued payload could reach SMTP using creation-time state | The durable outbox dispatch and mail worker did not both rehydrate and recheck the current notification/policy state | Fixed: `0ff499ef` |
| G19-002 | High | Web Push retry | Deterministic mocked 503 plus mixed subscriptions | Retry only failed endpoints without duplicate success or endpoint leakage / batch failure handling lost per-subscription outcome | `Promise.all` failure collapsed the batch, did not retain successful IDs, and logged raw provider context | Fixed: `12d3c14f` |
| G19-003 | Medium | Notification center | Deterministic API/UI | User can remove a notification and load the complete cursor history / no dismissal route and the center displayed only the initially loaded page | Missing recipient-scoped archive mutation and missing infinite-page fetch behavior | Fixed: `5b677777` |
| G19-004 | Medium | Digest selection | Deterministic repository/service test | Display limit applies after eligibility / inaccessible, read, or archived candidates could occupy the limited candidate window | Candidate limiting preceded current eligibility filtering | Fixed: `5b677777` |
| G19-005 | High | Comment mention production | 100% in live keyboard flow | Enter on a highlighted mention must select it and preserve mention metadata / Enter submitted a plain-text comment, so the mention notification was never produced | The comment editor handled Enter before the mention suggestion list could consume it | Fixed: `33188a40` |
| G19-006 | Low | Comment action menu | Deterministic axe/DOM inspection | Icon-only menu has an accessible name and >=32px target / the control was unnamed and undersized | Raw compact action icon bypassed the shared accessible action component | Fixed: `d3e1253e` |
| G19-007 | Low | Notification actor avatars | Deterministic axe, 10 nodes | Avatar initials meet contrast requirements / deterministic background shades failed contrast with white text | Light palette shades were used for filled initials | Fixed: `3529c8b5` |
| G19-008 | High | Recipient lifecycle | 100% live DB/queue/Mailpit | Deactivated/deleted recipients and deleted pages must not produce/deliver notifications / a deactivated RU 3h user received a digest | Notification production, digest candidate selection, and delayed policy checks filtered deleted users inconsistently and did not filter `deactivated_at`; page context did not filter soft deletion | Fixed: `7468790e` |
| G19-DEP-001 | Low | Shared application header | 100% axe | Header workspace avatar meets WCAG contrast / one shared-shell avatar still fails | Shared workspace avatar palette is outside notification ownership | Not fixed; owner: shared client shell/design system |

## 7. Finding details and reproducible evidence

### G19-001 — immediate email current-state recheck

1. Create an immediate notification and its durable email outbox row.
2. Before the worker sends, mark the notification read, archive it, disable email, or revoke page access.
3. Replay the outbox job.
4. Before the fix, the queued message could be sent from creation-time data. After the fix, both outbox dispatch and the mail processor rehydrate the notification, verify ownership/read/archive/emailed state, and run current delivery policy.

Impact: a stale queued message could disclose a page event after the recipient had lost access or opted out. Tests: notification service, outbox service, email processor, and delivery policy specs. Runtime ACL-race evidence: the recipient outbox became `cancelled`; no recipient message arrived in Mailpit.

### G19-002 — Web Push per-subscription retry

1. Configure two active subscriptions for one recipient.
2. Make one provider call succeed and one return a transient `503`.
3. Before the fix, the aggregate send did not preserve per-subscription success and could retry a successful endpoint with the failed one; provider data could enter logs.
4. After the fix, successful subscription IDs are carried forward, only failed endpoints are retried, permanent `404/410` subscriptions are revoked, retry exhaustion is bounded, and logs contain status/count codes only.

Impact: duplicate pushes and privacy-sensitive endpoint/provider context. Tests include transient, permanent, mixed-success, exhausted retry, VAPID missing, and aggregate-job branches.

### G19-003/G19-004 — center lifecycle and digest fairness

The browser center initially returned 20 rows and the mobile scroll did not load the remaining cursor page. The archive action did not exist. The fix added the authenticated `POST /api/notifications/archive` mutation, ownership-scoped repository update, mobile-safe action structure, cache invalidation, and infinite-page fetch. Runtime evidence: archive returned `204`; database state changed only for the authenticated recipient; the mobile list progressed from 20 to 35 visible items. Digest selection now applies access/read/archive eligibility before limiting the displayed batch.

### G19-005 — mention selection

On the G19 page, type `@`, filter to the recipient, highlight the suggestion, and press Enter. Before the fix, the comment was immediately submitted as plain text and no `comment.user_mention` event was emitted. The fix lets the suggestion keydown handler consume Enter before form submission. The repeated browser path selected a semantic mention and produced the expected notification copy/link/actor/page.

### G19-006/G19-007 — accessibility

The comment action menu was converted to the shared accessible action pattern and assigned its localized label. Notification initials now use a dark deterministic filled shade. axe-core changed from 10 notification-avatar contrast violations to zero; one separate shared workspace-header avatar remains. Mobile screenshots confirm the center and preferences remain usable after the visual fix.

### G19-008 — inactive recipients/deleted content

Live reproduction used the synthetic RU 3h digest recipient. After setting `users.deactivated_at`, inserting an eligible two-hour-old unread event, and forcing aggregation on the pre-fix image, Mailpit received the localized Russian subject meaning "You have 1 update". The fix adds an active-recipient gate before insertion, filters active users from digest candidates, rechecks active state for email/digest/push delivery, and excludes deleted page context.

After rebuilding image `sha256:6c596489...`, a new `g19-deactivated-after-fix` row was inserted and the aggregation job completed. Mailpit total stayed `3 -> 3`, and `notifications.emailed_at` stayed `NULL`. This is independent runtime evidence of suppression.

## 8. Scenarios checked without a new defect

- All eight event types: `comment.user_mention`, `comment.created`, `comment.reply`, `comment.resolved`, `page.user_mention`, `page.updated_for_assignee_or_stakeholder`, `page.assigned`, and `page.stakeholder_added`.
- Self-action suppression and stable per-recipient deduplication keys.
- Two roles and concurrent sessions for actor/recipient delivery and preference persistence.
- Mark one/read all/archive ownership, reload, reconnect, and cursor pagination.
- RU/EN immediate and digest subjects, pluralization, action text, page links, and interval boundaries.
- SMTP transient outage and recovery without duplicate message in the exercised pre-acceptance failure path.
- ACL removal between creation and delivery; restored access invalidated without API restart.
- Invalid frequency rejection and push permission denial.
- Empty/missing VAPID configuration, permanent expired endpoint, transient push failures, aggregate payload, click focus/open.
- Notification provider/log redaction, queue payload minimization, secret artifact scan, and no identity/body in structured runtime logs.
- Watcher cleanup migration and runtime hooks. Current live-user watcher join found no invalid watcher. Rows belonging to already deleted `.deleted.docmost.com` audit fixtures were not removed because they were created by other audit contours.

## 9. Commands and exit codes

### Read-only scope/history/environment

| Command group | Exit | Notes |
| --- | ---: | --- |
| `git status --short`; `git rev-parse HEAD`; `git describe --tags --always`; worktree creation | 0 | Captured dirty Graphify-only main and created `codex/g19-notifications` from current main. |
| `git log`, `git show --stat --summary`, and scoped `git diff` for the commits and paths in section 2 | 0 | Commit messages were not used as proof without diffs/tests/migrations. |
| `rg`/`Get-Content` implementation, route, test, config, migration, and Graphify queries | 0 | Read-only static map and dependency analysis. |
| Initial exploratory PostgreSQL column probes | 1, then 0 | Two probes used stale guessed names (`event_id`, then `event_key`/`type`); `\d` established the actual `deduplication_key`/`kind` schema and corrected queries passed. No write was performed by the failed probes. |

### Build, runtime, and browser

| Command | Exit | Result |
| --- | ---: | --- |
| `docker compose ... build docmost` | 0 | Final image built from `7468790e`. |
| `docker compose ... up -d docmost collab` | 0 | App healthy, collab running. Repeated after every server/client production fix. |
| Mailpit pinned container start/stop/restart and `/api/v1/messages` probes | 0 | Real local SMTP delivery/fault injection; final runtime deactivation check `3 -> 3`. |
| BullMQ forced email aggregation jobs and Redis job-state probes | 0 | Jobs completed; DB/message outcomes independently verified. |
| In-app browser UI/API/network/console/axe runs | Passed except stated limitation | All core browser paths passed after fixes; notification permission remained denied by browser policy. |

### Tests and validation

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter ./apps/server test -- --runInBand notification push history` | 0 | 16 suites, 75 tests passed; Jest force-exit warning after completion. |
| Targeted server tests for delivery policy, push, aggregation, notification, comments, mail, and outbox | 0 | Final focused set: 6 suites, 40 tests; earlier fix-specific sets also passed. One temporary test syntax mistake was corrected before commit and the complete set was rerun. |
| `corepack pnpm --filter ./apps/client exec vitest run ...notification... ...service-worker... ...comment-editor-keydown... ...accessible-action-icon...` | 0 | 5 files, 17 tests passed. |
| `corepack pnpm --filter ./apps/server test:e2e` with loopback PostgreSQL/Redis | 0 | 4 suites, 17 tests passed. |
| `corepack pnpm run test:security` | 0 | Backend 66 suites/785 tests; client 6 files/74 tests. |
| `corepack pnpm server:build`; client/production builds; `git diff --check`; targeted Prettier | 0 | Passed. |
| `corepack pnpm routes:inventory:check` | 0 | Generated inventory is current at 312 routes. |
| `corepack pnpm check:comments:en` | 1, then 0 | The first report draft included one Cyrillic mail-subject evidence string. It was replaced with an English description; the complete check then passed. |
| `corepack pnpm verify:full` | 1 | All gates/build/lint and backend 218 suites/1718 tests passed. Client unit: 125 files passed, 2 failed; 610 tests passed, 2 failed. Failures are the unchanged baseline localization assertions listed in the verdict. |
| `sanitize-traces.mjs` and `scan-artifacts.mjs` on G19 evidence | 0 | `archives: 0`, `replacements: 0`; `secretCount: 3`, `clean: true`, no findings. |
| Runtime Docker log exact-secret/JWT/identity scan | 0 | Auth token hits 0; CSRF token hits 0; credential-pattern hits 0; G19 identity hits 0. |
| Notification outbox payload privacy query | 0 | 9 dispatch and 29 email rows; identity match false in public and encrypted payload checks. Public payloads contain only notification IDs. |
| Calling sanitizer scripts with `--help` | 1 | These scripts interpret the first argument as an audit directory and do not expose a help mode. Source was then inspected and the correct directory invocation passed. |

## 10. Fix report

| Fix | Production modules/contracts | Tests and re-verification | Rollout/rollback/observability |
| --- | --- | --- | --- |
| Current-state immediate email gate | Notification service, queue outbox, mail module/processor, typed secret payload | Unit/outbox/mail/policy plus SMTP/ACL race and full security | Application-only deployment; no migration. Roll back commit if necessary. Structured cancellation/error codes remain. |
| Per-subscription push retry | Push service, aggregation, subscription/job repositories | Push unit, aggregate retry/lease/revoke, service-worker, security | Application-only. Retry capped at 3 aggregate attempts; logs expose counts/status only. |
| Archive, pagination, digest eligibility | Notification controller/service/repo and client center/query/service; generated route inventory | Ownership, cursor, archive, mobile browser, digest specs/live matrix | API adds an authenticated action route; no schema migration. Rollback removes the action and client affordance together. |
| Mention keyboard production | Comment editor keydown boundary and mention list | Component key tests, browser before/after, all event-type generation | Client-only; no contract/schema change. |
| Action-menu and avatar accessibility | Comment menu, notification item/styles | Component tests, axe desktop/mobile, screenshots, client build | Client-only; uses existing design system. Shared header contrast is a separate dependency. |
| Inactive recipient/deleted page gate | Notification service/policy/repo, email aggregation/processor, page/comment notification context | 6-suite/40-test final focused run, live pre/post Mailpit reproduction, e2e/security/full backend | Application-only; no migration. Safe rollback is commit revert, but that would reopen a privacy defect. Active-state suppression is visible through absent delivery, cancelled outbox, and existing structured batch counts. |

Acceptance criteria met for each fix: the defect was reproduced, the minimal production boundary was changed, a regression test was added, the image was rebuilt where applicable, the same functional path was repeated, and relevant security/regression suites were rerun.

## 11. Limitations and remaining work

- Granted Web Push subscription, delivery through a real browser push service, and notification-click navigation from an OS notification remain unverified in this controlled browser profile. Repeat in a disposable browser profile with notification permission pre-granted and synthetic VAPID credentials.
- Test at least one physical Android device and one screen reader before claiming platform-wide accessibility.
- Investigate the shared header workspace-avatar contrast under the shared client shell owner (`G19-DEP-001`).
- Investigate the Jest open-handle/force-exit warning independently; all notification assertions complete, but the harness should terminate naturally.
- The two pre-existing client localization test failures block a literal green `verify:full` and are owned by their localization/AI-guide changes, not G19.
- Eliminate the documented provider-acceptance duplicate window only if the selected SMTP/push provider offers a usable idempotency or delivery-reconciliation contract.

## 12. Evidence and commits

Evidence root:

`C:\Users\Pavel\.codex\visualizations\2026\08\10\019feb07-0487-7da3-81f0-c728413b7535\g19`

Saved evidence:

- `notification-center-all-events.png`
- `comment-mention-selection-broken.png`
- `comment-mention-after-fix.png`
- `notification-preferences-desktop.png`
- `notification-center-mobile.png`
- `notification-preferences-mobile.png`
- `notification-center-mobile-after-contrast-fix.png`
- `trace-sanitization.json`
- `secret-scan.json`

Production commits:

- `0ff499ef` — `fix(notifications): recheck immediate email delivery`
- `12d3c14f` — `fix(push): retry failed subscriptions without duplicates`
- `5b677777` — `feat(notifications): add recipient-scoped dismissal`
- `33188a40` — `fix(comments): preserve mention suggestion handling`
- `d3e1253e` — `fix(comments): label action menus`
- `3529c8b5` — `fix(notifications): improve avatar contrast`
- `7468790e` — `fix(notifications): suppress inactive recipients`

Test-only commit:

- `7f4cb94d` — `test(notifications): cover push failure branches`

No push, pull request, tag, or release was created. Temporary Mailpit, the loopback-port Compose override, synthetic deactivation state, and generated worktree Graphify artifacts are cleaned after report verification. The branch is merged into local `main` with `--no-ff` only after the final clean status and post-merge targeted verification.
