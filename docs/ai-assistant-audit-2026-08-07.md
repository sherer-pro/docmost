# Core AI assistant audit — 2026-08-07

## Executive result

The DTO, provider adapter, persistence, queue, realtime event, client state, Markdown composer, localization, and credential-projection paths were reviewed. Targeted AI tests and both production builds pass. No new reproducible AI product defect was confirmed during this audit.

The browser result is not a clean release gate. The latest retained run completed 4 of 13 scenarios and was invalidated by concurrent recreation of the shared Docmost container. An earlier repeat completed 6 of 9 scenarios, including streaming cancellation, reload recovery, Firefox reconnect smoke, Russian and English desktop rendering, Pixel 7, and the narrow panel. The deterministic suite now contains 14 scenarios, but the new credential-surface scenario was added after the last authenticated run and has only passed lint, type-check, and Playwright discovery.

The test space and synthetic audit administrator are intentionally retained because the browser run failed. The space identifiers are recorded in `output/audit/ai-assistant-2026-08-07/audit-state.json`; remove both after the clean rerun. The temporary provider allowlist override was removed, the MockServer container was removed, and the normal Docmost container returned healthy with HTTP 200.

## Scope and implementation map

### Contracts and configuration

- `UpdateAiSpaceConfigDto` validates provider identity, URL, model, generation limits, timeouts, context window, quick commands, retrieval, vision, and reasoning boundaries.
- `AiConfigController` exposes authenticated per-space `GET`, `PATCH`, and connection-test actions. The global CSRF guard protects mutations.
- `AiConfigService` authorizes settings management, applies the provider URL policy, encrypts provider and retrieval secrets, preserves a secret when omitted, clears it only through an explicit clear flag, and returns only `apiKeyConfigured` booleans in the public projection.
- Provider/profile snapshots and fingerprints prevent a queued or approved run from silently switching to a different provider origin or policy.

### Chat, queue, persistence, and realtime delivery

1. The conversation controller creates and reads private conversations scoped to the authenticated user and workspace.
2. Message creation persists the user message and run with request/idempotency fingerprints.
3. BullMQ dispatches `ai-chat` work to `AiChatProcessor` and `AiRunExecutionService`.
4. `OpenAiCompatibleProviderService` parses bounded OpenAI-compatible SSE, separates reasoning from answer text, enforces total and idle timeouts, supports cancellation, and maps upstream failures to stable `AI_ERROR_CODES` without returning remote bodies.
5. Partial answer and reasoning content are persisted with monotonic run sequences. Cancel, retry, regenerate, stale-worker reconciliation, and terminal-state updates are guarded in the database.
6. `AiRunEventService` emits user-room Socket.IO events (`ai:run.delta`, `ai:run.status`, and conversation updates). The client socket bridge feeds the reducer, ignores duplicates/out-of-order events, and refetches authoritative state after reconnect.
7. React Query owns server state, Jotai owns panel/activity state, and local draft helpers keep composer text separate from persisted chat state.

### Client behavior and errors

- The composer uses a TipTap Markdown round-trip, sanitizes pasted content, distinguishes Enter from Shift+Enter and IME composition, and persists local drafts.
- Reasoning is rendered through a separate disclosure and never merged into answer Markdown.
- Built-in and custom quick commands share localized labels and deterministic ordering.
- `AI_ERROR_CODES` is the shared contract; client localization tests require every code to resolve to a user-facing error in every maintained locale.
- Activity state is derived from non-terminal runs and remains visible outside the open panel.

## Commit inventory

The requested path log, grep log, and `git diff 0aeaa431..HEAD` were executed. The current committed diff covers 185 AI files and 53,522 inserted lines. The relevant lineage is:

| Commit | Purpose |
| --- | --- |
| `81dfd697` | Reliable per-space assistant baseline |
| `eaa1192d` | Reasoning display |
| `6526ea19` | Chat context and streaming UX |
| `b2e82258` | Space settings redesign |
| `91841794` | Contextual assistant workflows |
| `196d1e1d` | Assistant identity, context, and RAG sync |
| `4c33b619` | Markdown chat composer |
| `a5971d56` / `b8f2a9fb` | Markdown UX revert and exact reapply |
| `92ec1e84` | Composer redesign |
| `702df422` | Context manager and composer redesign |
| `c398cdb0` | Empty provider response recovery |
| `3fe75316` | Built-in quick prompt hardening |
| `2f420cbb` | Built-in tool localization |
| `c1fc49da` / `6ff72253` | Settings navigation and layout |
| `cb20905a` | Composer profile controls |

Later related work includes assistant profiles, built-in/external tools, citations, the administrator guide, RAG sync, source-access fencing, and usage statistics. The full command output remains available from the audit task transcript; the durable report records the commits that materially define this feature.

## Deterministic provider

The runner pins MockServer `7.4.0` by immutable Docker manifest:

`mockserver/mockserver@sha256:fed9b2089e021947f785d1f0bfda3723352bb2c1634ce7b0bcd42dfd1b0fd02f`

The upstream repository is owned by `mock-server`, the tag resolves to source commit `6fb02a58ba9f7c6648553aaf85625ff0344f1e53`, and the project is Apache-2.0 licensed. References: [LLM response mocking](https://www.mock-server.com/mock_server/llm_response_mocking.html) and [Docker image](https://hub.docker.com/r/mockserver/mockserver).

Raw expectations provide normal SSE, `reasoning_content`, empty `[DONE]`, malformed SSE, delayed output, and forced socket close. A unique synthetic canary is generated for each run and is never read from a real provider credential.

## Automated coverage added

- `apps/client/playwright.ai.config.ts` defines Chromium RU/EN, Firefox streaming, Pixel 7, and narrow-panel projects with video and explicit per-test trace collection.
- `apps/client/e2e/ai/run-ai-audit.mjs` provisions an isolated space/page, configures the pinned mock, runs Playwright, sanitizes artifacts, scans secrets, and removes successful data while retaining failed state.
- Browser specs cover chat lifecycle, Markdown and keyboard behavior, draft reload, quick commands, reasoning/regenerate, search/delete, image/unsupported file, empty/malformed/disconnected providers, stop/reload/reconnect, localization, responsive layouts, and credential surfaces.
- Network journals store only method/path/status/failure text. Console output is redacted before persistence.
- Trace archives are sanitized before publication. Application and mock logs are scanned in memory; only occurrence counts are written.
- DTO tests now cover invalid model/generation boundaries, timeout, context/output limits, excessive quick commands, and valid documented boundaries.

Run with:

```text
DOCMOST_AUTH_TOKEN=<runtime-only> DOCMOST_CSRF_TOKEN=<runtime-only> DOCMOST_AI_PROVIDER_BASE_URL=http://host.docker.internal:1080/v1 corepack pnpm test:ai:e2e
```

The cookie values must be supplied only to the process environment. They must not be written to `.env`, Playwright storage state, reports, or shell transcripts.

## Test results

### Unit and integration

| Check | Result |
| --- | --- |
| Client AI Vitest | **PASS**, 28 files / 166 tests |
| Targeted server DTO/config/provider Jest | **PASS**, 4 suites / 51 tests |
| OpenAI-compatible HTTP/SSE integration | **PASS**, normal stream, cancellation, delay/idle behavior, malformed and empty responses, reasoning |
| Client ESLint for AI E2E | **PASS** |
| Client `tsc --noEmit` | **PASS** |
| Playwright discovery | **PASS**, 14 tests / 5 projects |
| Client production build | **PASS** |
| Server production build | **PASS** |
| `check:ai-docs` | **PASS**, 20 critical routes / 14 migrations |
| `check:env` | **PASS** |
| `check:comments:en` | **PASS** |
| `routes:inventory:check` | **FAIL**, unrelated route inventory drift in the shared dirty tree |
| `verify:full` | **FAIL outside AI**, 200/204 server suites and 1579/1594 tests passed; page create/move/convert and collaboration persistence failed |
| Separate `test:security` | **FAIL outside AI**, 64/65 server suites and 745/753 tests passed; only `page.service.move.spec.ts` failed |

The full server run included passing AI provider, DTO, queue, run, source-access, prompt-builder, MCP, and conversation suites. The failing full-pipeline tests are not caused by the AI audit changes and were not modified.

### Browser matrix

| Scenario | Evidence status |
| --- | --- |
| RU desktop layout and basic assistant controls | **PASS** in retained run |
| EN desktop layout and basic assistant controls | **PASS** in retained run |
| Pixel 7 layout | **PASS** in retained run |
| Narrow AI panel | **PASS** in retained run |
| Streaming stop, next message, reload recovery | **PASS** in earlier repeat; latest run interrupted by shared-container recreation |
| Firefox offline/reconnect smoke | **PASS** in earlier repeat |
| Markdown draft survives reload | **PASS checkpoint** before later provider failure |
| Create, auto-title, rename, search, delete | **INCOMPLETE** because provider/container interruptions prevented a full terminal sequence |
| Reasoning disclosure and regenerate | **INCOMPLETE** in browser; provider and component unit coverage passes |
| Supported image | **PASS checkpoint**; image appeared in the context picker |
| Unsupported file localized error | **INCONCLUSIVE**; no stable visible error was captured before timeout |
| Empty/malformed/slow/disconnected provider | **PASS at provider integration level**; browser terminal error assertions were invalidated by environment restarts |
| Workspace admin / space admin / editor / viewer | **CODE AND UNIT VERIFIED; BROWSER MATRIX INCOMPLETE** |
| API/HTML/storage credential-surface spec | **ADDED, NOT RERUN** after the final authenticated run |

Latest retained Playwright result: 4 expected, 9 unexpected, 0 flaky, duration 405.9 seconds. Evidence includes 13 traces, 13 videos, 22 screenshots, 412 redacted network entries, and 34 warning/error console entries.

## Credential and privacy review

### Product surfaces

- Config service tests confirm that secrets are encrypted at rest, replacement/clear semantics are explicit, and public API values contain only `apiKeyConfigured`.
- Provider tests confirm that remote error bodies are not exposed.
- Conversation service ownership checks and user-room event delivery keep persistent chats private.
- The added browser security scenario directly asserts that the canary, auth cookie, and CSRF cookie are absent from the config API body, page HTML, local storage, and session storage.

### Evidence surfaces

Raw Playwright traces include browser cookie headers by design. The first scanner pass detected 11,453 credential-pattern occurrences in raw trace resources. This is an evidence-pipeline defect, not evidence that Docmost rendered provider secrets to the client.

The runner now sanitizes every text/network trace entry before publication. The retained result records 13 archives, 25 modified entries, and 8,575 replacements. The final generic JWT/cookie/Bearer scan reports zero findings. Exact canary and runtime-cookie scanning is built into the runner and executes while those values still exist in process memory. Raw trace archives must never be copied or published before this sanitation step.

No provider-key leak was confirmed in HTML, public API projections, retained local evidence, sanitized logs, or redacted network journals. Because the new direct browser-surface spec was not rerun after it was added, this conclusion remains supported by service tests and sanitized retained evidence rather than a single clean end-to-end release-gate run.

## Findings and classification

### Product

- No new reproducible AI product defect was confirmed.
- The initial client baseline expected 27 `adminGuide` keys while locales contained 28. The working tree already corrected that test drift; the current AI client suite passes 166 tests. This was a test-maintenance defect, not missing runtime localization.
- The unsupported-file feedback remains a product risk, not a confirmed defect, until reproduced in an uncontended run.

### Test infrastructure — fixed in this change

1. Raw traces retained authentication material. Added trace sanitation plus recursive archive scanning.
2. MockServer's status endpoint returned 404 even when ready. Readiness now accepts any completed HTTP response from the bound port.
3. Generic expectations shadowed fault cases. Explicit priorities now route reasoning, empty, malformed, delay, and disconnect markers deterministically.
4. Per-test locale mutation invalidated the synthetic login session. Locale coverage now uses isolated browser projects.
5. The runner now resolves the compose app container and scans application logs without persisting raw logs.

### Environment

1. The backend correctly rejected the mock origin until `AI_PROVIDER_ALLOWED_ORIGINS` temporarily included `http://host.docker.internal:1080`. The override was removed after testing.
2. Repeated provisioning hit the Redis login-IP rate limit. One exact ephemeral audit key was removed; no broad Redis flush was performed.
3. The shared `docmost-docmost-1` container was externally recreated during the latest run. Docker reported recreation rather than an application crash; requests failed with `ERR_EMPTY_RESPONSE` during that window.
4. The deployed image intermittently returned 404 for source routes present in the checked-out source, consistent with image/source drift during parallel work.
5. The dirty worktree changed during the audit. Current non-AI route-inventory and page/collaboration tests fail independently of this feature.

### External provider/mock

- No MockServer product defect was confirmed. The pinned server matched prioritized normal, reasoning, malformed, empty, delayed, and disconnect expectations.
- A forced close intentionally produces an incomplete HTTP exchange; assertions must use the persisted Docmost terminal state, not the mock's client-facing status alone.

## Role review

Static and unit review confirms the intended boundaries:

- Workspace admin/owner can manage workspace AI policies and per-space configuration.
- Space admin can manage AI settings only where `Manage Settings` is granted.
- Editor/writer can create private chat runs for a writable page but cannot manage provider settings.
- Viewer/reader cannot use the write-chat path; read/agent access remains subject to the configured AI/profile/content policies.
- Conversation rows and files are user-owned, and Socket.IO delivery targets the authenticated user room.

The four-role browser matrix must be repeated in a dedicated environment before release sign-off; this audit does not claim a clean browser result for all four roles.

## Files and evidence

Primary implementation:

- `apps/client/playwright.ai.config.ts`
- `apps/client/e2e/ai/`
- `apps/server/src/core/ai/dto/ai.dto.spec.ts`
- `apps/client/package.json`
- `package.json`

Retained evidence:

- `output/audit/ai-assistant-2026-08-07/playwright-results.json`
- `output/audit/ai-assistant-2026-08-07/playwright-html/`
- `output/audit/ai-assistant-2026-08-07/traces/`
- `output/audit/ai-assistant-2026-08-07/playwright-artifacts/`
- `output/audit/ai-assistant-2026-08-07/screenshots/`
- `output/audit/ai-assistant-2026-08-07/network/`
- `output/audit/ai-assistant-2026-08-07/console-errors/`
- `output/audit/ai-assistant-2026-08-07/secret-scan.json`
- `output/audit/ai-assistant-2026-08-07/trace-sanitization.json`
- `output/audit/ai-assistant-2026-08-07/audit-state.json`

## Release decision and remaining work

The AI unit/integration layer and builds are suitable for review, but this is **not a clean browser release sign-off**. Repeat the 14-test browser suite in an uncontended deployment with four pre-provisioned role sessions. Require 14/14, a clean exact-secret scan, and deletion/restoration in `finally`. Then rerun `routes:inventory:check`, `verify:full`, and `test:security` after the unrelated page/collaboration worktree failures are resolved.
