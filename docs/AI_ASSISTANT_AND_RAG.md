# AI assistant, smart search (RAG), and MCP

This document describes the current core AI architecture in Docmost: page-bound
chat, conversation context, background runs, space retrieval, and integration
with external RAG indexes and assistants. It also separates four related but
distinct paths:

1. **Query-time retrieval** finds sources while the AI assistant is answering.
2. **RAG API** (`/api/rag/*`) is a read-only export and synchronization API for
   external indexes. It does not answer retrieval queries itself.
3. **Agent mode** lets the private assistant call bounded Docmost tools and
   propose safe current-page changes that require explicit user approval.
4. **MCP** (`/mcp`) exposes the read-only subset of the same tool registry to
   external assistants through stateless Streamable HTTP.

All HTTP paths below include the global `/api` prefix except `/mcp`, which is
an explicit root-level protocol endpoint.

## 1. System components and boundaries

Core AI lives in `apps/server/src/core/ai`, the client UI lives in
`apps/client/src/features/ai`, and shared TypeScript contracts live in
`packages/api-contract/src/ai.ts`.

Each space has a separate `ai_space_configs` record; AI configuration is not
stored in `spaces.settings`. The record contains OpenAI-compatible provider
settings, encrypted credentials, retention policy, limits, enabled features,
and external retrieval configuration. Conversation, message, run, file, and
source-snapshot tables are the source of truth for history and execution. The
queue is not a state store.

The main components are:

| Component                                | Responsibility                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `AiConversationService`                  | private user conversations in page context, messages, and drafts                      |
| `AiContextService`                       | versioned conversation context and source-access validation                           |
| `AiContentPolicyService`                 | shared space exclusions for AI context, editor actions, retrieval, and the RAG API    |
| `AiRunService` / `AiRunExecutionService` | immutable attempts, limits, idempotency, execution, and streamed response persistence |
| `AiPromptBuilderService`                 | bounded prompt assembly from history, context, files, and retrieval results           |
| `OpenAiCompatibleProviderService`        | requests and streaming against an OpenAI-compatible provider                          |
| `AiRetrievalService`                     | safe query-time retrieval and reauthorization of returned sources                     |
| `AiFileService`                          | uploads, text extraction, images, tombstone deletion, and chat-file cleanup           |
| `AiAuxRunService`                        | auxiliary jobs for automatic conversation titles and editor-selection transforms      |
| `AiToolRegistryService`                  | access-aware tools shared by agent mode and the read-only MCP surface                  |
| `AiRunStepService`                       | initiator-only approval, safe Yjs application, history, and agent resumption           |
| `McpController` / `McpApiKeyAuthGuard`   | stateless Streamable HTTP adapter and MCP-key-only authentication                      |

Execution uses `AI_CHAT_QUEUE`. BullMQ delivery is at least once, so a worker
atomically claims a specific `ai_runs` row from `queued` to `running`; a
terminal attempt is never reopened. Deterministic job IDs, compare-and-set
transitions, ordered event sequences, and the reconciler close the
PostgreSQL/Redis boundary without automatically repeating a stale provider
call.

## 2. AI assistant flow

### Normal chat response

1. Opening the panel or choosing **New chat** creates only a local draft. The
   draft text and mode flags are stored in `sessionStorage`, scoped by
   workspace, user, and page. An empty draft never creates a database row.
2. The first meaningful action (send, private-file upload, or context change)
   creates exactly one private conversation bound to the `pageId`, using the
   current `agentMode` and `useSpaceSearch` flags. Concurrent first actions
   share one in-flight creation promise.
3. A send creates the user message, a pending assistant message, and an
   immutable `ai_run` attempt. `clientRequestId` binds the idempotency key to
   the request payload; reusing the key with a different payload is rejected.
4. The server validates AI availability, the current user, page binding, page
   write access, quotas, and concurrency. At most one run per conversation,
   six per user, and thirty per space may use or reserve a provider slot at the
   same time. A run waiting for user approval does not consume that slot.
5. The worker claims the run, resolves the context snapshot and files, and,
   when `useSpaceSearch` is enabled, resolves external retrieval results.
6. `AiPromptBuilderService` keeps only server policy, space-admin instructions,
   and assistant identity in the trusted `system` role. Document snapshots,
   selections, files/images, and retrieval excerpts are JSON-marked as
   untrusted reference data in the final `user` message, with the actual user
   request last. Budgets are derived from `contextWindow` and
   `maxOutputTokens`, so oversized sources are truncated.
7. The provider returns a text stream. Text and, when enabled, reasoning deltas
   are buffered, periodically persisted, and sent over Socket.IO.
   `ai_runs.sequence` provides a monotonic ordering key for the client.
8. On success, usage, response/reasoning snapshots, and citations are stored.
   The first successful response may schedule a separate title job limited to
   four Unicode word segments. A manual rename always wins. On failure or
   cancellation, both the message and attempt receive a terminal status.

Retry and regenerate create linked new attempts instead of rewriting the
original attempt. Retry operates on a run; regenerate operates on an assistant
message. Cancellation records a request that the worker checks during
streaming and terminates the attempt as `cancelled`.

### Agent mode

Agent mode is a per-conversation opt-in and is disabled for a space by default.
A space administrator must first run the tool-calling capability test against
the currently configured provider, base URL, and chat model. The test forces a
known tool call and records a configuration fingerprint only when the response
is structurally valid. Changing those provider fields invalidates the
fingerprint and disables agent mode until it is tested again.

An agent run resolves the same initial conversation context, private files,
page attachments, and optional query-time retrieval as normal chat. It may then
perform at most eight model steps and sixteen total tool calls. Each tool result
is limited to 32 KiB, and all results in one run are limited to 128 KiB. An
invalid tool response, an unknown tool, or a limit violation fails closed.

The shared registry exposes these read tools to both the agent and MCP:

- `search`, `getTree`, and `getPageContext`;
- `getPage`, `getOutline`, `getNode`, and `searchInPage`.

Every read is constrained to the run/key space, current user or key creator,
page ACL, deletion state, and the shared AI content-exclusion policy.

Agent mode additionally exposes `editPageText`, `patchNode`, `insertNode`, and
`deleteNode`. These tools never apply a model response directly. A call may
only target the conversation's current page, requires the initiator's current
write access, and creates one pending proposal with a content hash. The run
enters `awaiting_approval`; only its initiating user may approve or reject that
specific proposal, and the proposal expires after one hour. Approval rechecks
ACL and the live Yjs document hash, validates the resulting ProseMirror
document against the editor schema, applies one transaction, and records
`Changed by AI agent` in page history. A stale or rejected proposal is returned
to the model as a tool result so the bounded loop can continue.

Pending proposals have a separate admission limit of six per user and thirty
per space. Approval obtains the same PostgreSQL admission locks as a new run.
If no provider slot is available, the proposal remains pending and the client
receives the existing retriable concurrency error. An approved step reserves
that slot until the run is atomically returned to `queued`, preventing two
concurrent approvals from bypassing the limit.

At proposal time the server also creates `approvalPreview` for the target
page and operation. It contains the page title, explicit before/after text,
the anchor and insert position where applicable, and a `truncated` flag.
Each text fragment is capped at 4,000 characters. The preview is stored in the
existing step `result` JSON and is not reconstructed from untrusted model
arguments by the client.

Safe writes cover text, ordinary text/list/heading/callout blocks, rich-text
marks, and sanitized links. Page creation, page move/delete, databases and
tables, comments, shares, whole-document replacement, media nodes, external
images, arbitrary code execution, and external MCP servers are not agent
tools.

### Context, files, and editor actions

Conversation context has a revision. The current document is stored separately
from up to ten manual roots (`page`, `database`, or `database_row`). A page root
has an `AiDescendantSelection`:

- `none` includes only the root;
- `all` dynamically resolves every accessible descendant on each new send;
- `selected` stores explicit descendant page IDs and does not automatically
  include new pages.

Selection supports arbitrary nesting. A checkbox selects only the specific
page and never selects its branch implicitly.

Before a run is created, roots are expanded, checked against page ACL and the
content policy, deduplicated by backing `pageId`, and limited to fifty unique
resolved sources including the current document. When dynamic expansion exceeds
the limit, no run or messages are created and the server returns
`ai_context_resolved_source_limit` with `resolvedCount`, `limit`, and
`rootPageIds`. The current document remains primary context; its descendants
are normal explicit, citable sources. Enabling the current document merges or
removes a manual source with the same `pageId`. Disabling it allows that page
to be added manually.

Chat files and page attachments retain separate limits of ten and twenty.
Context updates include `expectedRevision`; conflicts return
`ai_context_revision_conflict`. Every run stores an allowed context snapshot,
which makes retries reproducible without allowing lost access to expose or
reuse derived data.

Private multipart uploads require an `Idempotency-Key` header. Supported types
are PDF, DOCX, TXT, Markdown, JPEG, PNG, and WebP. Limits are ten files,
25 MiB per file, and 100 MiB per conversation. Text extraction is asynchronous.
Images are sent to the provider only when `visionEnabled` is true. Deletion
first commits a database tombstone and then performs retryable storage cleanup.

Untrusted document parsing has additional worker budgets. DOCX extraction is
limited to 25 MiB per ZIP entry, 100 MiB decompressed total, 10,000 entries,
and 60 seconds. AI PDF rendering is limited to 20 pages, 8192 pixels per side,
16,777,216 pixels per page, 67,108,864 cumulative pixels, 10 MiB of PNG output,
and 60 seconds. At most two heavy parse/render operations run concurrently;
loading documents, render tasks, and canvases are released on every exit path.

An editor selection transform (`editor_transform`) is an `ai_aux_run`. It uses
the selected text and a page-snapshot hash and streams its result, but it does
not create chat messages or change chat history.

The selection action stays inside the active editor toolbar: the persistent
toolbar when fixed-toolbar mode is enabled, or the contextual bubble toolbar
otherwise. Commands and generated results open in a modal dialog, and the
editor remains inert until that dialog is closed.

### Shared content exclusion policy

A space administrator may store up to one hundred page rules in
`ai_space_content_exclusions`. A rule excludes either only the selected
document or the document and its current subtree. The effective set is
resolved through a recursive CTE bounded by `MAX_PAGE_TREE_DEPTH`. Its
fingerprint is calculated from sorted effective `pageId` values, so moving a
page across an excluded subtree boundary also changes the fingerprint.

Exclusions apply to current and manual conversation context, page attachments,
editor actions, AI space search/query-time retrieval, every live/detail/export
RAG route, and all MCP tools. Normal Docmost search and private chat files are
unaffected. Chat remains available on an excluded current page without page
context, while editor actions are disabled. The full-page space settings expose
these rules in the dedicated **Knowledge access** section. Adding and removing
rules persists immediately and is intentionally separate from the section Save
button used by provider and behavior configuration.

When the policy changes, affected active contexts are reconciled, their
revision is incremented, and `ai:content-policy.updated` is emitted. Old
messages and snapshots remain visible, but `prompt_history_cutoff_at` prevents
them from entering future prompts. Retry and regenerate copy only allowed
snapshots. A source with an excluded dependency is omitted as a whole.

## 3. Smart search during an answer

### Enablement and data flow

`useSpaceSearch` requests retrieval for a send, but retrieval is available only
when the space has a configured adapter. `AiRun.retrievalOutcome` is one of
`not_requested`, `disabled`, `used`, `empty`, or `failed`. Retrieval failure
does not fail generation; the model continues with available document and file
context.

Before an external request, the server obtains the user's current
`getSidebarAccessSnapshot`. Allowed page IDs are sent only to `http-json-v1`.
Regardless of adapter output, every candidate is revalidated against the
database, workspace, space, deletion state, current page ACL, and content
policy before its excerpt enters the prompt or becomes a citation. An external
index is therefore never an authorization authority and cannot expand user
access.

An external request is bounded to forty candidates, eight final results by
default, 16 KiB of text per hit, a 1 MiB serialized request, and a 256 KiB
response. Malformed, oversized, and non-UUID candidates are rejected
individually. Duplicate identities retain the highest score.

### Supported adapters

| Adapter                   | Configuration                                                    | Request and expected behavior                                          |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `none`                    | no additional fields                                             | retrieval is disabled                                                  |
| `http-json-v1`            | `url`, optional API key, timeout, and maxResults                 | versioned JSON `POST` to the configured URL; expects `{ items }`       |
| `open-webui-knowledge-v1` | base URL, Open WebUI API key, `knowledgeId`, timeout, maxResults | validates the Knowledge Base and calls Open WebUI collection retrieval |

`open-webui-knowledge-v1` accepts only documents with `docmost`
`schemaVersion: 1` metadata and matching `workspaceId` and `spaceId`. External
result types are `page`, `database_row`, and `attachment`. A `database` may be
explicit context but is not an external retrieval result type. The adapter
sends `hybrid: false`, so a broken external reranker does not disable normal
vector search. When the collection response contains only `file_id`, the
adapter calls `GET /api/v1/files/:fileId` and reads canonical metadata from
`file.meta.data.docmost`. Open WebUI distance is converted to
`1 / (1 + max(0, distance))`.

## 4. Configuration and operation

### Space configuration

The only supported provider kind is `openai-compatible`. Defaults are
temperature 0.2, `maxOutputTokens` 8192, `contextWindow` 131072,
`requestTimeoutMs` 300000, one hundred requests per user per day, two million
tokens per space per day, and ninety days of retention. `maxOutputTokens` must
leave at least 1024 tokens for input context.

Retrieval defaults are `http-json-v1`, an 8000 ms timeout, and eight results.
The API accepts timeouts from 1000 to 60000 ms and one to twenty results.
Configuration also includes `systemInstructions`, `visionEnabled`,
`reasoningEnabled`, and up to fifty quick commands. Model, retrieval, and Open
WebUI secrets are encrypted with the application secret. Public responses
return only `apiKeyConfigured` flags.

The assistant's display identity is stored in the same space configuration:
`assistantNameEnabled`, `assistantName` (up to eighty characters), and
`assistantGender` (`masculine|feminine`). The name is trimmed and may contain
Unicode, punctuation, and emoji, but not line breaks, control characters, or
bidi-control characters. Enabling the setting requires a non-empty name.
Disabling it restores the standard localized label without deleting the saved
name or gender. `assistantName: null` clears the name only while the feature is
disabled. The client never translates or inflects the configured name; only
the generic role word may be inflected.

A full-access space administrator can read or update configuration and test the
model or retrieval connection. The model test attempts model discovery, runs a
short completion, and optionally checks vision. The Open WebUI test also
validates collection availability, candidate metadata compatibility, and that
returned IDs resolve to current Docmost sources accessible to the user. A
reachable endpoint without current allowed sources returns `state=empty` as a
warning rather than reporting retrieval as ready.

### Network and security boundaries

`AI_PROVIDER_ALLOWED_ORIGINS` and `AI_RETRIEVAL_ALLOWED_ORIGINS` are separate
production allowlists of exact HTTP(S) origins for model and retrieval
endpoints. URLs with credentials, query strings, or fragments are rejected.
An Open WebUI base URL must also be a clean origin. Shared outbound policy
validates URL and DNS resolution, pins the HTTP connection to the exact
approved IPv4/IPv6 results while preserving the original Host/SNI name,
rejects redirects, and bounds transport. This prevents a second DNS lookup
from changing the destination after validation.
Loopback addresses are development-only. Inside Docker, `127.0.0.1` addresses
the Docmost container rather than the host.

`AI_STREAM_IDLE_TIMEOUT_MS` bounds the delay between SSE chunks, including the
first chunk, from 5000 to 600000 ms and defaults to 120000 ms. It resets on each
chunk and is additionally capped by the space's full `requestTimeoutMs`.

Normal mutating AI endpoints require JWT authentication and pass the global
CSRF guard. Users can access only their own conversations, and page/source
access is rechecked. Retrieval telemetry stores safe aggregates such as counts
and latency, never document content.

RAG and MCP requests use Redis-backed per-key admission control keyed by the
internal API-key ID, never by the raw token. Defaults are 120 RAG requests per
minute with eight concurrent requests and two concurrent bulk operations, and
60 MCP requests per minute with four concurrent requests. Saturation returns
`429` with `Retry-After`; Redis failure returns `503` without a production
in-memory fallback. Configure these through `RAG_API_RATE_LIMIT_PER_MINUTE`,
`RAG_API_MAX_CONCURRENT`, `RAG_API_BULK_MAX_CONCURRENT`,
`MCP_RATE_LIMIT_PER_MINUTE`, and `MCP_MAX_CONCURRENT`.

For a normal chat run, the worker reads current configuration and appends an
authoritative identity directive after space instructions. The directive uses
JSON-encoded `displayName` and `grammaticalGender`, requires the name to remain
verbatim without translation, transliteration, or inflection, and aligns
self-reference with the selected grammatical gender. A new name therefore
applies to subsequent send, retry, and regenerate operations without changing
the fingerprint or historical messages. Auxiliary title generation and editor
selection transforms do not receive this directive.

## 5. External synchronization with Open WebUI

`apps/rag-sync` is an optional standalone process, not part of the backend
runtime. It reads only `/api/rag/*`, imports no server repositories, has no
Docmost database access, and does not use backend queues. One
pre-created Open WebUI Knowledge Base maps to one Docmost space.

The process stores checkpoints, source-to-file mappings, and distributed locks
in a separate Redis namespace, `docmost:rag-sync` by default. It supports full
and delta synchronization, advances inclusive checkpoints only after complete
processing, reconstructs lost mappings from `meta.data.docmost`, ignores
foreign workspace/space metadata, deletes duplicates and failed artifacts,
skips empty pages, and replaces a file only after Open WebUI has processed the
new file successfully. Supported objects include pages, database rows, and
PDF, DOCX, TXT, MD, JPEG, PNG, and WebP attachments. Logs contain IDs, states,
counts, lag, and durations but never document text or secrets.

Before every cycle, the writer reads `GET /api/rag/scope`. Scope schema v2
fingerprints both content policy and the effective readable-page set. When it
changes, the writer reconstructs mappings from Open WebUI metadata, pages
through the opaque `GET /api/rag/scope/blocked` feed, deletes inaccessible
files/mappings, resets the live `updates` and `attachment-updates` checkpoints
to zero, and reprocesses all allowed data. The new composite fingerprint also
includes local attachment size/extension policy and is stored only after the
entire cycle succeeds. A deterministic size/extension skip deletes an existing
mapping; transient read/remote failures keep it for retry. Structured sync
events contain counts, latency, lag, retry outcome, and low-cardinality reason
codes; binding, space, source, checkpoint, and fingerprint identifiers are not
logged. Per-source outcomes are aggregated into each cycle summary.

Configuration is loaded from `RAG_SYNC_CONFIG_PATH`; see
`rag-sync.config.example.json`. The JSON contains URLs, Redis settings,
intervals, attachment size limits, and bindings. Credentials are specified
only as paths to mounted files (`docmostApiKeyFile`,
`openWebUiApiKeyFile`), never inline. `knowledgeId`, `workspaceId`, and
`spaceId` are validated at startup. The Docmost read key and the Open WebUI key
used by the main server for retrieval are independent secrets.

The production image creates an ephemeral inject-workspace lockfile in its
builder stage and uses `pnpm deploy --prod`; the repository lockfile remains
unchanged. The runner uses the unprivileged `node` user and contains only
`dist`, production dependencies, and the built API-contract workspace package.
Revoking the source RAG key prevents the writer from fetching a final blocked
feed; operators must then delete the corresponding external Knowledge Base
contents manually.

Every server process writes a 60-second low-cardinality AI summary for queue
wait, run/provider outcomes, timeouts, retrieval, reconciliation, and rejected
files. The RAG/MCP admission layer writes request latency, response size,
429/503 saturation, and MCP tool latency/result-size summaries. These records
never include prompts, document content, credential-bearing URLs, API-key IDs,
user IDs, tokens, or source IDs. They use the existing application logger and
do not introduce a metrics exporter or diagnostics endpoint.

## 6. External assistants through MCP

### Purpose and relationship to RAG

MCP is the interactive external-assistant surface. It is intended for a model
or agent that needs to search and navigate one Docmost space while answering a
user. It does not replace query-time retrieval or the synchronization API:

| Surface                  | Caller                                      | Primary use                                      | Credential    | Data access                                                      |
| ------------------------ | ------------------------------------------- | ------------------------------------------------ | ------------- | ---------------------------------------------------------------- |
| query-time retrieval     | the Docmost AI worker                       | add ranked external context to one answer        | provider-side | validated excerpts returned by the configured retrieval adapter  |
| `/api/rag/*`             | an external indexer such as `apps/rag-sync` | bulk/delta synchronization and export            | `keyType=rag` | pages, databases, comments, exports, and allowed attachment data |
| `/mcp`                   | an external MCP-capable assistant           | interactive search and targeted document reading | `keyType=mcp` | seven bounded read-only tools; no attachment body extraction     |

MCP calls do not create Docmost conversations, messages, citations, or
`ai_runs`. They also do not use `AI_CHAT_QUEUE`, invoke the configured model,
or depend on the per-space `agentEnabled` flag. Agent mode and MCP share tool
implementations and authorization rules, but their execution lifecycles are
independent.

### Endpoint and transport

The protocol endpoint is the root-level URL `/mcp`, not `/api/mcp`. It uses the
official `@modelcontextprotocol/sdk` Streamable HTTP transport with
`sessionIdGenerator: undefined`. A new MCP server and transport are created for
each HTTP request, so Docmost stores no MCP session ID, event stream, or
resumption state. Clients should use a normal Streamable HTTP MCP transport and
send every lifecycle or tool request to the same URL.

The endpoint is always mounted; there is no MCP feature environment variable.
It advertises only the `tools` capability. Every listed tool has
`readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, and
`openWorldHint=false`.

For a deployment at `https://docs.example.com`, the connection parameters are:

| Parameter      | Value                                              |
| -------------- | -------------------------------------------------- |
| transport      | Streamable HTTP                                    |
| URL            | `https://docs.example.com/mcp`                     |
| authentication | `Authorization: Bearer <MCP_API_KEY>`              |
| scope          | the single space selected when the key was created |

The creation UI provides verified presets for:

- Codex `config.toml`, using `[mcp_servers.docmost]`, `url`, and
  `bearer_token_env_var = "DOCMOST_MCP_TOKEN"`;
- VS Code `mcp.json`, using `type: "http"`, an Authorization header, and a
  password `promptString` input rather than embedding the token;
- Claude Desktop through the experimental local
  `npx -y mcp-remote@0.1.38` bridge. This option requires Node.js 18+, a
  Claude restart, and stores the Bearer token in the local Claude
  configuration.

The token appears only in the post-creation step. Ordinary key lists contain
metadata only. The step polls `lastUsedAt` and reports when the first
connection reaches Docmost.

### Creating and validating an MCP key

Workspace owners and administrators create the key on `/settings/ai/mcp`
through the fixed MCP flow: space, name/expiry, client, creation, and
connection. The legacy `/settings/api-keys` URL redirects to this page.
`/settings/account/api-keys` redirects a workspace owner or administrator to
`/settings/ai/rag` and a member to their profile. RAG and MCP key management is
therefore workspace-admin-only; existing member-created RAG tokens are not
revoked or migrated and continue through the normal live validation rules.
The plaintext token is returned during creation and must be stored securely.
The UI always selects an explicit 30, 60, 90, or 365 day expiry (or a valid
custom future date); it does not present an unlimited option.

The JWT embeds `apiKeyId`, creator `sub`, `workspaceId`, `spaceId`, and
`keyType=mcp`, but the database row remains authoritative. Every request
revalidates all of the following:

- the token signature, issuer, and expiry;
- the live API-key row, type, scope, revocation state, and optional hard
  expiry;
- the workspace, space, and key creator;
- the creator's active/deactivated/deleted state;
- current space membership for a non-admin creator;
- page ACL and AI content-exclusion policy for each returned page.

An MCP token is accepted only on `/mcp`. RAG tokens, user access tokens,
cookies, and revoked or wrong-space keys are rejected. MCP tokens are rejected
on `/api/rag/*` and ordinary user API routes. The endpoint is CSRF-exempt
because it is bearer-only and does not accept cookie authentication.

### Read tools

All inputs use Docmost UUIDs and node identifiers returned by earlier tool
calls. Optional limits are clamped by server-side validation, not only
described in JSON Schema.

| Tool             | Main inputs                         | Result and bounds                                                                                         |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `search`         | `query`, optional `limit`            | accessible pages and database rows with compact highlights and breadcrumbs; default 10, maximum 20       |
| `getTree`        | none                                | up to 500 readable pages with hierarchy metadata; a hidden parent is returned as `parentPageId=null`      |
| `getPageContext` | `pageId`                            | page metadata, visible allowed breadcrumbs, and up to 50 readable direct children                         |
| `getPage`        | `pageId`                            | title, text, editor JSON when compact, outline fallback, update time, and a `truncated` flag               |
| `getOutline`     | `pageId`                            | up to 300 structural nodes with index, optional stable ID, type, nesting level, and compact text          |
| `getNode`        | `pageId`, `nodeId`                  | one ProseMirror node selected by stable ID or a fallback such as `#12` from the outline index             |
| `searchInPage`   | `pageId`, `query`, optional `limit` | case-insensitive matches with character offsets and bounded excerpts; default 20, maximum 50              |

`getPage` includes full editor JSON only when its serialized document fits the
compact-response threshold. For larger pages it returns `content=null`, at
most 16,000 text characters, and up to 80 outline items, with
`truncated=true`. A client can then use `getOutline`, `getNode`, and
`searchInPage` to read only the relevant sections. When an outline item has no
stable `id`, use `#<index>` as the `getNode.nodeId`.

Search and tree results include database rows where the underlying search/page
model represents them as pages. MCP does not provide database mutation,
schema-editing, table, comment, share, export, or page-management tools.

### Result, error, and content boundaries

A successful `tools/call` response contains one MCP text content item. Its text
is a JSON serialization of the tool result. One serialized result is limited
to 32 KiB. The 128 KiB cumulative budget belongs to an internal agent run and
does not span independent stateless MCP requests.

Expected authorization, validation, and not-found failures return
`isError=true` with a bounded safe message. Unexpected internal exceptions are
reported as the generic `MCP tool call failed`; database or stack details are
not exposed.

The shared content policy can hide an entire page subtree or individual pages
from AI consumers. MCP applies that policy in addition to page ACL. It never
fetches or returns attachment binaries, private chat files, or extracted
attachment text. Page editor JSON may still contain ordinary attachment-node
references already stored in the page; those references are not dereferenced
by MCP.

### Deployment checklist

- Route `/mcp` at the reverse proxy without adding the `/api` prefix.
- Preserve the `Authorization`, `Accept`, `Content-Type`, and
  `MCP-Protocol-Version` headers.
- Use HTTPS outside a trusted local development environment.
- Create a separate least-privilege key for each external assistant and space.
- Set an explicit expiry where practical and revoke the key when the client is
  retired or compromised.
- Verify `tools/list`, then test `search` and an ACL-restricted `getPage` before
  production use.
- Monitor the root endpoint separately: the generated backend route inventory
  covers `/api/*` routes and therefore does not list `/mcp`.

### Attribution

The agent and MCP tool architecture was adapted from
[`vvzvlad/gitmost`](https://github.com/vvzvlad/gitmost) and
[`vvzvlad/docmost-mcp`](https://github.com/vvzvlad/docmost-mcp). The pinned
source revisions and applicable AGPL/MIT notices are recorded in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## 7. API

### Administrative UI routes

| Route                            | Purpose                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `/settings/ai`                   | AI assistant overview with per-space configuration entry points       |
| `/settings/ai/spaces/:spaceSlug` | sectioned full-page configuration for one space                       |
| `/settings/ai/rag`               | RAG synchronization onboarding and workspace RAG-key administration   |
| `/settings/ai/mcp`               | MCP onboarding and workspace MCP-key administration                   |
| `/settings/account/api-keys`     | compatibility redirect to RAG for admins or profile for members       |
| `/settings/api-keys`             | compatibility redirect to `/settings/ai/mcp`                          |

The space settings modal contains only an AI status summary and a link to the
full-page configuration. Workspace owners and administrators and space
administrators have full access to that route; writers and readers receive a
structured access-denied state without configuration or secret flags.
Provider, retrieval, and agent tests validate their own sections. Unsaved
section changes are marked and protected when switching sections or closing the
browser page.

The authenticated API-key management endpoints for list, create, update, and
revoke require workspace `owner|admin`. List requests accept optional
`keyType=rag|mcp`; filtering is applied before cursor pagination so the two
specialized pages cannot mix key types. Token validation is unchanged, which
preserves the lifetime and access checks of previously issued member-created
RAG tokens.

### Authenticated AI API

These endpoints require a user JWT. Mutating routes also require the standard
CSRF contract.

| Method and path                                                  | Purpose                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET/PATCH /api/spaces/:spaceId/ai/config`                       | read or update space AI configuration                          |
| `POST /api/spaces/:spaceId/ai/config/actions/test-model`         | test the provider and optional vision                          |
| `POST /api/spaces/:spaceId/ai/config/actions/test-agent`         | force and validate provider tool calling                       |
| `POST /api/spaces/:spaceId/ai/config/actions/test-retrieval`     | test external retrieval                                        |
| `GET/PUT /api/spaces/:spaceId/ai/exclusions`                     | read or replace exclusion rules with optimistic revision       |
| `GET /api/spaces/:spaceId/ai/exclusions/candidates`              | search page candidates for exclusions                          |
| `GET /api/spaces/:spaceId/ai/status?pageId=`                     | availability, permissions, identity, usage, and quick commands |
| `GET/POST /api/ai/conversations`                                 | list by required `pageId` or create a conversation             |
| `GET/PATCH/DELETE /api/ai/conversations/:id`                     | read, update, or soft-delete an owned conversation             |
| `POST /api/ai/conversations/:id/actions/open`                    | update the last-opened time                                    |
| `GET /api/ai/conversations/:id/messages`                         | list messages with `before` and `limit`                        |
| `GET/PUT /api/ai/conversations/:id/context`                      | read or version-replace context                                |
| `GET /api/ai/conversations/:id/context-sources`                  | search accessible explicit-context candidates                  |
| `GET /api/ai/conversations/:id/context-descendants`              | lazily list accessible direct descendants of a page root       |
| `POST /api/ai/conversations/:id/messages`                        | send a message and create a run; returns `202`                 |
| `GET /api/ai/runs/:id`                                           | read a single attempt                                          |
| `POST /api/ai/runs/:id/steps/:stepId/actions/approve`            | approve one pending agent write as its initiating user         |
| `POST /api/ai/runs/:id/steps/:stepId/actions/reject`             | reject one pending agent write and resume the bounded loop     |
| `POST /api/ai/runs/:id/actions/cancel`                           | request cancellation                                           |
| `POST /api/ai/runs/:id/actions/retry`                            | create a new attempt; returns `202`                            |
| `POST /api/ai/messages/:id/actions/regenerate`                   | regenerate an answer; returns `202`                            |
| `GET/POST /api/ai/conversations/:conversationId/files`           | list files or perform idempotent multipart upload              |
| `GET/DELETE /api/ai/conversations/:conversationId/files/:fileId` | download or delete a private chat file                         |
| `GET /api/ai/pages/:pageId/attachments`                          | list page attachments available for context                    |
| `POST /api/ai/editor-actions`                                    | create an editor-selection transform; returns `202`            |
| `GET /api/ai/editor-actions/:id`                                 | read editor-action state                                       |
| `POST /api/ai/editor-actions/:id/actions/cancel`                 | cancel an editor action                                        |

### Synchronization RAG API

Every `/api/rag/*` route is read-only (`GET`), does not use CSRF, and accepts
only `Authorization: Bearer <token>` from a workspace API key. User JWTs and
cookies are rejected, and API keys are rejected outside `/api/rag/*`. The key
contains `workspaceId`, `spaceId`, `apiKeyId`, and `sub`; key scope, current
creator membership, page ACL, and the content policy bound all live data.
Cursor feeds are at least once, so consumers must perform idempotent
upsert/delete operations.

| Path                                                            | Data                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/rag/scope`                                            | schema-v2 policy and readable-page fingerprint                      |
| `GET /api/rag/scope/blocked?limit=&cursor=`                     | opaque IDs currently outside effective sync scope                  |
| `GET /api/rag/pages?includeContent=&limit=&cursor=`             | active page/database list with optional SQL-backed pagination      |
| `GET /api/rag/updates?updatedSince=&limit=&cursor=`             | changed pages and databases                                        |
| `GET /api/rag/deleted?deletedSince=&limit=&cursor=`             | page/database/database-row tombstones                              |
| `GET /api/rag/attachments/updates?updatedSince=&limit=&cursor=` | changed attachments                                                |
| `GET /api/rag/attachments/deleted?deletedSince=&limit=&cursor=` | attachment tombstones                                              |
| `GET /api/rag/pages/:pageIdOrSlug?includeContent=`              | page or database-container details                                 |
| `GET /api/rag/databases/:databaseIdOrPageSlug`                  | structured database data and `knowledgeMarkdown`                   |
| `GET /api/rag/databases/:databaseIdOrPageSlug/rows?pageIds=`    | rows, cells, and row Markdown                                      |
| `GET /api/rag/pages/:pageIdOrSlug/attachments`                  | attachment metadata and download URLs                              |
| `GET /api/rag/attachments/:fileId/:fileName`                    | attachment stream with a repeated ACL/policy check                 |
| `GET /api/rag/pages/:pageIdOrSlug/comments`                     | comments, including resolved comments                              |
| `GET /api/rag/pages/:pageIdOrSlug/export`                       | page ZIP export with format, attachment, and child options         |
| `GET /api/rag/space/export`                                     | scope-filtered space ZIP export with format and attachment options |

See [`RAG_API.md`](RAG_API.md) for the complete field specification and
request examples.

### MCP protocol API

All MCP lifecycle, `tools/list`, and `tools/call` messages use the root
`/mcp` Streamable HTTP endpoint described in section 6. This is a protocol
surface rather than a conventional REST route and is intentionally outside the
global `/api` prefix.

## 8. Contracts

Canonical TypeScript contracts live in `packages/api-contract/src/ai.ts`.
Important enumerations include provider `openai-compatible`; adapters `none`,
`http-json-v1`, and `open-webui-knowledge-v1`; run statuses `queued`, `running`,
`awaiting_approval`, `completed`, `failed`, and `cancelled`; execution modes
`chat` and `agent`; and source types `page`, `database`, `database_row`,
`attachment`, and `chat_file`.

The primary public models are `AiSpaceConfig`, `AiAvailability`,
`AiConversation`, `AiConversationContext`, `AiMessage`, `AiRun`, `AiCitation`,
`AiRunStep`, `AiChatFile`, and `AiEditorActionRun`. `AiRunStep` exposes the
discriminated `approvalPreview` for `editPageText`, `patchNode`, `insertNode`,
and `deleteNode`. Assistant messages expose `reasoning`,
`runStatus`, `retrievalOutcome`, `retrievalErrorCode`, `applyContext`, and
citations when applicable. Secret and credential fields are never part of
public models.

The MCP surface does not duplicate these TypeScript response models. Tool
definitions are generated by `AiToolRegistryService`; the MCP adapter returns
their JSON-serialized result inside an MCP text content item. The registry is
the canonical source for tool names, JSON Schemas, exposure
(`agent|mcp`), read/write classification, and per-result limits.

`AiAvailability.assistantIdentity` is `{ name, gender }` or `null`. Normal
space members receive it through page-scoped status even when AI is disabled or
temporarily unavailable; administrative configuration and secrets are not
exposed with it.

The `http-json-v1` contract is:

```ts
type AiRetrievalQueryRequest = {
  schemaVersion: 1;
  requestId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  query: string;
  allowedPageIds: string[];
  sourceTypes: Array<"page" | "database_row" | "attachment">;
  limit: number;
  candidateLimit: number;
};

type AiRetrievalQueryResponse = {
  items: Array<{
    sourceType: "page" | "database_row" | "attachment";
    sourceId: string;
    pageId: string;
    text: string;
    score?: number;
  }>;
};
```

Realtime Socket.IO contracts include `ai:run.delta`, `ai:run.status`,
`ai:run.step`,
`ai:conversation.updated`, `ai:content-policy.updated`,
`ai:editor-action.delta`, and `ai:editor-action.status`. A run delta contains
`runId`, `conversationId`, `messageId`, `pageId`, `sequence`, `delta`, and an
optional `reasoningDelta`. Status events may include retrieval outcome/error
and execution errors.

AI errors use stable `AiErrorCode` values for quotas, idempotency, page access,
provider behavior, queues, retrieval, context, files, and editor actions.
Content and context additions include `ai_context_resolved_source_limit`,
`ai_context_source_excluded`, and `ai_context_descendant_invalid`. Retrieval
codes include `retrieval_request_too_large`, `retrieval_timeout`,
`retrieval_unavailable`, `retrieval_url_rejected`,
`retrieval_invalid_response`, and `retrieval_collection_unavailable`.
