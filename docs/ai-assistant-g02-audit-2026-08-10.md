# G02 core AI assistant audit - 2026-08-10

## 1. Verdict

**PASS WITH RISKS.** The G02 release surface is green after seven production fixes and two test-infrastructure fixes. The final deterministic browser gate passed 24/24 scenarios with no skipped, unexpected, or flaky tests. The restart/fault gate passed duplicate delivery, response-loss replay, queued recovery, stale-running recovery, slot release, and exact-secret scans.

No unresolved Blocker, High, or Medium G02 product finding remains. Residual risk is limited to environments not exercised by this contour: a real third-party provider, WebKit, physical mobile devices, assistive technology, and migration down/up on a disposable clone. The wider `verify:release` composite was not used as the G02 acceptance command because it includes separate AI context, Agent, RAG, collaboration, and production-runtime contours. Its G02-relevant sub-gates were run separately.

## 2. Fixed scope and implementation map

### Repository snapshot

- Release anchor: `v1.0.0` / `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Audit-history head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Initial local `main`: `e84852c524235c8a19aa0e6b65a9321099d106d7`, `v1.0.0-176-ge84852c5`.
- Audit branch: `codex/g02-ai-assistant`, created in `D:\DevProjects\docmost-qa-G02-current` from the then-current local `main`.
- The initial main worktree contained only pre-existing `graphify-out/*` changes. They were not staged, reverted, or overwritten.
- The older `D:\DevProjects\docmost-qa-G02` worktree and its dirty graph output were left untouched.

### Requested history reviewed

Each requested commit was inspected with `git show --stat --summary` and its patch, tests, contracts, documentation, and migrations where applicable:

| Commit | Reviewed effect |
| --- | --- |
| `3fe75316` | Built-in quick-prompt hardening |
| `c09ac7ba` | AI feature-flag and audit-exception alignment |
| `d12ae528` | Markdown-list formatting for built-in prompts |
| `218e3d39` | Initial assistant browser-audit harness and report |
| `08ec62e8` | Supported chat-file upload validation |

Earlier baseline lineage reviewed on relevant paths includes `81dfd697` (reliable per-space assistant) and `91841794` (contextual workflows). Post-audit-head path changes reviewed before editing include `77bfe89f` (external MCP group policy; neighboring owner), `4d9824ef` (notification queue leases; neighboring owner), `aa5b92e5` (Agent approval; excluded owner), and `d12a7596` (migration runner). Their fixes were preserved.

### Files and contracts reviewed

- Server controllers, DTOs, providers, queue processor, reconciler, prompt/context/config/conversation/run/file/event services, URL policy, operational metrics, and related tests under `apps/server/src/core/ai`.
- Client panel, composer, message cards, reasoning disclosure, activity state, React Query bindings, policies, local drafts, quick commands, settings, and localization under `apps/client/src/features/ai`.
- Shared AI contracts in `packages/api-contract/src/ai.ts`.
- Browser harness and specs in `apps/client/e2e/ai` and `apps/client/playwright.ai.config.ts`.
- Migrations `20260728T120000-ai-integration.ts`, `20260729T120000-ai-reliability.ts`, and `20260729T230000-ai-reasoning.ts`.
- `docs/AI_ASSISTANT_AND_RAG.md`, `docs/AI_INTEGRATION.md`, all maintained `ai.*` locale keys, and the embedded administrator guide.

### Runtime flow

1. `AiPanel` and the Markdown composer call the shared client service/React Query layer. Local draft text remains browser-local until send.
2. Authenticated controllers validate DTOs and CSRF-protected mutations. Conversation/file/run reads are scoped to the current workspace and user; page access is checked through the shared access services.
3. Services use Kysely transactions and PostgreSQL advisory locks to create immutable run attempts, enforce idempotency, reserve quota/concurrency, and persist monotonic sequence changes.
4. PostgreSQL stores encrypted per-space provider credentials plus `ai_space_configs`, private `ai_conversations`, `ai_messages`, immutable linked `ai_runs`, `ai_chat_files`, `ai_file_upload_batches`, and `ai_message_sources`.
5. BullMQ in Redis carries dedicated `ai-chat` work. The database remains authoritative; duplicate delivery and terminal-state fencing are enforced before provider work.
6. `AiChatProcessor` delegates to `AiRunExecutionService`, which calls the allowlisted OpenAI-compatible origin with bounded total and idle timeouts, parses SSE, separates reasoning from answer text, and persists usage.
7. `AiRunEventService` publishes user-room Socket.IO events. Client reducers reject duplicate/out-of-order sequences and refetch authoritative state after reconnect.
8. `AiQueueReconcilerService` re-enqueues queued rows missing a job and terminally resolves stale running rows after a 12-minute heartbeat threshold. It does not automatically repeat a provider call for a stale running attempt.
9. Chat files use bounded type/signature validation, private storage, at most 10 files, 25 MiB per file, 100 MiB per conversation, and 1,000,000 extracted characters. PDF extraction is capped at 20 pages by the parser path; stale extraction recovery uses a 10-minute threshold.

### Flags, limits, ACL, recovery, and observability

- Per-space switch: `ai_space_configs.enabled`.
- Network policy: exact-origin `AI_PROVIDER_ALLOWED_ORIGINS`; development-only loopback behavior was not relied on because the app ran in production mode.
- Stream policy: `AI_STREAM_IDLE_TIMEOUT_MS`, capped by the per-space request timeout.
- Generation limits: model, temperature, context window, output tokens, request timeout, daily requests per user, and daily tokens per space.
- Hard concurrency: one active run per conversation, six per user, and thirty per space.
- Input limits: 32,000 message characters, 10 files, 25 MiB per file, and 100 MiB per conversation.
- Secrets: provider credentials are encrypted at rest and public projections return only `apiKeyConfigured`.
- ACL: provider settings require space-management permission; ordinary chat requires a writable page; conversations/files are owner-private; user-room events do not broadcast chat content to another member.
- Recovery: idempotent create/send/upload, immutable retry/regenerate attempts, cancel fencing, queued reconciliation, stale-running terminalization, and terminal duplicate-delivery rejection.
- Observability: stable public error codes, structured run status/sequence, sanitized queue/application logging, `AiOperationalMetricsService`, and browser/fault evidence containing counts rather than secret values.

## 3. Environment and external tools

| Tool | Provenance and pin | Purpose and isolation | Data handled |
| --- | --- | --- | --- |
| Docmost isolated Compose project | Project `docmost-g02`; app image `docmost-g02:ba68c2b3`, digest `sha256:36f233b54c03cf431386b8b192fa04c56c8a2b1bb12b747426670f206b350b66` | Separate app, collaboration, PostgreSQL, Redis, storage, network, and ports `3002/3003`; shared `docmost` containers were not modified | Synthetic workspace, users, chats, files, and canaries only |
| MockServer | Official `mock-server` project, Apache-2.0; image `mockserver/mockserver@sha256:fed9b2089e021947f785d1f0bfda3723352bb2c1634ce7b0bcd42dfd1b0fd02f`; tag source commit `6fb02a58ba9f7c6648553aaf85625ff0344f1e53` | Local Docker process on the isolated test host; deterministic SSE, reasoning, delay, empty, malformed, disconnect, bad-key, timeout, and model-list responses; WARN logging for secret-safe evidence | Synthetic prompts and a synthetic provider canary only |
| Playwright | Repository-pinned dependency and `apps/client/playwright.ai.config.ts` | Chromium RU/EN, Firefox streaming/reconnect, Pixel 7 emulation, narrow assistant panel; one worker; two simultaneous browser contexts in the role test | Synthetic sessions and content; traces sanitized before retention |

No SaaS test service received source code, real credentials, or production data. Runtime auth values were loaded only into process memory. Raw MockServer/application logs were scanned in memory and not retained. The mock container was removed after each run.

## 4. Coverage matrix

| Requirement/scenario | Static/unit/integration | Browser/fault/security | Result and evidence |
| --- | --- | --- | --- |
| Provider create/edit/disable/test | DTO/config/provider tests and origin policy review | Owner used settings UI; invalid hostname, key, timeout, and absent model tested | PASS; `browser-final/playwright-results.json` |
| Persistent chat lifecycle | Conversation/run/message service review | Create, normal and 31,991-character prompts, rename, search, delete, draft reload, message cursor pagination | PASS; `browser-final/quota-pagination-evidence.json` |
| Streaming/reasoning/stop/retry/regenerate | SSE unit/integration tests; reducer sequencing tests | Chromium + Firefox stop, UI retry, reconnect/reload; reasoning disclosure and regenerate | PASS; 24/24 browser gate |
| Idempotent create/send | Advisory-lock and fingerprint review | Same HTTP request replay returned the same run/message; payload drift returned 409 | PASS; sanitized trace and network journals |
| Response loss after commit | Transaction/idempotency review | Client response deliberately abandoned; replay returned 202 and one persisted run | PASS; `fault-final/fault-recovery.json` |
| Duplicate Bull delivery | Terminal-state fencing review | Duplicate job injected after stale terminalization; status and sequence did not reopen | PASS; `fault-final/fault-recovery.json` |
| User/space concurrency | Admission logic and regression tests | Six user slots, thirty space slots, 409 overflow, cancel, then 202 | PASS; `browser-final/concurrency-evidence.json` |
| User/space quota | DTO and admission review | Fresh member: first request 202, second 429; one-token space budget returned 429 | PASS; `browser-final/quota-pagination-evidence.json` |
| Supported files | File/MIME/parser tests | Valid PDF, DOCX, and image plus multipart replay | PASS; browser file-boundary trace |
| Rejected files | Signature/size/count tests | Unsupported MIME/extension, spoof, empty, corrupt, oversized, and duplicate multipart | PASS; browser file-boundary trace |
| Vision/reasoning flags | Run/provider tests and client capability review | Vision-disabled selected visual input rejected by backend; reasoning disclosure shown only when enabled | PASS |
| Quick commands | Built-in prompt unit tests and commit review | Templates opened after reload; custom configured entry present; localized UI; built-ins verified as Markdown lists in unit/contract tests | PASS |
| Two roles and direct bypass | ACL and ownership review | Owner and writer contexts used simultaneously; both authorized for own chat, config bypass denied, cross-user conversation reads denied | PASS; two-role trace |
| Restart/recovery | Reconciler tests | Redis/server restart recovered queued run with one provider call; hard app stop produced `worker_lost`; slot released | PASS; `fault-final/fault-recovery.json` |
| Secret leakage | Credential, logger, queue-redaction tests | API/HTML/localStorage/sessionStorage, DB plaintext, Redis queue payloads, app/mock logs, traces scanned | PASS; zero findings |
| Responsive/localized UX | Locale contract tests | RU/EN desktop, Pixel 7, narrow overlay; screenshots and interaction state inspected | PASS with accessibility limitations below |

## 5. Commands and exit codes

### Repository and history

| Command | Exit |
| --- | ---: |
| `git status --short` | 0 |
| `git rev-parse HEAD` | 0 |
| `git describe --tags --always` | 0 |
| `git log --reverse v1.0.0^..e955a0c8 -- <G02 paths>` | 0 |
| `git log --reverse e955a0c8..HEAD -- <G02 paths>` | 0 |
| `git show --stat --summary` and full patches for requested/relevant commits | 0 |

### Build, unit, integration, security, and static checks

| Command | Exit and result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | 0 |
| `corepack pnpm --filter ./apps/server test -- --runInBand src/core/ai` | 0; 42 suites / 616 tests |
| `corepack pnpm --dir apps/client exec vitest run src/features/ai` | 0 after test fix; 29 files / 178 tests |
| `corepack pnpm run test:security` | 0; server 66 suites / 787 tests, client 6 files / 74 tests |
| `corepack pnpm run verify:quick` | 0; includes lint, 219 backend suites / 1,729 tests, client production build, and repeated security gate |
| `corepack pnpm --filter ./packages/api-contract build` | 0 |
| Targeted ESLint, `node --check`, and `git diff --check` for the audit harness | 0 |
| `corepack pnpm --filter ./apps/server exec tsc --noEmit` | 1; unrelated pre-existing Kysely typing errors in backend e2e fixtures, not the G02 production build |

### Browser, fault, and container checks

| Command | Exit and result |
| --- | --- |
| `docker compose build docmost` adapted to the isolated override/project | 0; production image built from `ba68c2b3` |
| `docker compose up -d docmost` adapted to `docmost-g02` | 0; app and collaboration healthy |
| `corepack pnpm run test:ai:e2e` with isolated runtime variables | 0 final; 24/24, 0 skipped/unexpected/flaky |
| `node apps/client/e2e/ai/run-ai-fault-audit.mjs` | 0 final |
| `apps/client/e2e/ai/sanitize-traces.mjs` and `scan-artifacts.mjs` through the runner | 0; 24 archives, 39 entries, 16,616 replacements, zero findings |

### Baseline/test-harness failures retained as evidence

- Before the localization-test correction, focused client AI was 177/178 because the test hard-coded 30 administrator-guide keys after neighboring commit `77bfe89f` added a fully translated 31st key. This was a false-positive test, not missing production localization.
- The broader client test command had a second unrelated baseline assertion: the de-DE root translation for `Inactive` did not match its English sentinel. It is outside G02 and was not changed.
- Early shared-stack browser attempts were invalidated by other contours recreating the shared app. Acceptance moved to the isolated `docmost-g02` project.
- Two pre-final retry runs failed only in newly added assertions: a strict locator matched multiple identical responses and MockServer matched an older delayed prompt in conversation history. The assertion was scoped to the actual response and the subsequent normal send moved to a new chat. The final full gate passed.
- Repeated synthetic invitation provisioning reached the isolated Redis IP throttle. Only the exact `invitationAccept` IP rate key in `docmost-g02` was deleted after its existence was verified; no Redis database was flushed.

## 6. Findings

| ID | Severity | Component | Reproducibility / expected vs actual | Root cause | Status / fix commit |
| --- | --- | --- | --- | --- | --- |
| G02-01 | Medium | Provider SSE | Deterministic: reasoning-only stream with reasoning disabled must fail as empty; it completed with an empty assistant answer | Hidden reasoning chunks incorrectly counted as visible output | Fixed: `5046e4bb` |
| G02-02 | High | Chat-file idempotency/recovery | Deterministic crash-window test: replay after committed reservation must resume; it stayed `processing` indefinitely | Transaction-scoped reservation lock ended before storage and terminal batch update; no replay owner could safely resume | Fixed: `b8cd40d3` |
| G02-03 | Low | Shared API contract | `fileIds`/`attachmentIds` on send appeared supported but were ignored after context API migration | Stale public TypeScript request fields | Fixed: `594b9531` |
| G02-04 | High | Run admission / DB pool | Reproduced under concurrent sends: admission must complete; pool deadlocked while locks were held | Locked transaction called context preparation through the root Kysely pool, requiring another connection while all connections waited on advisory locks | Fixed: `9b4258bc`; pre-fix evidence JSON |
| G02-05 | Medium | Vision capability | Selected image/image-only PDF with vision disabled must be rejected; backend silently omitted visual inputs and continued | Capability check ran too late and filtered unsupported input instead of rejecting it | Fixed: `4b4bd67c` |
| G02-06 | Medium | DOCX upload validation | Valid DOCX must retain canonical MIME; it was normalized to generic ZIP and then treated inconsistently | ZIP signature detection replaced the already trusted DOCX extension/MIME pair | Fixed: `62661ccd` |
| G02-07 | Medium | Production DOCX parser | Valid DOCX passed validation but production extraction failed with `loadAsync` undefined | CommonJS-bundled dynamic import exposed JSZip directly rather than under `.default` | Fixed: `ba68c2b3` |
| G02-08 | Low | Localization test | Complete 31-key guide failed an expected-count assertion of 30 | Stale test constant after neighboring MCP guide addition | Fixed test-only: `6cb5e3a1` |

### Finding details and acceptance

#### G02-01 - hidden-only stream

- Steps: configure reasoning disabled; return SSE containing only `reasoning_content` and `[DONE]`; wait for the attempt.
- Before: terminal `completed` with empty visible content.
- After: hidden chunks do not satisfy the visible-output invariant; stable empty-provider handling is used.
- Impact: misleading successful responses and broken retry UX; no cross-tenant effect.
- Acceptance: provider unit/integration suite and browser empty/malformed/disconnect scenarios pass.

#### G02-02 - interrupted upload replay

- Steps: reserve an idempotent multipart upload, interrupt after the database commit and before storage/terminal update, then replay the same request.
- Before: the batch remained `processing`; the replay could not safely own or resume it.
- After: a PostgreSQL session advisory lock covers reservation, storage, and terminal update; an identical replay resumes, while fingerprint drift remains rejected.
- Impact: persistent denial of a private conversation's upload key and orphaned recovery state; no credential exposure.
- Acceptance: new crash/replay and duplicate tests pass; valid/invalid/duplicate browser uploads pass.

#### G02-03 - stale send contract

- Steps: compile a caller using `SendAiMessageRequest.fileIds` or `.attachmentIds`; observe the server ignores them because context is updated separately.
- After: the misleading fields were removed without changing the wire route or database schema.
- Acceptance: API-contract build and client/server callers pass.

#### G02-04 - admission deadlock

- Steps: saturate concurrent send admissions; each transaction takes a user/space advisory lock and requests context through the root pool.
- Before: all pool connections could hold a lock while waiting for a second connection, preventing progress.
- After: context is prepared before the admission transaction and copied/persisted through the existing transaction.
- Impact: high-availability failure for concurrent chat traffic in one deployment; no data leak.
- Evidence: `output/audit/g02-ai-assistant-2026-08-10/pre-fix-advisory-deadlock.json`.
- Acceptance: 30-space-slot browser test and 616 AI server tests pass.

#### G02-05 - disabled-vision input

- Steps: upload/select an image, disable vision, and send.
- Before: request was accepted but the visual content was silently dropped.
- After: backend returns stable `ai_vision_required`; every locale maps it to a user-facing explanation and the administrator guide documents it.
- Impact: integrity/expectation failure; model could answer without material the user believed was included.
- Acceptance: server regression tests and browser rejection scenario pass.

#### G02-06 and G02-07 - DOCX pipeline

- Steps: upload a valid bounded DOCX in the production image and wait for extraction.
- Before G02-06: validation stored it as `application/zip`. After that correction, production extraction still threw because `loadAsync` was read from an absent `.default`.
- After: trusted DOCX retains the canonical Office MIME, and parser loading accepts either ESM default or CommonJS direct export.
- Impact: valid document chat context unavailable; no cross-user data exposure.
- Acceptance: signature/MIME unit test, real bounded DOCX extraction test, production image rebuild, and browser valid-DOCX upload pass.

#### G02-08 - false-positive localization gate

- Steps: run the focused client AI tests on initial main.
- Before: all locale keys were present, but the exact count asserted 30 instead of 31.
- After: the test matches the current complete guide surface.
- Acceptance: 29 files / 178 focused AI tests pass.

## 7. Scenarios checked without a product defect

- Provider secret create/replace/preserve/clear semantics and public projection.
- Exact-origin allowlist rejection, hostname resolution rejection, bad key, timeout, provider failure, missing model, and connection success.
- Normal streaming chunks, reasoning disclosure, cancel, UI retry, regenerate, reconnect, reload, and monotonic UI state.
- Conversation create/open/rename/search/delete, private ownership, long prompt, message pagination, and local draft restoration.
- Repeated create/send/upload requests, payload-drift conflicts, response loss, duplicate Bull delivery, and terminal immutability.
- Per-conversation, per-user, and per-space concurrency plus slot release after cancellation/failure.
- Daily request and token quotas with stable 429 error codes.
- PDF, DOCX, image, text/Markdown acceptance; unsupported, spoofed, empty, corrupt, oversized, duplicate multipart, and vision-incompatible rejection.
- Built-in Markdown quick prompts, custom command visibility/order contract, disabled entries, and RU/EN localization.
- Owner/writer simultaneous contexts, direct settings bypass denial, and cross-user conversation isolation.
- Redis/server restart, queued reconciliation, hard worker loss, stale-running terminalization, and no automatic second provider call.
- Canary absence from API, HTML, local/session storage, PostgreSQL plaintext, Redis job payloads, application logs, mock logs, and sanitized browser artifacts.

## 8. Limitations and residual risks

- WebKit, physical iOS/Android devices, screen readers, voice control, high-contrast modes, and browser zoom matrices were not exercised. Keyboard-accessible names and responsive screenshots were checked, but this is not a WCAG compliance claim.
- A real external OpenAI-compatible provider was intentionally not called; protocol behavior was tested against the deterministic pinned local implementation. Provider-specific deviations remain an integration risk.
- Migration source, ordering, constraints, backfills, and destructive `down` behavior were reviewed, but down/up was not executed because G02 changed no schema and the isolated runtime already carried the full current ledger.
- UTC-day boundary rollover for daily quotas and 90-day retention deletion were not time-travel tested.
- Agent mode, assistant profiles, built-in tool policy, external MCP, and expanded contextual/RAG behavior were inspected only at integration boundaries and remain owned by neighboring contours.
- The server Jest runner reports a force-exit/open-handle warning after all 616 AI tests pass. It did not change test results but remains a test-process hygiene risk.

## 9. Fix report, rollout, rollback, and observability

All production fixes are code-only; there is no public route change, migration, destructive backfill, or manual data repair.

| Fix | Production modules | Added/updated tests | Reverification | Rollout / rollback / observability |
| --- | --- | --- | --- | --- |
| Hidden-only stream | Provider service | Provider SSE regression | AI unit/integration + browser fault cases | Deploy with normal app image; revert `5046e4bb` if necessary; monitor stable empty-provider error codes |
| Upload recovery | File service, docs/locales | Crash/replay, fingerprint drift, upload boundaries | Server AI + browser files + restart audit | No schema action; revert `b8cd40d3`; monitor processing batches and extraction-terminal events |
| Send contract | API contract | Contract build/caller compile | API build + client build | Revert `594b9531`; no wire/database rollback |
| Admission deadlock | Run/context services | Root-pool deadlock regressions | 30-slot browser concurrency + AI/server gates | Revert `9b4258bc`; monitor active/queued runs and admission errors |
| Vision rejection | Run service, shared error contract, client locales/policy, docs | Capability rejection and locale mapping | Server/client/browser | Revert `4b4bd67c`; monitor `ai_vision_required` frequency |
| DOCX MIME | File validation helper | Office MIME/signature regression | Security/file/browser | Revert `62661ccd`; monitor extraction terminal codes |
| DOCX loader | File service | Real bounded DOCX parser regression | Production image + AI/browser | Revert `ba68c2b3`; monitor parser failure code, never raw document content |

Acceptance criteria were: focused unit/integration tests green; `test:security` and `verify:quick` green; production image rebuilt; browser 24/24 with clean traces and cleanup; fault/restart audit green with exactly one provider call in queued/stale scenarios; no canary or runtime credential retained.

No finding remains in an “unable to fix” state.

## 10. Evidence and commits

### Sanitized evidence

- `output/audit/g02-ai-assistant-2026-08-10/browser-final/playwright-results.json`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/playwright-html/`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/traces/`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/network/`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/console-errors/`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/screenshots/`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/concurrency-evidence.json`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/quota-pagination-evidence.json`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/security-surfaces.json`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/secret-scan.json`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/application-log-secret-scan.json`
- `output/audit/g02-ai-assistant-2026-08-10/browser-final/trace-sanitization.json`
- `output/audit/g02-ai-assistant-2026-08-10/fault-final/fault-recovery.json`
- `output/audit/g02-ai-assistant-2026-08-10/pre-fix-advisory-deadlock.json`

All retained evidence was sanitized and rescanned. No real credential value or synthetic canary is present in the report.

### Production commits

- `5046e4bb86c22b3eb7a28f476db266b2db2ca317` - `fix(ai): reject hidden-only provider streams`
- `b8cd40d3044f64f56022c20217a7682a3d9c5cb8` - `fix(ai): resume interrupted chat file uploads`
- `594b9531fe81018038f2eba5eddfd70d41a976f9` - `fix(ai): align send message contract with context API`
- `9b4258bc7451e6dde2137b00074ef7fab348abac` - `fix(ai): avoid admission lock pool deadlocks`
- `4b4bd67ccc6958a6bf5212cfec1ac04d2bfeb295` - `fix(ai): reject files that require disabled vision`
- `62661ccde1dcb7a9f9fa6f9352aa630291991c5e` - `fix(ai): preserve trusted DOCX mime type`
- `ba68c2b33c77944fbc4680dfb96eb18d377bf83a` - `fix(ai): load docx parser in production builds`

### Test-only commits

- `6cb5e3a1b53ef8911c0fc5507937bfcc96ae1912` - `test(ai): expand assistant reliability audit coverage`
- `8357bb81d5d31a3a55f0512bc11cbe19b6632c69` - `test(ai): cover quotas pagination and retry`

The report commit and the final local-main merge hash are recorded in the final audit handoff because a commit cannot contain its own resulting hash.

## 11. Post-merge acceptance and cleanup

- The G02 branch was merged into the then-current local `main` with merge commit `783f5c7313829fe1a5083d3d9eea220d23664282` (`v1.0.0-192-g783f5c73`). The intervening G16 merge was preserved; its path diff did not overlap the G02 production changes.
- A fresh production image was built from that merged code: `docmost-g02:783f5c73`, digest `sha256:44dc2eb8f2ce44e1b99c91aaf7541d4ea119f4657f750384d6a548423ceff282`.
- Post-merge `corepack pnpm run test:ai:e2e` passed 24/24 in 93.1 seconds with 0 skipped, unexpected, or flaky tests. The retained sanitized evidence is under `output/audit/g02-ai-assistant-2026-08-10/browser-post-merge/`; its secret scan covered 15 secret forms and found none, while trace sanitization processed 24 archives / 38 entries / 16,619 replacements.
- Post-merge `node apps/client/e2e/ai/run-ai-fault-audit.mjs` exited 0. Response-loss replay returned 202 with one persisted run; queued recovery completed at sequence 3 with one provider call; stale-running recovery ended at `worker_lost` sequence 2, duplicate delivery remained terminal, and all API/database/queue/application/mock secret counts were zero. Evidence: `output/audit/g02-ai-assistant-2026-08-10/fault-post-merge/fault-recovery.json`.
- Post-merge `corepack pnpm run verify:quick` exited 0 when run alone: 221 backend suites / 1,735 tests, client production build, 66 backend security suites / 787 tests, and 6 frontend security files / 74 tests. Jest still emitted the already documented force-exit/open-handle warning after passing.
- One earlier post-merge `verify:quick` attempt was invalidated because it ran concurrently with the focused server suite and the negative production-smoke child was terminated by the resource-constrained host. One browser setup attempt ran before the recreated application became healthy; one subsequent setup attempt correctly rejected the local mock until its exact origin was restored in `AI_PROVIDER_ALLOWED_ORIGINS`. These were environment/setup failures, not product acceptance results; the isolated reruns above supersede them.
- Before teardown, the exact Compose-labeled resources were verified as four `docmost-g02-*` containers, three `docmost-g02_*` volumes, and two project networks. `docker compose -p docmost-g02 ... down -v` then removed only those synthetic containers, networks, and volumes; follow-up label queries returned none. Retained filesystem evidence and the cached pinned images remain available, while the synthetic runtime data is intentionally unrecoverable.
- The final main worktree still contains only the five pre-existing `graphify-out/*` modifications. They were not staged, reverted, or overwritten.
