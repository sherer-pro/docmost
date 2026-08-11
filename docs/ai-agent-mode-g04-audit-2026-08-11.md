# G04 AI Agent, built-in tools, policy layers, and write approvals audit — 2026-08-11

## Verdict

**PASS WITH RISKS after fixes.** Two high-severity approval-boundary defects were reproduced and fixed. The isolated Agent browser/fault runner, the broader AI browser suites, the AI unit suite, the security suite, the structural ProseMirror/Yjs suite, builds, and secret scans pass on the fixed branch. No known unfixed release-blocking defect remains in the G04 production path.

This is not an unconditional PASS because two requested depth items remain only partially demonstrated: every one of the 26 tools was catalog/policy-checked, but only `getOutline` and `editPageText` were driven end-to-end by the deterministic model; and crash windows after Yjs apply but before the terminal event were verified by recovery unit contracts rather than by a precisely timed live process kill. These limits are recorded below and must not be inferred as covered.

## Fixed scope and provenance

- Release baseline: `v1.0.0` at `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Frozen audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Working branch base: `7ad7a4d0d34efc11974d9a31fbd04cdc54069500`, described as `v1.0.0-234-g7ad7a4d0`.
- G04 branch: `codex/g04-agent-approvals`.
- Fixed branch commits:
  - `c728ca7b` — `fix(ai): enforce approval expiry after admission wait`.
  - `f6a95f8c` — `fix(ai): recheck profile policy before approved writes`.
  - `7c017c02` — `test(ai): repair isolated agent audit runtime` (test-only).
- The exact local `main` merge commit and final head are recorded in the final handoff because embedding the current commit hash inside that same commit is not stable.

The complete diffs, stats, tests, migrations, contracts, and documentation were inspected for `1dda5764`, `9452e245`, `d285c7c6`, `ac79826e`, and `d2896fbc`. Post-audit changes touching the same paths were inspected before findings were classified, including `aa5b92e5`, `77bfe89f`, `2f420cbb`, and `e9caa6ee`; no previous fix was reverted or reopened as G04 work.

Primary inspected implementation surfaces:

- `apps/server/src/core/ai/tools/ai-tool-registry.service.ts` and its registry/read tests.
- `apps/server/src/core/ai/tools/ai-builtin-tool-policy.*` and the workspace/space controllers and DTOs.
- Agent run, execution, step approval, profile, admission, queue, and reconciler services under `apps/server/src/core/ai/services`.
- `apps/server/src/common/helpers/prosemirror/ai-page-operation.*` and the collaboration handler.
- `apps/client/src/features/ai`, the Agent mode control, approval card, activity/status rendering, profile and policy settings, and capability-label components.
- `packages/api-contract/src` AI capability, run, step, policy, and approval contracts.
- Built-in policy/profile/Agent migrations and the `ai_runs` / `ai_run_steps` schemas.
- `docs/AI_ASSISTANT_AND_RAG.md`, the embedded admin-guide locale projection, and the earlier `docs/ai-agent-mode-audit-2026-08-09.md` snapshot.

## Implementation map

| Layer | Implementation and boundary |
| --- | --- |
| UI | The assistant panel derives Agent availability from the tested provider fingerprint and effective profile/tool capabilities. Pending approvals are rendered from durable run steps with page, before/after, TTL, and native Approve/Reject controls. Reload reopens durable conversations and steps; query invalidation handles reconnect/terminal events. |
| API/contracts | Run creation and messages use shared AI contracts. Approval and rejection are initiator-owned actions on a specific run step. Workspace and space policy endpoints accept exact capability identifiers; space `null` means inherit and `[]` means deny all. |
| Policy services | Deployment maximum intersects workspace exact allowlist, nullable space narrowing, frozen and live profile/group policy, exposure, role/ACL, and current-page scope. Policy versions/fingerprints are frozen into runs and revalidated. |
| Run/admission | PostgreSQL is the durable run/step authority. Redis/BullMQ is delivery and recovery infrastructure. Provider admission is acquired only while model execution is needed; pending approvals do not occupy a provider slot. Run/segment step and tool budgets, pending-approval limits, and result byte limits are bounded. |
| Write proposal | Four Agent-only tools (`editPageText`, `patchNode`, `insertNode`, `deleteNode`) can propose current-page operations. The server stores base hash, expected post-apply hash, preview, TTL, and operation; no write is exposed through MCP. |
| Apply/reconcile | Approval rechecks owner, TTL, live workspace/space/profile/group policy, write ACL, current page identity, and live Yjs hash. The collaboration handler applies a structural operation, not a whole-document replacement. Recovery recognizes base hash (apply once), expected hash (already applied), and any other hash (stale/fail closed). |
| Persistence/recovery | PostgreSQL tables hold policies, runs, steps, snapshots, decisions, and application results. Redis carries queues, locks, and realtime invalidations. The Agent worker/reconciler recovers durable queued/approved work after application or Redis interruption. |
| Observability | Stable public error codes distinguish policy change, stale hash, expired approval, step/tool/result limits, rejection, and profile-policy change. Logs use event metadata and are covered by secret/canary scans; raw credentials are not retained in evidence. |

## Policy matrix

| Deployment | Workspace | Space | Profile/group | Role | Result and evidence |
| --- | --- | --- | --- | --- | --- |
| extensions off | stored 26 | inherit | allow | owner | PASS: live `/api/ai/tool-policy` maximum was 11 (seven legacy reads plus four approval-only writes); optional reads were outside the maximum. |
| extensions on | stored 26 | inherit | allow | owner | PASS: live maximum and effective catalog were 26. |
| on | exact 26 | `null` | allow | owner | PASS: live space view inherited exactly 26. |
| on | exact 26 | `[]` | allow | owner | PASS: live space view returned zero effective capabilities. |
| on | exact 26 | two-capability subset | allow | owner | PASS: live result stayed the same two capabilities. |
| on | narrowed workspace | wider/lower request | allow | owner | PASS: policy unit contracts intersect lower layers; Agent live policy-version change failed with `agent_tool_policy_changed`. |
| on | allow write | inherit | profile/group removes write after proposal | writer | PASS after fix: approval failed `agent_profile_policy_changed`, step remained `applied=false`, and the live page stayed unchanged. |
| on | allow write | inherit | allow | reader | PASS: deterministic Agent run created no pending write proposal. |
| on | allow write | inherit | allow | writer | PASS: proposal required approval, live ACL/hash were rechecked, and approved mutation applied once. |
| on | allow write | inherit | allow | different user | PASS: non-initiator decision returned not-found semantics and did not disclose/apply the proposal. |

The service tests additionally distinguish migrated legacy MCP keys, stable JSONB snapshot fingerprints, inherited/null versus explicit empty, deployment maximum, and live revocation for legacy runs.

## Tool catalog and execution coverage

The registry publishes 26 unique capability/name pairs: seven baseline reads, 15 optional reads, and four Agent-only write proposals. Registry tests assert exact catalog equality, unique names/capabilities, exposure metadata, write annotations, and per-tool result limits. The client localization tests and browser settings/approval inspection confirm friendly labels; the technical capability identifier is hidden behind an explicitly labeled copy action.

| Tool group | Tools | Evidence | Result |
| --- | --- | --- | --- |
| Baseline reads | `search`, `getTree`, `getPageContext`, `getPage`, `getOutline`, `getNode`, `searchInPage` | Exact registry/policy unit assertions; access-boundary service tests; deterministic model called `getOutline` on a live document. | PASS for catalog/policy and tested service branches; partial end-to-end per-tool model coverage. |
| Context/database reads | `getWorkspaceContext`, `getSpaceContext`, `getDatabaseContext`, `listDatabaseRows`, `getDatabaseRowContext` | Registry metadata; curated DB schema/row filtering and root-page ACL unit tests; AI-context deterministic provider exercised database/context minimization and ACL changes. | PASS for implemented service/context scenarios; not every name separately forced by the Agent model. |
| Page structure/collaboration reads | `getTable`, `listComments`, `listPageHistory`, `diffPageVersion`, `listTransclusionReferences`, `listPageAttachments`, `getPublicShareInfo` | Unit branches cover page/space mismatch, exclusions, safe actor/attachment metadata, collaboration-unavailable history diff, reference filtering, cursor binding, and public-share minimization. | PASS for those branches; partial live model coverage. |
| Template reads | `listPageTemplates`, `getPageTemplateMetadata`, `listPageTemplateUsages` | Unit coverage includes readable pagination and bounded usage counting; registry metadata is exact. | PASS for covered service branches; metadata tool not separately model-driven. |
| Current-page writes | `editPageText`, `patchNode`, `insertNode`, `deleteNode` | Structural operation unit suite covers all four, stable IDs, expected hashes, forbidden root/structural mutations, and size/depth bounds. Live deterministic model/approval applied `editPageText` only. | PASS for structural contracts and live text approval; partial live proposal coverage for the other three. |

Server-side prompt-injection resistance is independent of model output: the provider receives only the frozen effective tool catalog, registry lookup is exposure/policy-bound, readable targets are reauthorized by page/space, and write tools reject any page other than the run's current page. No page lifecycle, database, comment, share, media, network, arbitrary-code, or whole-document write tool exists in the built-in catalog.

## Browser, concurrency, and fault matrix

| Scenario | Check | Result | Evidence |
| --- | --- | --- | --- |
| Unsupported provider | Browser before capability test | PASS: Agent radio absent; after successful test it is enabled. | Final post-integration Agent run `20260811080036-e3d09ec4`. |
| Approval preview | Real browser + Playwright | PASS: page, before/after, TTL, warning, Approve/Reject are visible; editor remains unchanged and controls are disabled while waiting. | `output/audit/g04/screenshots/04-reject-preview-actions.png`; Agent runner screenshot `01-pending-approval.png`. |
| Keyboard | Playwright focus + Enter | PASS: focused native Approve control applies the decision. | Test-only commit `7c017c02`; final Agent run. |
| Reload/reconnect | Browser reload and app restart | PASS: pending approval reappears and remains decidable. | Agent transition journal. |
| Approve/reject/expiry/cancel/duplicate | API + browser + DB | PASS: distinct terminal results; duplicate returns 409; reject/expiry/cancel do not apply. | Agent transition journal and step assertions. |
| Initiator-only and role split | Two BrowserContexts | PASS: wrong user cannot decide; reader cannot produce a write proposal. | `browser-summary.json` reports two contexts. |
| Concurrent Yjs edit | Second BrowserContext | PASS: live change makes approval stale and preserves the other writer's content. | Agent E2E stale scenario. |
| Parallel proposals | Two pending proposals | PASS: first applies, second becomes stale; one mutation only. | Agent E2E parallel scenarios. |
| Lost profile/group permission | Live DB/API policy change after proposal | FAIL before fix / PASS after fix: before, terminal run failed but step was approved and applied; after, both fail before apply. | `profile-revocation-before-fix.json` and `profile-revocation-after-fix.json`. |
| Lost page write ACL | Live permission change | PASS: approval reauthorization blocks apply. | Agent runner and unit approval branches. |
| Structural document | Heading/list/table/code/embed/transclusion fixture | PASS: unsupported nodes unchanged and IDs/structure remain valid. | Agent screenshot and structural test suite. |
| Step/tool/result budgets | Deterministic model | PASS: `agent_step_limit`, `agent_tool_limit`, and `agent_result_limit`. | Transition journal. |
| Pending approval/provider slots | Unit/service concurrency contracts | PASS: pending approvals are bounded and do not consume provider concurrency; unavailable admission leaves approval unclaimed. | `ai-run.service.spec.ts`. |
| Redis/PostgreSQL interruption | Pinned Toxiproxy | PASS: Redis queued run recovers; failed PostgreSQL decision cannot fabricate a commit and remains decidable after recovery. | Transition journal and `toxiproxy-final-state.json`. |
| Already-applied reconciliation | Recovery contract | PASS at unit level: expected hash completes without replay; third hash fails stale. | `ai-run-step.service.spec.ts`. |
| Console/unhandled errors | In-app browser logs | PASS for inspected flow: only normal `ws connected` log records; no console error/unhandled rejection observed. | In-app browser log capture. |
| Secret/canary leakage | artifacts, traces, app logs, DB-safe summaries | PASS: final scanner reports `ok: true`, no findings. | `secret-scan.json`, application log scan, database summary. |

## Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G04-01 | High | Approval TTL / provider admission | Deterministic unit reproduction | Expected expiry to remain authoritative after waiting for a provider slot; actual code checked TTL only before waiting and could claim/apply an expired proposal. | The approval CAS did not include `expires_at > now()` and the post-admission path did not reclassify expiry. | Fixed in `c728ca7b`; regression test passes. |
| G04-02 | High | Profile/group policy / approved write recovery | Live deterministic reproduction | Expected a revoked profile/group write capability to block the decision; actual run eventually failed `agent_profile_policy_changed` after the step had already applied to Yjs. | Approved-step recovery rechecked built-in workspace/space policy but omitted `AiAssistantProfileService.assertRunProfileCurrent` before tool resolution/apply. | Fixed in `f6a95f8c`; live recheck shows `applied=false`. |
| G04-03 | Medium | Isolated Agent audit runner | Reproducible on a fresh compose project | Expected repository-native audit to boot a clean isolated runtime; actual runner lacked secret-derived DB/Redis wiring and collab startup, and synthetic key-by-key Yjs typing could lose a tail. | Compose audit overrides were incomplete and the browser fixture used timing-sensitive synthetic typing. | Fixed test-only in `7c017c02`; full clean runner passes and removes volumes. |

### G04-01 reproduction, fix, and acceptance

1. Keep a pending approval waiting for provider admission beyond `expiresAt`.
2. Release admission and call approve.
3. Before the fix, the pre-wait TTL check was stale and the claim path could proceed.
4. The fix adds expiry to the atomic claim predicate, captures the actual decision time, and uses the shared expire/classification path when the CAS loses.
5. Acceptance: expiry after admission wait returns the stable expired outcome and no tool resolution/Yjs apply occurs. The focused 9-test step suite and the complete AI suite pass.

No contract or schema migration changed. Rollback is the single production commit, but rollback would reopen an expired-write authorization window. The stable `agent_write_expired` code remains the operational signal.

### G04-02 reproduction, fix, and acceptance

1. Start a profile-bound writer run and wait for `pending_approval`.
2. Remove the write capability through the profile/group policy and increment the profile version.
3. Approve as the initiator.
4. Before the fix, the run ended `agent_profile_policy_changed`, but the write step was `approved`, `applied=true`.
5. The fix injects the profile service into the approval service and revalidates the frozen/live profile and group policy before resolving any approved write tool.
6. Acceptance after rebuild: run and step fail `agent_profile_policy_changed`, `applied=false`, and browser content remains the exact pre-revocation text.

The canonical AI documentation and all 12 embedded admin-guide locales now state the live ACL and policy recheck. No public contract or migration changed. Rollback would reopen a policy-revocation authorization bypass; the stable error code and failed step provide observability.

### G04-03 reproduction, fix, and acceptance

Fresh isolated runs failed before browser execution when generated DB/Redis secrets were not supplied to Compose, then failed the direct/file secret-source contract, and later lacked a reachable collab process. The runner now supplies generated secret-backed connection variables, explicitly starts collab with a reserved/published port, and uses one real contenteditable `fill` from the second BrowserContext for the concurrent Yjs mutation. The final clean run passed, produced 18 runs/54 steps, scanned clean, and removed its volumes.

This commit changes test infrastructure only. A Node `DEP0190` warning remains because the Windows runner invokes Playwright through `shell: true`; no untrusted value is passed in this audit, but removal belongs to test-runner hardening.

## Commands and results

Material commands are listed with their observed exit codes. Read-only `rg`, `git show`, `git log`, `docker inspect/ps`, SQL select, and artifact inspection commands also returned 0 unless explicitly noted.

| Command | Exit | Notes |
| --- | ---: | --- |
| `git status --short`; `git rev-parse HEAD`; `git describe --tags --always` | 0 | Baseline recorded before changes; only pre-existing `graphify-out/*` changes existed in main. |
| `git worktree add -b codex/g04-agent-approvals ../docmost-qa-G04 main` | 0 | Isolated branch created from current main. |
| `corepack pnpm install --frozen-lockfile` | 0 | Dependency graph unchanged. |
| `corepack pnpm --filter ./apps/server test -- --runInBand src/core/ai` | 1 | Baseline invocation forwarded `--` incorrectly and Jest ran in parallel: 41/42 suites, 619/620 tests; only DOCX extraction timed out under load. |
| isolated `ai-file.service.spec.ts` | 0 | 2/2 passed in 8.5 s, proving the preceding timeout was load/order-related. |
| `corepack pnpm --filter ./apps/server exec jest --config jest.config.cjs --runInBand src/core/ai` | 0 | 42/42 suites, 622/622 tests. |
| focused `ai-run-step.service.spec.ts` | 0 | 9/9 approval/recovery tests. |
| client localization/capability tests | 0 | 8/8 focused tests; the earlier full client run passed 131 files/632 tests. |
| `corepack pnpm --filter ./apps/server exec jest --config jest.config.cjs --runInBand src/common/helpers/prosemirror/ai-page-operation.spec.ts src/collaboration/collaboration.handler.spec.ts` | 0 | 2/2 suites, 17/17 structural/apply tests. |
| `corepack pnpm run test:ai-agent:e2e` | 0 | Final post-integration run `20260811080036-e3d09ec4`; two contexts, browser/fault/security matrix, clean scan, volumes removed. |
| `corepack pnpm run test:ai:e2e` with mock port 18084 | 1 | 23/24 passed; one neighboring G02 assertion hard-coded port 1080 although runner accepts `DOCMOST_AI_MOCK_PORT`. Product correctly showed configured 18084. |
| `corepack pnpm run test:ai:e2e` with expected mock port 1080 | 0 | 24/24 passed across Chromium, Firefox, Pixel 7, and narrow panel. |
| `corepack pnpm run test:ai-context:e2e` | 0 | Deterministic context/citation/ACL audit passed. |
| `corepack pnpm run test:security` | 0 | Server 66/66 suites and 790/790 tests; client 6/6 files and 74/74 tests. |
| `corepack pnpm server:build`, complete image build, and monorepo image build | 0 | Fixed server/client code built into the isolated image after each production fix. |
| `corepack pnpm check:comments:en` and focused lint/format checks | 0 | No source comment/lint regression. |
| live deployment-off/on and space null/empty/subset policy harness | 0 | Counts were 11/26 and 26/0/2 as expected; configuration restored to deployment on + space inherit. |

The initial 18084 AI suite failure is a test-harness portability dependency owned by the broader G02 suite, not a G04 product finding. No assertion or production behavior was changed to hide it; the compatible pinned-port rerun is recorded separately.

## Environment and external tools

| Tool | Provenance/version | Purpose and isolation | Data |
| --- | --- | --- | --- |
| Node.js / pnpm | Node `v24.16.0`; pinned `pnpm 10.4.0` | Repository scripts and deterministic local providers. | Synthetic G04 data only for custom model calls. |
| Playwright | Repository-pinned `@playwright/test` | Chromium/Firefox, two contexts, responsive and keyboard checks. | Synthetic pages/users; traces sanitized before retention. |
| Docker Desktop | 29.5.3 | Isolated `docmost-g04` and per-run compose projects; shared stacks were not mutated. | Separate PostgreSQL/Redis volumes. |
| Toxiproxy | official Shopify `2.12.0`, digest `sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e` | Local PostgreSQL/Redis interruption; final state restored with no toxics. | Synthetic protocol traffic only. |
| MockServer | `mockserver/mockserver` pinned digest `sha256:fed9b2089e021947f785d1f0bfda3723352bb2c1634ce7b0bcd42dfd1b0fd02f` | Local deterministic OpenAI-compatible responses for the broader AI suite. | Synthetic prompts/canary only. |
| PostgreSQL / Redis | pinned Compose digests for `postgres:18-alpine` and `redis:8-alpine` | Durable state, queue/recovery, and clean-migration proof in isolated volumes. | Synthetic G04 audit records. |
| In-app browser | existing signed-in desktop browser session | Visual approval UX, reload, console, and persisted live content. | Synthetic G04 pages only. |

No external LLM or SaaS received repository source, real page content, credentials, or canaries. The deterministic providers were local processes/containers. The supplied `.env.qa` values were loaded only into process environment when needed and were not copied into this report.

## Evidence

- Final Agent runner: `output/audit/ai-agent-mode-2026-08-09/20260811080036-e3d09ec4/`.
- Runner status: `runner-summary.json` (`passed`, `volumes-removed`).
- Browser/fault state: `browser-summary.json`, `transition-journal.json`, `toxiproxy-final-state.json`.
- Provenance and data counts: `container-provenance.json`, `provider-metadata.json`, `database-summary.json`.
- Secret checks: `secret-scan.json`, `application-log-secret-scan.json`.
- Before/after profile-policy reproduction: `output/audit/g04/profile-revocation-before-fix.json`, `output/audit/g04/profile-revocation-after-fix.json`.
- Visual evidence: `output/audit/g04/screenshots/01-profile-policy-revocation-blocked.png`, `03-approved-live-yjs.png`, `04-reject-preview-actions.png`.
- General AI rerun: `output/audit/g04/ai-assistant-rerun/`.
- Context/citation run: `output/audit/g04/ai-context/`.

Failed exploratory runner directories and credential-bearing temporary setup scripts are not publication evidence and are removed during final cleanup. `graphify-out/*` remains excluded from G04 commits.

## Verified no-defect scenarios

- Agent remains unavailable until the exact provider/model tool-calling capability is tested.
- Chat requests do not carry tool definitions; Agent requests use the frozen effective catalog.
- Space policy cannot widen workspace/deployment maximum; explicit empty is deny-all.
- Viewer and non-initiator paths fail closed.
- Approval preview persists through reload and does not unlock the editor.
- Reject, cancel, expiry, duplicate decision, stale hash, and lost ACL do not mutate the page.
- Structural IDs and unsupported nodes survive the approved text operation.
- Result sizes and run/segment budgets terminate with bounded, stable codes.
- Pending approvals do not consume provider slots.
- Redis/PostgreSQL interruption does not manufacture or duplicate a mutation.
- Catalog/UI display uses localized friendly names; raw identifiers require an explicit copy action.
- Secret scans found no canary, auth cookie, CSRF token, or extra synthetic secret in retained evidence.

## Limitations and remaining risks

1. A deterministic model did not separately invoke every one of the 26 names against allowed, denied, and deleted live objects. Registry/policy contracts and targeted service branches cover the security boundary, but the per-name live model matrix remains incomplete.
2. `patchNode`, `insertNode`, and `deleteNode` have structural unit coverage but were not each approved/rejected in a live browser. Only `editPageText` completed the full proposal → preview → keyboard decision → live Yjs path.
3. The exact process-kill window after Yjs apply and before terminal event was not forced live. The already-applied expected-hash path is directly unit-tested and the broader runner covers app restart plus Redis/PostgreSQL interruption.
4. Fresh migration-up was exercised by the isolated Agent runner. Migration down/up and destructive rollback were not executed against the retained shared test installation.
5. `verify:release` was not used as the primary proof because it requires additional production-like audit inputs outside the isolated G04 matrix. Its available AI/security/browser sub-stages were run separately; the final integration check is recorded after merge.
6. The Windows runner still emits Node `DEP0190` for `shell: true`. Inputs are controlled in this audit, but the harness should remove the shell dependency in a test-infrastructure follow-up.

These limitations keep the verdict at PASS WITH RISKS. They are coverage risks, not evidence of an unfixed production defect.
