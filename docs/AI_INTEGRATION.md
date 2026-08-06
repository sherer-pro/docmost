# Built-in AI integration

Docmost provides a core, per-space OpenAI-compatible integration for private page conversations, document actions, file context, and optional retrieval from an external service. Chat history and runs are persisted; Socket.IO progress events are an optimization, while REST state remains authoritative after navigation or reconnects.

This is the operator setup and troubleshooting guide. The canonical
architecture, limits, security invariants, and recovery behavior are maintained
in [`AI_ASSISTANT_AND_RAG.md`](./AI_ASSISTANT_AND_RAG.md); the external sync
contract is maintained in [`RAG_API.md`](./RAG_API.md). Workspace owners and
administrators can also open `/settings/ai/guide` for the localized in-product
operation and risk summary. Relevant implementation changes must update that
guide together with the applicable Markdown documentation.

## Provider configuration

Each space has an independent record in `ai_space_configs`. Space administrators and workspace owners/admins can configure the provider base URL, chat model, generation limits, retention, vision, quick commands, and an optional retrieval adapter. Model and retrieval API keys are encrypted independently with the application credential-protection helper. API responses expose only whether each key is configured.

The same record stores the optional display identity through
`assistantNameEnabled`, `assistantName` (up to 80 characters), and
`assistantGender` (`masculine|feminine`). Names are trimmed and may contain
Unicode, punctuation, and emoji, but not line breaks, control characters, or
bidi controls. Enabling requires an effective non-empty name. Disabling restores
the standard localized title while retaining the saved name and gender; a null
name is accepted only while naming is disabled. Clients keep the name verbatim
and inflect only the localized generic role around it.

## Assistant profiles

Per-space assistant profiles are an optional layer over the same provider and
identity. They replace the admin-authored behavior instructions and may narrow
exact built-in/external tools or apply permitted model, temperature, and output
overrides. They cannot supply a URL, protocol, credential, header, retrieval
configuration, context window, retention rule, or quota.

Roll out profiles in this order:

1. Apply additive migration `20260805T100000-ai-assistant-profiles.ts` and deploy
   with `AI_ASSISTANT_PROFILES_ENABLED=false`.
2. Verify legacy no-profile Chat/Agent, then set the deployment flag to `true`.
3. In the space **Profiles** settings, enable the workspace switch. Enable the
   separate provider-override switch only when workspace policy permits it.
4. Create profiles disabled, configure exact tool IDs/group visibility, run the
   effective model test, and run the exact Agent test when Agent should be
   available. Enable the profile only after the tests succeed.
5. Assign a space default only after canarying profile selection, history,
   Retry/Regenerate, and live policy revocation.

Existing spaces receive no profiles and no default. Members may select an
available profile, store a preferred profile, or hide profiles from their own
picker. Conversation history exposes only the frozen display summary and
availability; instructions, model/tool policy, fingerprints, and secrets remain
admin-only or server-only. A profile can change only while a persisted
conversation has no messages or runs. `autoStart` sends its launch text through
the ordinary idempotent message endpoint, so it appears as a normal user
message.

Operational rollback is `AI_ASSISTANT_PROFILES_ENABLED=false` or the workspace
switch. Profile-bound history remains readable, new profile runs fail closed,
and legacy no-profile conversations continue. Do not run the down migration in
production because it deletes profile/audit snapshots.

The first provider implementation is OpenAI-compatible. An API key is optional so local endpoints such as LM Studio can be used.

Set `AI_PROVIDER_ALLOWED_ORIGINS` to a comma-separated list of exact trusted `http(s)` origins:

```dotenv
AI_PROVIDER_ALLOWED_ORIGINS=https://llm.example.com
```

Development additionally permits loopback endpoints, including `http://127.0.0.1:56254`, when the backend runs directly on the host. When Docmost runs in Docker Desktop, use `http://host.docker.internal:56254/v1` as the space Base URL and add `http://host.docker.internal:56254` to `AI_PROVIDER_ALLOWED_ORIGINS`; `127.0.0.1` inside the container points back to Docmost itself.

For example, if LM Studio listens on port `56254`, the host-run Base URL is
`http://127.0.0.1:56254/v1` and the Docker Desktop Base URL is
`http://host.docker.internal:56254/v1`. Select a model actually loaded by the
local provider. The port, URL, and model are examples, not application
defaults.

Streaming has two independent limits. The per-space `requestTimeoutMs` limits the complete provider request, including body consumption. `AI_STREAM_IDLE_TIMEOUT_MS` limits the time between any two bytes received from the provider SSE stream, including the wait for the first byte and reasoning-only or keep-alive frames. The idle timeout defaults to 120000 ms, accepts 5000-600000 ms, resets for every received stream chunk, and is capped by the per-space request timeout. Slow local reasoning models may use 300000 ms:

```dotenv
AI_STREAM_IDLE_TIMEOUT_MS=300000
```

Increasing the idle timeout does not extend the complete request timeout. Keep `requestTimeoutMs` large enough for the expected generation while retaining a finite upper bound.

## API and permissions

Space configuration and profile mutations require Manage Settings (or workspace
`owner|admin`); the profile policy route itself requires workspace
`owner|admin`. The profile list and current user's preferences require ordinary
space access and return no administrative profile fields:

- `GET/PATCH /api/spaces/:spaceId/ai/config`
- `GET/PATCH /api/ai/profile-policy`
- `GET/POST /api/spaces/:spaceId/ai/profiles`
- `GET/PATCH/DELETE /api/spaces/:spaceId/ai/profiles/:profileId`
- `POST /api/spaces/:spaceId/ai/profiles/:profileId/actions/test-model`
- `POST /api/spaces/:spaceId/ai/profiles/:profileId/actions/test-agent`
- `GET/PUT /api/spaces/:spaceId/ai/profile-preferences`
- `POST /api/spaces/:spaceId/ai/config/actions/test-model`
- `POST /api/spaces/:spaceId/ai/config/actions/test-agent`
- `POST /api/spaces/:spaceId/ai/config/actions/test-retrieval`
- `GET /api/spaces/:spaceId/ai/status`

The status endpoint accepts an optional `pageId`. Page-scoped calls return chat availability after the current write ACL check. Calls without `pageId` require full space access and include only aggregate daily request/token and active-run counts. Every status response also contains `assistantIdentity: {name, gender} | null`; page-scoped members receive it even when AI is disabled or temporarily unavailable, without any administrative configuration or secret fields.

Run the space-level `test-agent` action before enabling Agent mode. It forces a
tool-calling response for the effective provider, base URL, and model
fingerprint; a successful model-only test is not sufficient.

Authenticated writers use `/api/ai/conversations`, nested message/file endpoints, and `/api/ai/runs/:runId/actions/*`. Conversations are private to their owner. Both HTTP handlers and the background worker re-check conversation scope and page access; workspace administrators do not receive an endpoint for reading other users' prompts or answers.

Conversation context and selection-only editor actions use:

- `GET/PUT /api/ai/conversations/:id/context`
- `GET /api/ai/conversations/:id/context-sources`
- `POST /api/ai/editor-actions`
- `GET /api/ai/editor-actions/:id`
- `POST /api/ai/editor-actions/:id/actions/cancel`

Context updates are full, versioned replacements. An identical replay is idempotent; a conflicting stale `expectedRevision` returns `409 ai_context_revision_conflict`. Editor actions require a payload-bound `clientRequestId`, return `202`, and never create a conversation or message.

Public mutation idempotency is explicit:

- creating a conversation, sending a message, retrying, and regenerating require a `clientRequestId`;
- repeating a request with the same key and payload returns the original resource/run, while reusing the key with another payload returns `409 idempotency_key_reused`;
- multipart uploads require an `Idempotency-Key` header and return an upload batch; the batch key is bound to file order, names, sizes, and SHA-256 fingerprints;
- cancelling and deleting are repeatable. An owner receives the current terminal state/success on a repeated request, while another user's resource remains indistinguishable from a missing resource.

`GET /api/ai/conversations/:id` is read-only. Only `POST /api/ai/conversations/:id/actions/open` updates `lastOpenedAt`. List endpoints return `{ "items": [...] }`; message pagination additionally returns `hasMore` and `nextCursor`. An invalid cursor is a `400` validation error.

The right-side AI tab is part of the persistent application shell. Its open state, selected aside tab, and 300–600 px desktop width are stored in the user profile. Chat history, drafts, per-conversation context, space-search choice, and the most recently opened page conversation are stored server-side. The current document can be included or excluded, and up to ten explicit pages, databases, or database rows can be added by search or desktop drag-and-drop. Mobile uses a full-screen focus-trapped drawer and search as the context-selection fallback.

After the first successful assistant response, Docmost schedules one background title operation. It uses the first prompt and a bounded context summary, returns no more than four Unicode word segments or 80 characters, and publishes `ai:conversation.updated`. A manual rename always wins. After three provider failures, a deterministic title is derived from the first meaningful words without changing the successful chat response.

## Answer citations

New chat and agent answers use server-controlled source markers. The provider
receives `[S<n>]` markers for authorized documents, stable heading sections,
and files; Docmost validates and renumbers only genuine markers to `[C<n>]`
before persisting the visible message. Page citations link to the canonical
page route and append `#headingId` when the supporting section has a stable
ProseMirror `attrs.id`. File citations use authenticated download routes.

The UI renders the normalized markers as inline numbered links and lists either
**Used sources** or, when the provider supplied no valid marker, deduplicated
**Context sources**. During streaming unresolved source markers are hidden and
the terminal REST response is authoritative. Historical messages keep the
legacy source presentation. See [Citation contract](./AI_ASSISTANT_AND_RAG.md#citation-contract)
for candidate limits, retrieval matching, copy/apply behavior, and Agent tool
rules.

## Persistence, queues, and files

The canonical [AI and RAG migration ledger](./AI_ASSISTANT_AND_RAG.md#ai-and-rag-migration-ledger)
is the single inventory of schema changes, backfills, destructive `down`
operations, and operational rollback switches. Apply the ordered set with:

```bash
pnpm --filter ./apps/server migration:latest
```

Do not use `migration:down` as a feature rollback: several AI migrations delete
immutable attempt, citation, profile, policy, or encrypted integration data.
Use the deployment/workspace switches linked from the ledger unless a reviewed
database restore is intended.

Every provider call is a new `ai_runs` attempt. Retry and Regenerate never reopen or erase a terminal run: they create a row linked through `rootRunId`, `previousRunId`, and `attemptNo`. They are allowed only for the latest assistant turn; older turns return `409 ai_run_not_latest`. A terminal attempt is immutable, and its usage, error, response snapshot, and citations remain available for audit.

AI generation, auxiliary title/editor operations, file extraction, and hourly retention cleanup run on `AI_CHAT_QUEUE`. Search indexing has its own `SEARCH_QUEUE`; queue payloads contain only record IDs, and workers resolve current configuration and encrypted credentials from the database.

BullMQ delivery is at-least-once; database transitions are effectively-once. Run and auxiliary jobs use deterministic identities (`ai-run-<runId>` and `ai-aux-<runId>`; BullMQ custom IDs cannot contain `:`), and a worker can claim each record only with an atomic `queued -> running` compare-and-set. Completion, failure, and cancellation are compare-and-set terminal transitions. The sequence is incremented in the same transaction as persisted state.

PostgreSQL is the source of truth when Redis is unavailable. A successfully admitted Send remains `queued` even if the initial `queue.add()` fails. A lifecycle-managed reconciler starts only after database migrations are ready, re-delivers missing deterministic jobs, resumes pending file work, and retries storage cleanup. Runs that cannot be delivered within five minutes fail with `queue_unavailable`. A running attempt without a heartbeat for 12 minutes is preserved as partial output and fails with `worker_lost`; it is never automatically sent to the provider again.

Admission uses transaction-scoped PostgreSQL advisory locks in the stable space/user/conversation order. Each provider attempt consumes a daily request. Queued/running attempts reserve estimated input plus maximum output tokens; terminal attempts account for actual usage. The partial unique active-run index remains the final one-run-per-conversation barrier.

By default, a space permits 100 requests per user per day, 2,000,000
input/output tokens per day, one active run per conversation, six per user, and
thirty per space. Conversations expire after 90 days. Deletion first commits
database tombstones and cancellation requests, then retriable cleanup removes
private storage; hard purge happens only after cleanup. Agent approval recovery
and the distinction between pending-approval and provider-slot limits are
defined in the canonical architecture document.

Private chat uploads support PDF, DOCX, TXT, MD, JPEG, PNG, and WebP. Limits are 10 files, 25 MiB per file, and 100 MiB per conversation. Upload batches move through `processing|completed|failed`; deterministic file IDs/storage keys and SHA-256 fingerprints make retries safe. Extraction claims only uploaded, non-deleted `pending` files with compare-and-set, so duplicate jobs cannot extract twice and deletion cannot be reverted to `ready`.

TXT/MD are decoded directly, DOCX uses `mammoth`, and PDF text uses `pdfjs-dist`. A textless PDF may be rendered for a configured vision model, up to 20 pages and the run's context/image budget. Existing page attachments are selected separately and their owning-page ACL is checked again by the worker.

Socket.IO emits monotonic `ai:run.delta`, `ai:run.status`, `ai:editor-action.delta`, and `ai:editor-action.status` events only to the owning `user-*` room. Conversation title changes use `ai:conversation.updated`. The database and REST API remain authoritative: clients ignore duplicate sequences and refetch after a gap or reconnect.

The client feeds REST results, deltas, status events, and reconnect recovery through one pure run-state reducer. Only active runs remain in ephemeral streaming state; a terminal run is pruned after persisted messages are refetched. Draft writes are serialized so an older response cannot replace a newer draft.

`AiOperationalMetricsService` keeps process-local, content-free aggregates for queue wait, first-token and total duration, cancel latency, attempt numbers, terminal statuses, reconciled jobs, retrieval outcomes, and file lifecycle transitions. Metrics and logs never include prompts, generated bodies, credentials, or remote response bodies; production deployments can export these aggregates through their existing monitoring boundary.

## Prompt and editor safety

The editor sends a Markdown document snapshot plus a SHA-256 hash of canonical editor JSON. It does not send TipTap JSON as model context. A selection is the primary document context; the enabled current document is the fallback. `AiPromptBuilderService` allocates context in this order: system/safety instructions, current prompt, selection/current document, explicit page/database/row snapshots, selected files, the latest complete user/assistant turns (at most 20 messages), then optional retrieval. It excludes the current turn and never starts history with an orphan assistant message.

For ordinary chat runs, the worker reads the current space configuration at
execution time and appends an authoritative identity directive after the space
instructions. Its JSON-encoded `displayName` and `grammaticalGender` are treated
as data: the model must use the name verbatim without translating,
transliterating, or inflecting it, and use the selected gender for
self-reference. This applies to new Send, Retry, and Regenerate attempts without
changing request fingerprints or historical messages. Conversation-title and
selection-only auxiliary prompts intentionally do not receive the identity.

The worker resolves every explicit source with current workspace/space/deletion/ACL checks before first use and stores immutable Markdown in `ai_run_context_sources`. Retry and Regenerate copy those snapshots instead of reading changed pages. Databases contribute their description and only readable rows within the shared budget. Every page that actually contributed content is recorded in `ai_run_source_dependencies`; losing access to any dependency hides the complete derived assistant response.

Selection AI captures the page ID, selected range/text, and canonical editor hash before focus leaves the editor. Its auxiliary run receives only the command and selection, without chat history, files, or retrieval. Replace/Insert actions require explicit confirmation, a current write check, and the unchanged hash. A stale result remains copyable but cannot mutate the editor.

Insert/Replace re-checks AI/page write availability immediately before mutation. If the canonical snapshot is unchanged, Insert uses the captured cursor or selection end; it never silently appends to the document end. A changed editor/page requires a fresh confirmation and uses only the current cursor. Generated Markdown and links remain sanitized.

## Optional external retrieval

The AI integration does not create a local embedding table or require pgvector. The existing `/api/rag/*` API remains the read-only, space-scoped synchronization surface for an external indexer. Query-time retrieval is a separate optional outbound adapter.

Each space selects exactly one retrieval mode:

- `none`;
- `http-json-v1`, the existing custom JSON contract;
- `open-webui-knowledge-v1`, a dedicated Open WebUI Knowledge Base.

The `http-json-v1` URL, key, and wire contract remain unchanged. Switching
adapters does not clear the inactive adapter's URL, Knowledge ID, or encrypted
credential, so rollback is a configuration change rather than a migration. In
production, every configured retrieval origin must be listed in
`AI_RETRIEVAL_ALLOWED_ORIGINS`:

```dotenv
AI_RETRIEVAL_ALLOWED_ORIGINS=https://rag.example.com
```

Development additionally permits loopback retrieval endpoints. As with the model provider, a container must use a host-reachable address instead of `127.0.0.1`.

Docmost sends `POST` to the configured URL itself; the adapter does not append a path. The optional Bearer credential is independent from the API key used to synchronize `/api/rag/*`.

```json
{
  "schemaVersion": 1,
  "requestId": "019...",
  "workspaceId": "019...",
  "spaceId": "019...",
  "pageId": "019...",
  "query": "What changed in the launch plan?",
  "allowedPageIds": ["019..."],
  "sourceTypes": ["page", "database_row", "attachment"],
  "limit": 8,
  "candidateLimit": 40
}
```

The response contract is:

```json
{
  "items": [
    {
      "sourceType": "page",
      "sourceId": "019...",
      "pageId": "019...",
      "text": "Candidate text returned by the external index",
      "score": 0.91
    }
  ]
}
```

The serialized request is limited to 1 MiB. The adapter accepts at most 40 candidates, 16 KiB of UTF-8 text per candidate, and 256 KiB for the complete response. Candidate source/page IDs must be UUIDs. Malformed candidates are discarded individually, duplicates are reduced to the best score, and valid siblings remain usable. The configured top-K is 8 by default and may be set from 1 to 20.

For `open-webui-knowledge-v1`, configure the Open WebUI origin (for example,
`https://open-webui.example.com`, without `/api`), a pre-created Knowledge ID,
and a query-only API key. Docmost posts a fixed request to
`/api/v1/retrieval/query/collection`:

```json
{
  "collection_names": ["knowledge-id"],
  "query": "What changed in the launch plan?",
  "k": 40,
  "hybrid": false
}
```

The adapter maps the first `documents`, `metadatas`, and `distances` arrays to
the same internal retrieval hits. Open WebUI metadata must contain a versioned
Docmost descriptor under `metadata.data.docmost`; `metadata.docmost` is accepted
only as a compatibility fallback. Open WebUI 0.9.6 may return only `file_id` in
the vector metadata, so Docmost hydrates each unique candidate from
`GET /api/v1/files/:fileId` and reads the canonical descriptor from
`file.meta.data.docmost`:

```json
{
  "schemaVersion": 1,
  "workspaceId": "019...",
  "spaceId": "019...",
  "sourceType": "page",
  "sourceId": "019...",
  "pageId": "019...",
  "sourceUpdatedAtMs": 0,
  "contentHash": "sha256"
}
```

The adapter drops malformed, cross-workspace, and cross-space neighbors
individually. A non-empty result without any compatible metadata is reported as
`retrieval_invalid_response`; an empty collection is a successful empty search.
External titles and URLs are never trusted.

Docmost explicitly disables Open WebUI hybrid search for this adapter. The
external reranker is not part of the integration contract, and an unhealthy
global hybrid-search configuration must not make ordinary vector retrieval
unavailable.

`apps/rag-sync` is the optional writer for Open WebUI 0.9.6. It reads only the
API-key-scoped `/api/rag/*` feeds, stores checkpoints/mappings/space locks in a
separate Redis namespace, and uploads files with `knowledge_id`, `file_hash`,
and the Docmost metadata above. It never reads the Docmost database and never
uses backend queues. Run it explicitly with
the `rag-sync` profile in the main `docker-compose.yml`; Compose builds it from
`Dockerfile.rag-sync`. Use `docker compose --profile rag-sync up -d --build` to
build and start the complete local stack. Without the profile, the primary
Compose stack does not start the writer.
Configure the writer through `RAG_SYNC_*` values in the same root `.env` used
by Docmost. Compose forwards only those values to the writer. One writer
container maps one Docmost space to one pre-created Open WebUI Knowledge Base;
use a separate service/container with its own environment for another mapping.
The RAG key created for the selected space is authoritative: the writer obtains
its `workspaceId`, `spaceId`, Open WebUI base URL, and Knowledge Base ID from
`/api/rag/scope`. Configure the `open-webui-knowledge-v1` retrieval adapter in
the space AI settings; these non-secret values are not repeated in `.env`.
Restart the writer after changing its Open WebUI destination.

Release publishing produces both the main image and the companion
`shererpro/docmost:rag-sync-<VERSION>` image. The moving production tags are
`shererpro/docmost:latest` and `shererpro/docmost:rag-sync-latest`, and they are
updated only after both immutable images have been pushed successfully. A
production Compose deployment should keep the writer in a separate optional
profile with no published ports. It may share the backend Redis service when
the writer uses a dedicated logical database such as `/1` and the isolated
`docmost:rag-sync` prefix.

External results are candidates, not authorization decisions. Docmost resolves every returned ID against its own database, maps rows and attachments to their owning page, rejects deleted and cross-space sources, re-checks the requesting user's current page access, and constructs trusted titles and URLs locally. A run records whether retrieval was not requested, disabled, used, empty, or failed. A timeout, malformed response, authorization/rate-limit error, server error, or a result set with no currently readable sources does not fail the chat: generation continues with the live document and selected files, and the UI shows the retrieval outcome.

An external indexer normally uses two independent credentials:

- a space-scoped Docmost API key to synchronize content through `/api/rag/*`;
- an adapter credential stored by Docmost to query the external retrieval URL.

Open WebUI deployments use a third security boundary: the writer credential in
the `apps/rag-sync` environment is separate from the query credential encrypted
in `ai_space_configs`. Environment values are visible in Docker container
metadata, so restrict Docker daemon access and never commit the populated
`.env`. Secret values must not be placed in logs, jobs, or metrics.

## Built-in Agent and inbound MCP tool policy

The Agent loop and inbound `/mcp` endpoint share one access-aware built-in tool
registry, but they remain different security surfaces: Agent is bound to a
private conversation and may create one of the existing current-page proposals,
while inbound MCP is API-key-only and read-only. The catalog, capability IDs,
result limits, and approval invariants are canonical in
[`AI_ASSISTANT_AND_RAG.md`](./AI_ASSISTANT_AND_RAG.md) sections 2 and 6.

Optional built-in reads are closed at the deployment boundary by default:

```dotenv
AI_BUILTIN_TOOL_EXTENSIONS_ENABLED=false
```

Enabling the environment switch only raises the deployment maximum. It does
not grant a capability to a workspace, space, Agent run, or MCP key. Complete
the rollout in this order:

1. Set `AI_BUILTIN_TOOL_EXTENSIONS_ENABLED=true` and restart the backend.
2. As a workspace owner or administrator, open `/settings/ai/spaces` and enable
   the built-in tool policy with an exact capability selection. The same
   workspace policy panel is also visible on `/settings/ai/external-tools`.
3. In `/settings/ai/spaces/:spaceSlug`, use the **Tools** section to inherit the
   workspace list or replace it with a narrower exact space list. An empty list
   disables all built-in tools for the space; inheritance never widens the
   workspace maximum.
4. Re-run the provider Agent tool-calling test when provider verification is
   not current, then start a new Agent conversation run. Existing paused runs
   are intentionally not projected onto a changed registry or policy.
5. For inbound MCP, create or update a key on `/settings/keys/mcp` and select a
   non-empty subset of the effective space capabilities. RAG keys reject this
   field.

Existing data is conservative: legacy Agent runs see only the original Agent
catalog, and existing MCP keys keep exactly the seven baseline read
capabilities. Adding a tool to a UI category never grants it automatically,
because saved policies contain exact capability IDs rather than category names.

Page-template discovery adds three optional read-only capabilities:
`page.templates.list`, `page.template.metadata.read`, and
`page.template.usages.read`. They expose metadata and readable same-space
usages only; marker, snapshot, live-insert, and detach write tools are not
registered. The page-template system/workspace/space/group policy must also
permit the read at call time.

Policy and access are checked again during execution. A policy or registry
version change ends an affected Agent run with `agent_tool_policy_changed`.
The check runs before and after every provider model turn, including a final
  answer without tool calls, so an in-flight revocation cannot be bypassed;
  profile-aware retry or regenerate preserves the source snapshot and reruns
  every live check. MCP `tools/list` and
`tools/call` use the same policy resolver and read the authoritative API-key row
on every request, so revocation requires neither a token reissue nor a server
restart.

For emergency rollback, remove selected optional capabilities or set
`AI_BUILTIN_TOOL_EXTENSIONS_ENABLED=false`; the legacy deployment maximum then
remains available subject to the saved workspace, space, and key allowlists.
Turning off the workspace master switch is the broader containment option and
disables its legacy capabilities as well. Stored policies and run snapshots
remain in place, and neither rollback path requires a schema rollback or key
reissue.

The workspace policy response separates `allowedCapabilities` (the saved exact
selection), `maximumCapabilities` (the current deployment ceiling), and
`effectiveCapabilities` (their active intersection after the master switch).
The settings UI preserves saved optional selections while the deployment
extension switch is off and labels them as inactive instead of silently
deleting them.

## Outbound external MCP servers

This lets the internal agent call read-only tools on remote MCP servers. It is
the opposite direction from the inbound `/mcp` endpoint and shares no
configuration or credentials with it. Canonical detail lives in
[`AI_ASSISTANT_AND_RAG.md`](./AI_ASSISTANT_AND_RAG.md) section 7; this section
covers only operator setup.

Two environment keys, both off by default:

- `AI_EXTERNAL_MCP_ENABLED` — deployment kill switch. While `false` the feature
  is unreachable no matter how a workspace, space, or user is configured.
- `AI_MCP_ALLOWED_ORIGINS` — comma-separated exact `http(s)` origins. Independent
  from the provider and retrieval allowlists. A workspace administrator can
  narrow this list but never widen it: an origin must appear here **and** in the
  workspace allowlist.

Setup order, each step owned by a different role:

1. An operator sets `AI_EXTERNAL_MCP_ENABLED=true` and lists the origins.
2. A workspace administrator turns on the master switch at
   `/settings/ai/external-tools`, narrows the deployment allowlist with the
   editable workspace allowlist, adds a server, runs Test and Discover, approves
   individual tools with a description each, then enables the server.
3. A space administrator binds the server to a space and optionally narrows the
   tool list and adds prompt hints.
4. Each user opts in from the AI composer. Absence of a stored preference is
   opt-out, so nothing is sent outward until a user explicitly agrees. Saving
   preferences replaces the complete set; omitted bindings are disabled.

Operational notes:

- **Loopback is rejected in production**, and accepted in development only when
  both allowlists name it. Testing against a local MCP server therefore needs a
  LAN or container address listed in both places, which is the same dual-approval
  path that private ranges use.
- Use read-only credentials on the remote side. An administrator marking a tool
  read-only records a Docmost-side classification; it is not proof that the
  remote server has no side effects.
- Emergency rollback is flipping `AI_EXTERNAL_MCP_ENABLED` to `false`. Cached
  clients close, and configuration and encrypted headers are preserved.
- Membership, all policy gates, and policy/config versions are re-checked during
  an active remote call and immediately before accepting its response. Revoking
  access aborts the connection instead of waiting for the remote timeout.
- Rotating `APP_SECRET` invalidates stored request headers; they must be
  re-entered.

## Security properties

- Never store AI credentials in `spaces.settings`, logs, WebSocket events, or queue payloads.
- Validate provider and retrieval origins through the shared outbound URL policy while retaining independent allowlists and error codes, reject credentials and unexpected redirects, and re-check resolved addresses.
- Re-check conversation ownership and page access in both HTTP handlers and background workers.
- Emit private generation events only to the authenticated user's Socket.IO room.
- Treat external candidates as untrusted and build citations only after resolving source metadata and current page access server-side.
- Apply generated text to an editor only after explicit user confirmation and a fresh page/write-access check.

Provider streaming stores `delta.content` and, when reasoning display is
enabled, compatible `delta.reasoning_content` or `delta.reasoning` fields.
Redirects are rejected, full-request and idle timeouts start before DNS
resolution and remain active until the response body is consumed, cancellation
aborts URL resolution/header waits/body reads for streaming and agent tool
requests, and remote response bodies are never copied into client-facing errors
or logs. JSON responses are limited to 4 MiB; SSE frames to 256 KiB; undecoded
SSE buffers to 1 MiB; and cumulative generated content to 8 MiB.

Core per-space AI is the only document-generation UX. The retired AI Answers routes, embedding table, legacy indexing queue, editor Ask AI menu, and workspace `settings.ai.generative` toggle are not part of the current implementation.

The client uses one Markdown sanitizer and safe-link policy for chat and selection results. `Copy` is always available for a normal assistant response. Replacing the original selection requires the same page and document snapshot hash; inserting below uses the original position only while that hash still matches. After the document changes, the chat flow may offer an explicitly confirmed insert at the current cursor, while selection-only actions become copy-only.

All core AI strings use explicit `ai.*` locale keys in every supported locale. Stable server error codes are resolved through a guarded localized fallback and never expose translation keys or remote provider messages. Service Worker cache version 3 loads `/locales/*` with a network-first strategy so an online client does not retain an older translation bundle.
