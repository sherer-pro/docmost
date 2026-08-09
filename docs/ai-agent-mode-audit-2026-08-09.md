# AI Agent mode audit — 2026-08-09

## Scope and evidence

This audit covers the bounded Agent mode from request admission through provider execution, approval, live Yjs application, recovery, and client presentation. It also covers the built-in and external MCP registries, workspace/space policy intersection, migrations, queue reconciliation, and deterministic browser/fault scenarios.

The implementation history was traced from `81dfd697` (reliable per-space assistant), `aa685338` (bounded Agent mode and read-only MCP), and `8f28d9c0` (external MCP), including the follow-up commits `5d5ea104`, `ceb03a75`, `bced4386`, `53216116`, `2c6c4d08`, `7d9a4b3c`, `9452e245`, `1dda5764`, `d285c7c6`, `d2896fbc`, and `ac79826e`.

The schema ledger inspected by this audit is:

- `20260728T120000-ai-integration.ts`: conversations, messages, runs, files, and per-space provider configuration.
- `20260729T120000-ai-reliability.ts`: durable run state, attempts, idempotency, queue and recovery metadata.
- `20260730T140000-ai-agent-mcp.ts`: bounded steps, approval state, write proposals, hashes, and read-only MCP API keys.
- `20260803T120000-ai-external-mcp.ts`: external server catalog, approved tools, space bindings, opt-in, and snapshots.
- `20260805T100000-ai-assistant-profiles.ts`: profile restrictions and frozen run profile data.
- `20260805T110000-ai-builtin-tool-policy.ts`: workspace policy, nullable space narrowing, API-key narrowing, versions, and JSONB constraints.

Runtime evidence is written under `output/audit/ai-agent-mode-2026-08-09/<run-id>`. The final full run is `20260809121814-4b121a74`: it passed, removed its isolated volumes, recorded 18 runs and 54 steps, and produced an empty secret-scan finding list. A successful run includes Playwright results, screenshots, transition journal, provider metadata, database counts, Toxiproxy state, container provenance, and a secret-scan result. Prompts, cookies, credentials, and raw authorization headers are not retained.

## Confirmed defects and fixes

1. Document and request fingerprints used ordinary `JSON.stringify`, so semantically identical objects with different key insertion order could produce different hashes. A shared canonical serializer now recursively sorts object keys while preserving array order. Document hashes, run/aux/context idempotency fingerprints, assistant profile fingerprints, and policy snapshot fingerprints use it.
2. A nullable space built-in policy was decoded as an empty capability list. `NULL` now means inherit the workspace policy; an explicit empty JSON array remains deny-all.
3. Built-in and external MCP policy services pre-stringified structured values before binding them as JSONB. Postgres.js encoded the string again, and the real space-policy endpoint violated its `jsonb_typeof(...) = 'array'` constraint. All AI policy/admin JSONB writes now bind structured values through `postgresJsonb`.
4. An individual built-in tool result exceeding `maxResultBytes` was reported as a generic invalid tool call, while cumulative overflow used `agent_result_limit`. The registry now raises a typed limit error and execution maps both paths to the stable public `agent_result_limit` code.
5. Approval, rejection, expiry, cancellation, ownership, and duplicate-decision behavior lacked direct regression coverage for several CAS branches. Targeted tests now assert initiator-only decisions, expiry, atomic reject, duplicate approve recovery exactly once, and cancellation of an awaiting run (`run=cancelled`, `step=expired`, `errorCode=cancelled`).
6. There was no deterministic full-browser Agent runner. The new runner uses a local OpenAI-compatible provider, two BrowserContexts, the project collaboration stack, an isolated Compose project, and the pinned official Toxiproxy image.

## Contract conclusions

- A write tool creates a `pending_approval` step and cannot apply content before an initiator decision.
- Approval ownership is checked before the proposal is disclosed. Approval/rejection transitions use database compare-and-set behavior; a duplicate decision returns conflict and does not repeat the side effect.
- Approval rechecks current editor permission, frozen tool policy, page identity, and live document hash. Revoked edit access fails closed. A concurrent Yjs edit produces `agent_write_stale` and preserves the other user's change.
- Approved-step recovery is deterministic: base hash applies once, expected hash is recognized as already applied, and any third hash fails stale. A PostgreSQL advisory lock serializes recovery for a page.
- PostgreSQL is the run-state authority. Queue job identifiers are deterministic; a Redis outage after the database transition leaves recoverable queued work, and a Redis delivery without a usable database transition cannot manufacture a side effect.
- Built-in MCP exposure contains read-only tools only. A direct write-name invocation is rejected before execution. External MCP results cannot become Agent write steps. Chat mode provider requests contain no tool definitions.
- Effective built-in capabilities are the intersection of deployment availability, workspace policy, nullable-or-narrowing space policy, profile, API-key scope, and current page/space authorization. A policy version/fingerprint change during execution or approval fails closed.
- Live application uses the existing collaboration stack and validates the resulting ProseMirror/Yjs structure, stable node identity, and unsupported-node preservation.

## Browser and fault matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Successful proposal and approval | PASS | No persisted or live side effect before approval; one approved step and one text application after approval. |
| Reject, expiry, cancel, double decision | PASS | Terminal step codes are distinct; duplicate approval returns conflict; cancellation expires the proposal. |
| Wrong approver and revoked edit permission | PASS | Non-initiator receives not-found; permission recheck prevents application. |
| Concurrent page edit | PASS | Second BrowserContext edits live Yjs; approval fails `agent_write_stale`; concurrent text remains. |
| Tab close/reopen and worker restart | PASS | Pending approval is restored and remains decidable after application restart. |
| Parallel proposals | PASS | Same base hash; first applies and the distinct second proposal becomes stale. |
| Redis/PostgreSQL faults | PASS | Redis queued run recovers once; failed PostgreSQL decision leaves the proposal pending and decisive after recovery. |
| Workspace/space policy changes | PASS | Space narrowing removes write tools; workspace version change stops the in-flight run with `agent_tool_policy_changed`. |
| Chat versus Agent catalogs | PASS | Provider metadata records no tools for Chat and only the frozen effective catalog for Agent. |
| Viewer behavior | PASS | Viewer receives permitted read behavior but creates no pending write proposal and cannot modify the page. |
| Complex document | PASS | Heading, rich text, list, table, code block, embed, and transclusion fixture remains schema-valid; unsupported nodes are unchanged. |
| Step, tool, and result limits | PASS | Separate terminal codes: `agent_step_limit`, `agent_tool_limit`, and `agent_result_limit`. |
| Pinned fault infrastructure and artifact scan | PASS | Toxiproxy digest is verified from container provenance; the artifact scan reports no exact secret, JWT/cookie pattern, or canary. |

## Remaining risks

- `verify:full` is not a clean repository-wide pass in the current shared worktree. Architecture, release-gate, environment, AI documentation, build, and all 209 server suites (1,642 tests) passed, but the client localization contract found 31 administrator-guide keys while its concurrently edited test still expects 30. The Agent changes do not modify that test or add the extra guide key, so this audit leaves the unrelated localization work untouched and records the full gate as BLOCKED rather than PASS.
- A clean database currently requires the migration CLI to run before the application starts because a module bootstrap hook may query a newly introduced table before the application's migration bootstrap completes. The isolated audit runner performs this production-compatible pre-migration step. This is outside the Agent mode write path but remains a fresh-install startup-order risk.
- The deterministic provider validates the OpenAI-compatible contract and controlled failures; it does not certify behavior specific to every third-party provider implementation.
- The isolated matrix is the release evidence. The existing `http://localhost:3000` deployment was intentionally limited to non-mutating provenance/smoke checks and was not reconfigured or restarted.

No release pass should be inferred from unit tests alone. A run is acceptable only when its runner status is `passed`, cleanup reports `volumes-removed`, and `secret-scan.json` reports an empty finding list.
