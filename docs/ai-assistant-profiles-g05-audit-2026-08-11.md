# G05 assistant profiles, composer UX, admin guide, and usage statistics audit - 2026-08-11

## Verdict

**PASS WITH RISKS after fixes.** Eight reproducible medium/low defects were fixed: technical capability identifiers in the editor, incorrect space-admin override controls, hidden-profile identity misclassification, lossy quick-command editing, modal accessibility/contrast, missing mobile conversation identity, a forbidden policy request, and stale profile data across live sessions. The final isolated API matrix, browser matrix, cross-session probe, profile unit/integration tests, the complete AI browser suite, documentation contracts, localization checks, security suites, production build, and `verify:quick` pass on the fixed branch. No known unfixed release blocker remains in G05.

The verdict remains qualified because a real external MCP server was not invoked, the full per-space profile-count limit was not filled through the browser, non-UTC browser timezone rendering was not independently forced, and destructive migration down/up was not run. These are coverage limits, not observed production defects.

## Fixed scope and provenance

- Release baseline: `v1.0.0` at `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Frozen audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Working branch base: `466aff91aae0ff69cf96228ae4d3f8dac4d186e1`, described as `v1.0.0-260-g466aff91`.
- G05 branch: `codex/g05-assistant-profiles`.
- Production fixes:
  - `67fbad23` - `fix(ai): align assistant profile management contracts`.
  - `4885bc02` - `fix(ai): keep profile identity and state in sync`.
- Test-only support:
  - `f8dc725b` - `test(ai): support assistant profile agent probes`.
- The exact local `main` merge commit and final head are recorded in the final handoff because a commit cannot stably embed its own hash.

The complete stats, summaries, diffs, tests, migrations, contracts, and documentation changes were inspected for the required history: `d8da4fc5`, `7504b996`, `e94f5461`, `5359c2a1`, `c1fc49da`, `2f420cbb`, `b9eacba8`, `9bcc2ebe`, `89d6418a`, `e9caa6ee`, `db3abf1b`, `cb20905a`, `026fbb74`, and `9ea6ef0d`. Post-audit commits touching G05 paths were also inspected, including `77bfe89f`, `aa5b92e5`, `594b953`, `4b4bd67c`, `6cb5e3a1`, and `f6a95f8`; existing fixes were preserved.

Primary inspected surfaces:

- Server profile controller, DTOs, `ai-assistant-profile.service.ts`, run/conversation services, tool policy/registry, usage aggregation, provider tests, and related unit/e2e tests under `apps/server/src/core/ai` and `apps/server/test`.
- Client profile management, form serialization, query/cache wiring, profile identity helpers, composer controls, AI space settings, usage UI, admin guide, and tests under `apps/client/src/features/ai`.
- `packages/api-contract/src/ai-profiles.ts` and adjacent AI conversation/run contracts.
- `20260805T100000-ai-assistant-profiles.ts` and subsequent AI schema migrations, plus generated database types.
- All 12 `apps/client/public/locales/*/translation.json` files for exact `ai.*` parity.
- `docs/AI_ASSISTANT_AND_RAG.md`, `docs/AI_INTEGRATION.md`, route documentation, environment contracts, and the embedded administrator guide.

## Implementation map

| Layer | Implementation, boundaries, and recovery |
| --- | --- |
| UI | Space settings provide profile CRUD, ordering, all overrides, group availability, quick commands, probes, and usage. The composer resolves current live identity, hidden preferences, frozen conversation identity, launch behavior, and responsive profile selection. The admin guide is an owner/admin projection of the canonical AI documentation. |
| API/contracts | Profile CRUD, ordering, group policy, preferences, model/agent probes, and list/detail endpoints use shared limits and JSON contracts. Mutation routes are CSRF-protected. Detail/mutation routes require space management; readable lists are filtered by deployment/workspace/space gates, enablement, and group availability. |
| Service/policy | `AiAssistantProfileService` intersects the deployment kill switch, workspace policy, space AI state, profile enablement, group policies, selected model availability, and built-in/external tool subsets. Profile versions support optimistic concurrency and frozen run/conversation snapshots. |
| PostgreSQL | `ai_assistant_profile_workspace_settings`, `ai_assistant_profiles`, `ai_assistant_profile_group_policies`, `ai_assistant_profile_user_preferences`, and conversation/run snapshot columns are authoritative. Active names have a case-insensitive per-space unique index. `quick_commands` and snapshots are JSONB; temperatures remain numeric; hidden profile IDs are a native UUID array. |
| Redis/queue | Profiles have no separate Redis object cache. Redis/BullMQ supports AI run delivery, admission, cancellation, and realtime transport. Profile mutation invalidation now uses the existing space-scoped WebSocket broadcast so every active client invalidates its React Query data. Database reads remain available during Redis loss. |
| Provider/tools | Model and Agent probes resolve effective profile overrides and capability subsets through the same provider/tool policy services used by runs. Built-in tools are server-registry capabilities; external MCP is additionally bounded by deployment and origin allowlists. Provider faults return structured failure and do not mutate profile state. |
| Usage/observability | Weekly usage is aggregated from durable `ai_runs` rows by UTC day/status and token counters. Space managers see counts; readers receive `canManage=false` and no usage payload. Stable API error codes cover duplicate names, stale versions, locked conversations, unavailable models, and gate failures. Operational AI metrics are memory-aggregated and flushed periodically; logs and retained artifacts were canary-scanned. |
| Recovery | App restart reloads profiles/preferences/snapshots from PostgreSQL. Frozen conversation identity survives profile deletion. Redis interruption does not prevent profile reads. Provider retry succeeds after the deterministic local provider returns. Gate and policy mutations are restored in the harness cleanup. |

## Coverage matrix

| Requirement/scenario | Static/unit/integration/browser/fault/security check | Result | Evidence |
| --- | --- | --- | --- |
| Deployment/workspace/space gates | Source/history review; live deployment-off, workspace-off, space-off API checks; restored after each probe | PASS | List returns disabled/empty, conversation start or send fails closed, manager staging CRUD remains intentionally available under workspace-off. |
| Unauthorized access and direct bypass | Anonymous, reader, space admin, and owner requests; reader direct settings route | PASS | Anonymous list `401`; reader detail/update `403`; space admin global policy `403`; reader UI denied. |
| CRUD and all fields | 47-assertion API harness, browser editor, SQL type checks | PASS after fixes | Unicode, icons, instructions, quick commands, overrides, tools, groups, auto-start/launch message, enablement, order, and reload exercised. |
| Names/version/concurrency | Case-variant duplicate; two same-version updates | PASS | Stable `ai_profile_name_conflict`; concurrent outcomes `200,409`. |
| Delete active/preferred/default | API plus frozen conversation assertions | PASS | Preferred/hidden/default references cleared; deleted conversation identity remains frozen and unavailable. |
| Model/temperature/token overrides | Model/agent probes, invalid model, request boundary, space-admin browser UI | PASS after fix | Valid model and forced tool succeed; removed model is unavailable; tokens above context return `400`; admin controls enabled by effective policy. |
| Tool and group restrictions | Static service review, API policy mutation, agent probe, client labels | PASS for tested built-in paths | Group-denied profile disappears; forced profile tool succeeds; UI uses friendly capability names. |
| Preferences and isolation | Preferred/hidden conflict, cross-space injection, logout-equivalent independent sessions, SQL types | PASS | Conflict `400`; cross-space `404`; hidden UUID array and JSONB booleans/numbers remain native. |
| Composer identity | Existing/empty/locked conversations; hidden/deleted identities; desktop, 768 px, and 390 px browser | PASS after fixes | Hidden live identity remains named; deleted snapshot shows unavailable; mobile/narrow picker contains the frozen active identity. |
| Live cache invalidation | Two simultaneous browser contexts, mutation without reload | PASS after fix | Both contexts observed mutation; profile was restored; `realtime-probe-results.json`. |
| Weekly usage | Direct rows around UTC boundaries, empty/active/large counts, owner/admin/reader API | PASS for UTC contract | Exact midnight included, start-minus-one-second excluded, 2,000,000,000 tokens aggregate exactly, reader payload hidden. |
| Admin guide | Owner route, space-admin denial/redirect, links/text/static checks | PASS | No maintenance placeholder; routes, gates, limits, and recovery references align with canonical docs. |
| Localization/accessibility | Exact 12-locale `ai.*` unit parity, fallback tests, keyboard use, Axe, contrast inspection | PASS after fixes | Friendly names, no missing keys, final dialog has an accessible name/close action and zero Axe violations. |
| Restart/cache clear | Server restart, fresh browser/context, SQL/API comparison | PASS | JSONB objects/arrays/numbers/booleans and frozen identity remain structurally unchanged. |
| Fault/retry | Provider stop/start, Redis stop/start, app restart | PASS | Model probe `502` without profile mutation, then succeeds; profile list stays `200` with Redis down. |
| Secret handling | Synthetic canaries in provider flow; API/browser/log/DB/artifact scan; sanitizer | PASS | Final root scan reports `clean: true`, `findings: []`. |

## Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G05-01 | Medium | Profile editor capability list | Every editor open | Expected localized product names; actual raw `ai.capability.*` identifiers were visible. | Editor rendered contract IDs directly instead of the existing capability-label helper. | Fixed in `67fbad23`; unit/browser/localization checks pass. |
| G05-02 | Medium | Space-admin profile overrides | Every space-admin editor open | Expected model/temperature/token controls enabled when effective policy permits; actual controls were disabled. | Client derived permission from the owner-only workspace policy query, which returns `403` for a space admin, instead of the space-scoped effective list contract. | Fixed in `67fbad23`; API and browser checks pass. |
| G05-03 | Medium | Composer identity | Hidden active profile in an existing conversation | Expected the real active identity with hidden state; actual label said unavailable. | Display helper treated absence from the visible picker as unavailability even when the profile was still present in the complete list. | Fixed in `4885bc02`; unit and responsive browser checks pass. |
| G05-04 | Medium | Quick-command editor | Edit and save a structured command | Expected description, enabled state, and order to round-trip; actual UI silently discarded those fields. | Form conversion retained only label and prompt although the public JSON contract carries all fields. | Fixed in `67fbad23`; form unit, API native-type, and browser reorder checks pass. |
| G05-05 | Medium | Profile modal accessibility | Every profile modal | Expected named dialog, keyboard-close control, and readable text; actual modal had duplicate visual headers, no robust accessible name, and approximately 3.03/3.14 contrast on key text. | Ad-hoc modal structure did not use a semantic labelled dialog or accessible close/action patterns. | Fixed in `67fbad23`; keyboard, contrast review, and Axe report zero violations. |
| G05-06 | Medium | Mobile/narrow profile picker | Hidden/deleted active conversation at narrow widths | Expected the active frozen/live identity in the drawer; actual special identity options were omitted. | Responsive picker constructed options only from visible profiles, unlike the desktop identity path. | Fixed in `4885bc02`; 768 px and 390 px browser evidence passes. |
| G05-07 | Low | Space-admin settings network/console | Every space-admin visit | Expected no forbidden request; actual client issued owner-only workspace policy GET, received `403`, and logged an error. | Query had no permission-based enable gate. | Fixed in `67fbad23`; final browser has no failed API or console/page errors. |
| G05-08 | Medium | Multi-session profile state | Two already-open sessions | Expected a mutation in one session to update the other without reload; actual second session remained stale. | Mutations invalidated only the initiating React Query client; no profile event invalidated other live clients. | Fixed in `4885bc02`; query unit and two-context realtime probe pass. |

## Finding reproduction, fixes, and acceptance

### G05-01 and G05-05: editor disclosure and accessibility

1. Open space AI settings as owner and edit a profile.
2. Before the fix, inspect capability rows and the modal accessibility tree: raw technical identifiers were visible, key secondary text was below normal-text contrast, and the dialog lacked a stable accessible name.
3. The fix routes capability display through localized friendly labels and replaces the ad-hoc modal chrome with a labelled semantic dialog and accessible close action using existing UI patterns.
4. Acceptance: only friendly names such as `Search` and `Read page content` are visible, keyboard close works, final Axe violations are empty, and the before/after screenshot shows corrected hierarchy and contrast.

No public API or migration changed. Rollback would restore identifier disclosure and accessibility failures. Browser console/Axe output is the primary operational acceptance signal.

### G05-02 and G05-07: space-admin effective override policy

1. Sign in as a workspace member with space `admin` role and open the profile editor directly.
2. Before the fix, `GET /api/ai/assistant-profiles/policy` returned the intended `403`; the UI then disabled model, temperature, and max-token overrides despite the workspace policy allowing them.
3. The list response now carries the already-computed space-scoped `modelOverridesEnabled` value, and the client starts the global policy query only for workspace admins/owners.
4. Acceptance: space admin still cannot read or mutate global policy, but all permitted profile overrides are enabled and no `403` appears in browser network/console evidence.

The shared list contract was extended additively; no migration changed. Older clients ignore the field. Rollback would reintroduce a UI authorization mismatch without broadening backend access.

### G05-03 and G05-06: frozen/hidden composer identity

1. Start a profile-bound conversation, hide that profile in user preferences, and open the conversation on desktop, narrow panel, and mobile drawer.
2. Before the fix, desktop called the active profile unavailable and responsive drawers omitted it.
3. The display helper now separates `visible`, `hidden but live`, and `unavailable frozen` states; the responsive picker adds the same special active option used by desktop.
4. Acceptance: the hidden live profile keeps its real name/version, deleted profiles remain explicitly unavailable from their frozen snapshot, and all three viewports show the active identity.

No server contract or migration changed. Rollback would misrepresent effective conversation identity but would not change backend execution.

### G05-04: structured quick commands

1. Create a quick command with label, prompt, description, `enabled=false`, and a defined order; edit and save it through the UI.
2. Before the fix, description and enabled/order controls were absent and form serialization dropped those values.
3. The form adapter and editor now preserve and expose the complete existing contract.
4. Acceptance: UI edit/reorder/save retains every field; API returns native string/boolean/array structure after restart; focused form tests pass.

No contract/schema migration changed. Existing JSONB values are preserved. Rollback would cause silent data loss on the next UI save.

### G05-08: realtime cross-session invalidation

1. Open profile management in two independent authenticated browser contexts.
2. Update the profile in context A without navigating or reloading context B.
3. Before the fix, A updated and B retained the old name/version.
4. The existing authorized space WebSocket broadcast now carries a profile-invalidation event after create/update/delete/preference mutations; every client invalidates list/detail/preferences queries for that space.
5. Acceptance: both contexts observe the new state without reload, the fixture is restored, and reconnect still rehydrates from PostgreSQL.

No queue/schema/public REST contract changed. The event carries only space scope, not profile content or secrets. Rollback would restore stale multi-session UI; API/DB state would remain authoritative.

## Commands and results

Material commands and their observed exit codes are listed below. Read-only `rg`, `git log`, `git show --stat --summary`, `git show`, SQL selects, Docker inspection, browser log/network inspection, and artifact reads returned `0` unless noted.

| Command | Exit | Notes |
| --- | ---: | --- |
| `git status --short`; `git rev-parse HEAD`; `git describe --tags --always` | 0 | Recorded before changes; only pre-existing `graphify-out/*` modifications were present. |
| `git worktree add -b codex/g05-assistant-profiles ../docmost-qa-G05 main` | 0 | Isolated branch created from current local main. |
| `corepack pnpm install --frozen-lockfile` | 0 | Lockfile unchanged. |
| `corepack pnpm --filter ./apps/server test -- --runInBand ai-assistant-profile` | 0 | 28/28 profile unit tests. |
| initial server profile e2e invocation | 1 | Host `packages/api-contract/dist` was absent and the filter command forwarded an extra `--`; this was a harness/build-order failure, not a product assertion. |
| `corepack pnpm --filter @docmost/api-contract build` then direct Jest profile e2e | 0 | 6/6 PostgreSQL-backed profile e2e tests. |
| `corepack pnpm --filter ./apps/client test -- src/features/ai` | 0 | The command selected the complete client suite: 133 files and 638 tests at baseline. |
| final focused client profile form/display/query tests | 0 | Final affected suites pass; query cache suite is 4/4. |
| final full client unit rerun | 0 | 133 files and 645 tests. |
| `corepack pnpm run check:ai-docs` | 0 | Canonical docs, admin-guide projection, limits, routes, and all locales aligned. |
| `corepack pnpm run test:ai:e2e` first attempts | 1 | First run used `127.0.0.1` against the configured CSRF origin; later exploratory runs exposed a neighboring hard-coded mock port/allowlist assumption. Product assertions were not weakened. |
| `corepack pnpm run test:ai:e2e` with compatible pinned port `1080` | 0 | Final 24/24 across Russian/English Chromium, Firefox streaming, Pixel 7, and narrow panel. |
| custom G05 API harness | 0 | 47 passed, 0 failed. |
| custom G05 browser matrix | 0 | Owner/space-admin/reader plus desktop/768/390; no final failed API, console error, page error, or Axe violation. |
| two-context realtime probe | 0 | Mutation `200`; both contexts updated without reload and fixture restoration succeeded. |
| deployment/workspace/space gate harness | 0 | Each layer failed closed for execution and was restored. |
| provider stop/test/restart/test | 0 | Fault returned `502` without profile mutation; retry succeeded. |
| Redis stop/list/start/health | 0 | Profile list remained `200`; Redis returned healthy after restart. |
| app restart and fresh-client cache check | 0 | JSONB and frozen identity remained native and stable. |
| weekly usage UTC boundary/large-count SQL and API harness | 0 | Midnight/start boundary, empty/running, 2,000,000,000 tokens, and role visibility consistent. |
| `corepack pnpm verify:quick` pre-final retry | 1 | One of 1,771 server tests, DOCX extraction, exceeded 5 seconds under aggregate load; isolated 2/2 immediately passed. |
| isolated `ai-file.service.spec.ts` | 0 | 2/2; confirms a load-sensitive baseline timeout. |
| final `corepack pnpm verify:quick` after the last production fix | 0 | Env/architecture/release gates, lint, 225 server suites/1,771 tests, client build, 66 server security suites/790 tests, and 6 client security files/74 tests pass. |
| `corepack pnpm check:comments:en` | 0 | Source/document language contract passes. |
| `apps/client/e2e/ai/sanitize-traces.mjs` and `scan-artifacts.mjs` | 0 | Retained traces/artifacts sanitized; root scan is clean. |

`verify:release` was not run as one monolithic command because its full editor, AI-context, and production-like audit inputs exceed this isolated G05 runtime. Relevant available sub-stages were executed separately and are listed above. This limitation is not represented as a PASS for the complete release command.

## Environment and external tools

| Tool | Provenance/version | Purpose and isolation | Data |
| --- | --- | --- | --- |
| Git worktree | `codex/g05-assistant-profiles` from `466aff91` | Preserved the dirty main worktree and all `graphify-out/*` changes. | Source and synthetic test artifacts only. |
| Node.js / pnpm | Host Node `v24.16.0`; repository-pinned pnpm `10.4.0` | Build, unit/integration harnesses, deterministic provider process. | Synthetic profile/model prompts only. |
| Playwright | Repository-pinned `@playwright/test 1.62.1` | Chromium/Firefox, multiple contexts, responsive, keyboard, network, console, and screenshots. | Synthetic users/pages; artifacts sanitized. |
| `@axe-core/playwright` | Repository dependency used by the G05 browser probe | Local accessibility scan of the live profile modal. | Rendered local DOM only. |
| Docker Desktop | `29.5.3` on Windows 11 | Separate `docmost-g05` project on app `3105`, collab `3106`, PostgreSQL `35432`, Redis `36379`; separate volumes. | Synthetic G05 database/storage only. |
| Docmost image | `docmost-g05-local:466aff91`, final digest `sha256:d04bad6a051037ffd86a985adfedacbfb3346ec9db67b6b37461213832e75474` | Rebuilt after production fixes before browser rechecks. | Local source only. |
| PostgreSQL | `postgres:18-alpine`, digest `sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | Fresh 101-migration database and read-only JSON/type/usage assertions. | Synthetic G05 rows. |
| Redis | `redis:8-alpine`, digest `sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | Queue/realtime and explicit interruption/recovery. | Synthetic events/jobs. |
| MockServer | Official `mockserver/mockserver`, version `7.4.0`, digest `sha256:fed9b2089e021947f785d1f0bfda3723352bb2c1634ce7b0bcd42dfd1b0fd02f`, source tag commit `6fb02a58ba9f7c6648553aaf85625ff0344f1e53` | Local deterministic OpenAI-compatible broader AI suite. | Synthetic prompts and redacted canary only. |
| In-app browser | Codex desktop browser, finalized after inspection | Visual source capture and final product review against same-state before/after screenshots. | Local synthetic G05 installation only. |

No external LLM, Open WebUI, SaaS, remote MCP server, or public service received repository code, real workspace content, credentials, or canaries. Values from `.env.qa` were loaded only into process environment and were never copied to the report. Raw browser state files and setup scripts were removed before evidence retention.

## Evidence

Evidence root: `output/audit/g05-assistant-profiles-2026-08-11/`.

- Runtime metadata and isolated Compose override: `runtime/runtime-metadata.json`, `runtime/docker-compose.g05.yml`.
- API lifecycle matrix: `runtime/api-audit-results.json` (`47` passed, `0` failed).
- Final browser matrix: `runtime/browser-post-fix-results.json`.
- Cross-session invalidation: `runtime/realtime-probe-results.json`.
- Full AI browser suite: `runtime/upstream-ai-e2e-final/playwright-results.json`, `audit-state.json`, traces, video, screenshots, network, and console journals.
- Secret handling: `trace-sanitization.json`, `secret-scan.json`, and `runtime/upstream-ai-e2e-final/application-log-secret-scan.json`.
- Baseline screenshots: `screenshots/02-profile-editor-technical-ids-baseline.png`, `05-space-admin-overrides-disabled-baseline.png`, `08-hidden-active-profile-marked-unavailable-baseline.png`.
- Fixed screenshots: `screenshots/10-profile-editor-full-post-fix.png`, `11-hidden-active-profile-post-fix.png`, `12-space-admin-overrides-post-fix.png`, `15-composer-narrow-768-post-fix.png`, `16-composer-mobile-390-post-fix.png`, `17-space-admin-modal-in-app-final.png`.
- Same-state comparisons: `screenshots/comparison-profile-editor-before-after.png`, `screenshots/comparison-composer-identity-before-after.png`.

The final root secret scan ran at `2026-08-11T11:14:53.367Z` and reports `clean: true` with no findings. Raw auth state, temporary credentials, and harness scripts are not retained. Pre-existing `graphify-out/*` changes are excluded from every G05 commit.

## Verified no-defect scenarios

- Deployment, workspace, and space execution gates fail closed and restore cleanly.
- Anonymous and reader direct API/UI bypasses are denied; space admins cannot access workspace policy.
- Case-insensitive per-space uniqueness and optimistic version conflicts remain enforced.
- Disabled profiles are hidden from readers and cannot start conversations.
- Invalid max-token overrides are rejected against the configured model context window.
- Missing/removed models return unavailable without corrupting profile state.
- Group policy denial removes a profile from the affected member while other roles remain isolated.
- Preferred and hidden states cannot contradict each other; cross-space injection is rejected.
- An empty conversation can switch profile; the first message freezes identity and later switching returns `ai_profile_locked`.
- Deleting an active/preferred/default profile cleans mutable references but preserves frozen conversation identity.
- Structured JSONB and numeric/boolean/array values survive API update, server restart, and fresh client cache.
- Provider and Redis interruption fail or degrade safely and recover without profile corruption.
- Weekly UTC boundaries, active runs, large token counts, and role visibility agree with source rows.
- Admin guide routes, links, flags, limits, recovery text, and lack of maintenance placeholder match the code/docs contract.
- All 12 locales have exact `ai.*` parity and final capability names are friendly.
- Final desktop/narrow/mobile sessions have no recorded unhandled rejection, console error, failed API request, or Axe violation.
- Synthetic secrets are absent from retained API, browser, log, queue-safe evidence, and database summaries.

## Limitations and remaining risks

1. External MCP restrictions and effective capability intersections were covered in service/probe paths, but no positive invocation against a real external MCP endpoint was performed. The isolated runtime intentionally retained an empty MCP origin allowlist.
2. Built-in capability subsets were exercised through policy and forced-tool probes, not by forcing every registry capability through a separate live provider request.
3. The profile-count limit was inspected in contracts/service tests, but the full limit was not filled and exceeded through the browser in this run.
4. Usage boundaries were forced around UTC midnight, matching the implemented server contract. A browser with a non-UTC timezone was not independently configured to validate presentation expectations.
5. Auto-start, launch-message, and frozen identity branches were inspected and covered through API/unit/composer state, but a complete provider response initiated solely by every auto-start variation was not recorded as a separate visual scenario.
6. Fresh migration-up was proven in an isolated volume. Destructive migration down/up was not run against the retained shared installation.
7. `verify:release` was not run monolithically; available G05-relevant build, docs, unit, security, integration, and browser sub-stages were executed separately.
8. A single DOCX extraction test timed out only under one aggregate pre-final server run and passed immediately in isolation and in the final full verification. It remains a load-sensitivity signal outside G05 ownership, not an unfixed profile defect.

These explicit gaps keep the result at PASS WITH RISKS.

## Rollout, rollback, observability, and acceptance

- Rollout requires the ordinary server/client image rebuild. No migration or backfill is required for these fixes.
- The additive profile-list policy field is backward compatible. WebSocket invalidation contains only the authorized space scope and uses existing authenticated room boundaries.
- Rollback can revert `67fbad23` and `4885bc02` independently, but would reopen the corresponding UI/data-consistency defects. `f8dc725b` is test-only and can be reverted without production behavior change.
- Monitor profile list/detail mutation error codes, WebSocket reconnect/invalidation behavior, browser `403` rates on the workspace policy route, and client console errors. No new secret-bearing log fields were introduced.
- Acceptance criteria are the passing 47-assertion lifecycle harness, zero-error browser matrix, two-context realtime propagation, 24/24 AI browser suite, native SQL types after restart, exact locale/docs checks, and final green `verify:quick`.
- There are no known unfixable G05 findings. Remaining items are the coverage limits listed above.
