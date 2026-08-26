# AI assistant, smart search (RAG), and MCP (inbound and outbound)

<!-- ai-admin-guide-contract-version: 16 -->

This document describes the current core AI architecture in Docmost: page-bound
chat, conversation context, background runs, space retrieval, and integration
with external RAG indexes and assistants. It also separates six related but
distinct paths:

1. **Query-time retrieval** finds sources while the AI assistant is answering.
2. **RAG API** (`/api/rag/*`) is a read-only export and synchronization API for
   external indexes. It does not answer retrieval queries itself.
3. **Agent mode** lets the private assistant call bounded Docmost tools and
   propose safe current-page changes that require explicit user approval.
4. **Inbound MCP** (`/mcp`) exposes the read-only subset of the same tool
   registry to external assistants through stateless Streamable HTTP. Docmost is
   the MCP _server_ here.
5. **Outbound external MCP** lets the internal agent call read-only tools on
   remote MCP servers after workspace approval, space binding, and per-user
   opt-in. Docmost is the MCP _client_ here.
6. **Dictionary word-form generation** uses the configured space model to
   propose inflections and abbreviations for one term or to update every term.

Paths 4 and 5 are opposite directions. They share no configuration and no
credentials: an inbound `keyType=mcp` API key has nothing to do with an outbound
server's request headers.

All HTTP paths below include the global `/api` prefix except `/mcp`, which is
an explicit root-level protocol endpoint.

This file is the canonical source for AI/RAG/MCP architecture, security
boundaries, limits, and recovery behavior. `AI_INTEGRATION.md` is the operator
setup guide, while `RAG_API.md` is the external synchronization wire contract;
those documents should link here instead of copying changing implementation
details.

The administrator and operator projection of this document is embedded in
Docmost as a separate workspace-administrator AI settings tab at
`/settings/ai/guide`. It provides stable deep links for the
assistant (`#assistant`), query-time retrieval (`#retrieval`), external RAG API
clients (`#rag-api`), built-in Open WebUI synchronization (`#rag-sync`),
inbound MCP (`#inbound-mcp`), outbound MCP (`#outbound-mcp`), security
boundaries (`#security`), and recovery (`#troubleshooting`). With no hash, the
guide opens a compact overview. Desktop users choose one active panel from a
sticky grouped navigation; narrow layouts use a section selector. Browser
history and external deep links switch the same active panel.

Each scenario presents its purpose, owner, prerequisites, expected result,
setup steps, success signal, and safe rollback before expandable technical
details. Public routes and deployment controls appear only in their relevant
scenario. Security starts with four operating principles and keeps its detailed
credential matrix collapsed; troubleshooting is grouped by access, limits and
dependencies, RAG Sync, and MCP. Three vertical, responsive, sanitized Mermaid
diagrams cover path selection, the three RAG data paths, and both MCP
directions. Their text alternatives remain available in collapsed disclosures.

The structured UI contract lives in
`apps/client/src/features/ai/components/ai-admin-guide-content.ts`; stable
anchors, the explicit `ai.adminGuide.*` locale manifest, and the shared contract
version live in `ai-admin-guide-contract.json`. The version in that manifest
must match the `ai-admin-guide-contract-version` marker above. A change to
production AI/RAG/RAG Sync/MCP/API-key logic, API contracts, related migrations,
or environment contracts must update this document, the structured guide, the
manifest version, and all supported locales in the same pull request. The
`check:ai-docs` gate enforces that coupling when CI supplies
`AI_GUIDE_BASE_SHA` and `AI_GUIDE_HEAD_SHA`; without Git history it still checks
routes, flags, anchors, manifest coverage, localized field structure, and the
matching contract version.

Release verification also runs the production-like AI browser acceptance for
this route in both Russian and English. It traverses all eight panels and checks
the projection-v1 and `rag_sync_target_mismatch` guidance. Static
`check:ai-docs` validation rejects moving the route outside the administrator
boundary, merging the guide into another settings tab, dropping an anchor, or
removing either localized browser project.

The guide deliberately keeps the paths separate: query-time retrieval is an
answer-time search adapter, `/api/rag/*` is an API-key-only export surface for
external indexers, and built-in RAG Sync reads through internal Docmost services
and never calls that public API. The RAG API may stream an attachment only after
repeating its access and policy checks; inbound `/mcp` exposes attachment
metadata tools but never returns binary attachment bodies.

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

| Component                                | Responsibility                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AiConversationService`                  | private user conversations in page context, messages, and drafts                                                       |
| `AiAssistantProfileService`              | space-owned profile CRUD, effective resolution, immutable snapshots, and Agent verification                            |
| `AiContextService`                       | versioned conversation context and source-access validation                                                            |
| `AiContentPolicyService`                 | shared space exclusions for AI context, editor actions, retrieval, and the RAG API                                     |
| `AiRunService` / `AiRunExecutionService` | immutable attempts, limits, idempotency, execution, and streamed response persistence                                  |
| `AiPromptBuilderService`                 | bounded prompt assembly from history, context, files, and retrieval results                                            |
| `AiCitationService`                      | source-marker registration, validation, normalization, and context fallback                                            |
| `OpenAiCompatibleProviderService`        | requests and streaming against an OpenAI-compatible provider                                                           |
| `AiRetrievalService`                     | safe query-time retrieval and reauthorization of returned sources                                                      |
| `AiSourceAccessService`                  | shared live source, ACL, workspace/space, and exclusion guard for retrieval and history                                |
| `KnowledgeProjectionService`             | canonical document fields, member names, database schema/cells, dictionary Markdown/search, and projection fingerprint |
| `AiFileService`                          | uploads, text extraction, images, tombstone deletion, and chat-file cleanup                                            |
| `AiAuxRunService`                        | auxiliary jobs for automatic conversation titles and editor-selection transforms                                       |
| `AiTextGenerationService`                | narrow provider session facade exported through `AI_TEXT_GENERATION_PORT`                                              |
| `DictionaryWordFormService`              | bounded structured word-form generation through the narrow generation port                                             |
| `AiToolRegistryService`                  | access-aware tools shared by agent mode and the read-only MCP surface                                                  |
| `AiBuiltinToolPolicyService`             | deployment/workspace/space/key intersections and immutable Agent tool snapshots                                        |
| `AiRunStepService`                       | initiator-only approval, safe Yjs application, history, and agent resumption                                           |
| `McpController` / `McpApiKeyAuthGuard`   | stateless Streamable HTTP adapter and MCP-key-only authentication                                                      |

Execution uses `AI_CHAT_QUEUE`. BullMQ delivery is at least once, so a worker
atomically claims a specific `ai_runs` row from `queued` to `running`; a
terminal attempt is never reopened. Deterministic job IDs, compare-and-set
transitions, ordered event sequences, and the reconciler close the
PostgreSQL/Redis boundary without automatically repeating a stale provider
call.

## 2. AI assistant flow

### Normal chat response

1. Opening the panel or choosing **New chat** creates only a local draft. The
   draft text, mode flags, and `assistantProfileId` are stored in `sessionStorage`, scoped by
   workspace, user, and page. An empty draft never creates a database row.
2. The first meaningful action (send, private-file upload, or context change)
   creates exactly one private conversation bound to the `pageId`, using the
   current `agentMode`, `useSpaceSearch`, and selected assistant profile. The
   server resolves preferred/default fallbacks and freezes the profile snapshot
   in the same transaction. Concurrent first actions share one in-flight
   creation promise.
3. A send creates the user message, a pending assistant message, and an
   immutable `ai_run` attempt. It copies the frozen profile and stores exact
   built-in/MCP tool snapshots plus a non-secret effective provider snapshot.
   `clientRequestId` binds the idempotency key to
   the request payload; reusing the key with a different payload is rejected.
4. The server validates AI availability, the current user, page binding, page
   write access, quotas, and concurrency. At most one run per conversation,
   six per user, and thirty per space may use or reserve a provider slot at the
   same time. A run waiting for user approval does not consume that slot.
5. The worker claims the run, resolves the context snapshot and files, and,
   when `useSpaceSearch` is enabled, resolves external retrieval results.
6. `AiPromptBuilderService` keeps only server policy, the frozen space/profile
   instructions, and assistant identity in the trusted `system` role. Profile
   instructions are delimited and sandwiched between platform-safety rules;
   space identity metadata has higher priority. Document snapshots,
   selections, files/images, and retrieval excerpts are JSON-marked as
   untrusted reference data in the final `user` message, with the actual user
   request last. Budgets are derived from `contextWindow` and
   `maxOutputTokens`, so oversized sources are truncated. Every included
   citable document, stable section, and file receives a server-controlled
   `[S<n>]` marker. A run admits at most 512 candidates and omits reference
   content if its source cannot be registered.
7. The provider returns a text stream. Text and, when enabled, reasoning deltas
   are buffered, periodically persisted, and sent over Socket.IO.
   `ai_runs.sequence` provides a monotonic ordering key for the client.
   A terminal stream with neither answer nor reasoning content is not recorded
   as a successful blank message. Normal chat retries it once with a bounded
   32K context/4K output fallback; a second empty stream fails with the stable
   `provider_invalid_response` error.
   Cancellation aborts provider URL resolution, response-header waits, and
   response-body reads for both streaming chat and non-streaming agent tool
   turns; terminal database checks remain authoritative if an adapter returns
   after cancellation.
8. On success, the raw provider text is stored in `ai_runs.response_snapshot`.
   Valid source markers are renumbered by first appearance to `[C1]`, `[C2]`,
   and so on before the user-visible text is stored in `ai_messages.content`.
   Only validated cited sources, or root context sources used for the no-marker
   fallback, are stored with the message.
   The first successful response may schedule a separate title job limited to
   four Unicode word segments. A manual rename always wins. On failure or
   cancellation, both the message and attempt receive a terminal status.

Retry and regenerate create linked new attempts instead of rewriting the
original attempt. They copy the original profile, provider, built-in, and MCP
snapshots; live ACL and policy narrowing are still rechecked. Retry operates on
a run; regenerate operates on an assistant message. Cancellation records a
request that the worker checks during streaming and terminates the attempt as
`cancelled`.

### Citation contract

The citation contract applies to new chat and agent generations. Existing
message sources are retained with `citationState=legacy`; historical answer
text is not reconstructed. Provider markers inside fenced or inline code are
not citations. Unknown markers are discarded, repeated valid markers reuse the
same citation number, and different stable sections of one page remain separate
citations. Before a historical assistant turn is reused as provider history,
technical `[S<n>]` and `[C<n>]` markers outside code are removed. The server
also reauthorizes every stored page dependency and private chat file. If any
dependency is deleted, excluded, no longer readable, not ready, or no longer
owned by the conversation, the complete user/assistant history pair is omitted
from the next provider request.

Page Markdown is divided by headings whose ProseMirror `attrs.id` is a stable
identifier. Text before the first stable heading cites the document root; later
text cites the nearest preceding stable heading. Headings without a stable ID
fall back to the document URL. The current editor sends at most 500 heading
records `{id,title,level,position}`; these records are stored in the immutable
run-context snapshot, so Retry and Regenerate preserve the original anchors.
Page and database URLs are canonical relative application URLs. Section URLs
append `#headingId`, while private files use authenticated download routes.

Retrieval excerpts are matched against the currently authorized local page
content. An exact or unique normalized match may resolve to a stable section;
an ambiguous match falls back to the page root. Attachment retrieval results
link directly to the authenticated attachment route. Built-in agent read tools
return internal citation references, and the execution layer adds the assigned
`[S<n>]` markers plus page source dependencies. Outbound external MCP results
cannot create Docmost citations.

The message API exposes `citationKey`, `citationState`, `sectionId`, and
`sectionTitle` and never returns `candidate` rows. `position` is the order of
first appearance in the normalized answer. The client replaces `[C<n>]`
outside code, preformatted blocks, and existing links with safe inline links.
Internal URLs open in the current tab; external HTTP(S) URLs open in a new tab.
Unresolved streaming `[S<n>]` markers remain hidden until the terminal REST
refetch. Copy and apply-to-editor operations convert normalized markers to
ordinary Markdown or HTML links.

If at least one valid citation is present, the UI shows only **Used sources**.
If none is present, it shows the deduplicated root **Context sources** list.
Legacy messages retain their previous source presentation. Existing ACL and
source-dependency checks continue to hide a derived answer when a required page
becomes unavailable.

### Agent mode

Agent mode is a per-conversation opt-in and is disabled for a space by default.
A space administrator must first run the tool-calling capability test against
the currently configured provider, base URL, and chat model. The test forces a
known tool call and records a configuration fingerprint only when the response
is structurally valid. Changing those provider fields invalidates the
fingerprint and disables agent mode until it is tested again.

### Per-space assistant profiles

Assistant profiles are space-owned behavior presets. They do not replace the
space assistant identity: `assistantName` and `assistantGender` remain common to
the space, while a selected profile replaces only the admin-authored behavior
instructions and may narrow tools or apply permitted provider overrides. A
conversation with no profile uses the existing `legacy_space` assistant path.

Profiles are deployment-disabled by default through
`AI_ASSISTANT_PROFILES_ENABLED=false`. A workspace `owner|admin` must also
enable `ai_assistant_profile_workspace_settings`; absence of that row means
disabled. The separate `model_overrides_enabled` switch controls model,
temperature, and maximum-output overrides. Overrides never carry a protocol,
origin, credential, headers, retrieval configuration, retention rule, context
window, or usage limit. The current encrypted space credential is used only
when the frozen provider origin still equals the current configured origin.

Each profile has a stable ID, version, curated icon, name, description,
required instructions, optional quick-command replacement, optional provider
overrides, exact built-in capability IDs, exact external `bindingId + toolName`
rows, group availability/narrowing, `autoStart`, and an optional visible launch
message. `quickCommands=null` inherits space custom commands; an array replaces
them, while built-ins remain available. No external rows means no external MCP
for that profile. Names are unique case-insensitively among non-deleted profiles
in one space, at most fifty active rows are allowed, updates require
`expectedVersion`, and normal deletion is soft.

The space-scoped profile-list response includes the effective
`modelOverridesEnabled` policy. This lets a space manager edit overrides that
workspace administrators have permitted without granting access to the
workspace-level policy endpoint. Profile editors display localized tool names;
capability IDs remain wire/storage identifiers and are not user-facing labels.
The quick-command replacement editor preserves label, description, prompt,
enabled state, and explicit order.

A duplicate active name returns HTTP `409` with the stable
`ai_profile_name_conflict` code. Clients should keep the editor open, reload the
space profile list if needed, and ask the administrator to choose another name.

Selection precedence for a new local draft is the user's available preferred
profile, then the available space default, then `legacy_space`. Hidden IDs affect
only the picker. An empty persisted conversation may replace its profile
transactionally. After its first message or run, the profile is locked;
`ai_profile_locked` instructs the client to start a new conversation without
discarding its draft. Selecting a profile never sends a message. An explicit
Start action for `autoStart=true` sends `launchMessage` through the normal
idempotent message flow, so it is immediately visible as a user message.

Conversation snapshots preserve profile ID/version, display fields,
instructions, resolved quick commands, permitted overrides, exact built-in and
external selections, launch behavior, and a tool-policy fingerprint. Runs copy
that snapshot and add exact tool catalogs and a non-secret provider snapshot.
History therefore keeps the old profile name/version after edits or deletion.
Member profile responses and conversation history never expose instructions,
model/tool policy, fingerprints, or secrets.

Profile Chat requires only a currently enabled and allowed profile. Profile
Agent mode additionally requires at least one effective tool and an immutable
`ai_agent_tool_verifications` row matching the effective provider, current
built-in/external tool schemas, and frozen maximum policy. A model override has
a different provider fingerprint from the space default. Group restrictions
and per-user external MCP opt-in can only remove tools and do not create a new
verification maximum. The worker rechecks profile state, group availability,
provider origin, ACL, and live tool policies before/after every provider turn;
revocation fails closed.

Migration `20260805T100000-ai-assistant-profiles.ts` is additive. Existing
spaces receive no profile/default and existing null-snapshot conversations stay
on the legacy path; new no-profile conversations receive an explicit
`legacy_space` snapshot. Roll out schema and code with the deployment flag off,
then enable the workspace switch and canary profiles. Operational rollback is
the deployment or workspace switch: profile history remains readable, new
profile-bound runs stop, and legacy no-profile conversations continue. Do not
run the down migration in production because it destroys audit/history rows.

An agent run resolves the same initial conversation context, private files,
page attachments, and optional query-time retrieval as normal chat. It may then
perform at most eight model steps and sixteen tool calls per approval segment.
An approved, rejected, or expired write proposal starts a new segment, because
the user has to act between segments; the whole run is additionally bounded to
thirty-two model steps and sixty-four tool calls. Each tool result is limited to
32 KiB, and all results in one run are limited to 128 KiB. An invalid tool
response, an unknown tool, or a limit violation fails closed.

The trusted agent preamble also states the current page ID and title, so the
model never has to guess them. `pageId` is optional on the four write tools and
defaults to the conversation page; an explicit value that names another page is
still rejected.

The shared registry exposes these read tools to both the agent and MCP:

- `search`, `getTree`, and `getPageContext`;
- `getPage`, `getOutline`, `getNode`, and `searchInPage`.

Those seven reads are the backward-compatible baseline. The extension catalog
adds `getWorkspaceContext`, `getSpaceContext`, `getDatabaseContext`,
`listDatabaseRows`, `getDatabaseRowContext`, `getTable`, `listComments`,
`listPageHistory`, `diffPageVersion`, `listTransclusionReferences`,
`listPageAttachments`, `getPublicShareInfo`, `listPageTemplates`,
`getPageTemplateMetadata`, and `listPageTemplateUsages`. The extension catalog is
deployment-gated by `AI_BUILTIN_TOOL_EXTENSIONS_ENABLED=false` and is never
granted to an existing workspace, space, Agent run, or MCP key merely because a
tool was added to a category.

Each registry definition has a stable capability ID, UI category, target
scope, approval mode, per-tool byte limit, and MCP-safe annotations. The
registry validates unique names and capabilities, the reserved `mcp__` prefix,
read/write exposure rules, approval compatibility, and the 32 KiB global
ceiling at startup. Workspace and space policy store exact capability arrays;
a category checkbox expands to the exact capabilities visible at save time.
The effective set is always an intersection: deployment maximum, enabled
workspace allowlist, optional space narrowing, and for inbound MCP the key's
own exact allowlist. ACL, deletion state, content exclusion, and live object
state are still checked on every call.

New Agent runs store the resolved built-in catalog, registry manifest
fingerprint, and workspace/space policy versions in
`ai_runs.builtin_tool_policy_snapshot`. The live manifest, deployment maximum,
workspace/space versions, and every snapshotted capability are rechecked before
and after each provider model turn. This includes a final answer with no tool
call, so a response produced concurrently with revocation is never accepted. A
resumed run fails with `agent_tool_policy_changed` if the manifest or live
policy changed.
Legacy runs without a snapshot continue to see only the original eleven Agent
capabilities. Profile-aware Retry and Regenerate preserve the source run's
snapshot; all live revocation checks still apply.

The built-in-policy migration is additive. Existing workspaces start with the
exact eleven legacy Agent capabilities, and existing MCP keys receive the exact
seven legacy read capabilities. Deploy with
`AI_BUILTIN_TOOL_EXTENSIONS_ENABLED=false`, then raise the deployment maximum,
select exact workspace capabilities, optionally narrow each space, and finally
opt individual MCP keys into a non-empty subset. A newly registered tool or a
category membership change never alters a saved policy.

Operational rollback removes optional capabilities or returns
`AI_BUILTIN_TOOL_EXTENSIONS_ENABLED` to `false`; this preserves the legacy
system maximum while all saved workspace, space, key, and run-snapshot data
remain in place. The workspace master switch is a stronger kill switch and
disables both legacy and optional built-in capabilities. Do not use the down
migration for operational rollback because it destroys policy and snapshot
data; MCP JWTs do not need to be reissued because each request reads the
authoritative key row.

Every read is constrained to the run/key space, current user or key creator,
page ACL, deletion state, and the shared AI content-exclusion policy.

Agent mode additionally exposes `editPageText`, `patchNode`, `insertNode`, and
`deleteNode`. These tools never apply a model response directly. A call may
only target the conversation's current page, requires the initiator's current
write access, and creates one pending proposal with a content hash. Both the
proposal and the approval read the live Yjs document, and the hash is computed
from a key-order independent serialization, so the persisted `pages.content`
snapshot and the live document cannot disagree. The run
enters `awaiting_approval`; only its initiating user may approve or reject that
specific proposal, and the proposal expires after one hour. Immediately before
applying an approved proposal, the server rechecks the current page write ACL,
the deployment/workspace/space/profile/group tool-policy cascade, and the live
Yjs document hash. It validates the resulting ProseMirror document against the
editor schema, applies one transaction, and records
`Changed by AI agent` in page history. A stale or rejected proposal is returned
to the model as a tool result so the bounded loop can continue.

Before approval is stored, safe block operations receive stable node IDs and
the step records the expected post-apply content hash in its existing result
JSON. The step decision and run resume are committed in one database
transaction. If a process stops after approval, the reconciler serializes
recovery with a PostgreSQL advisory lock: it reapplies the approved operation
only when the live hash is still the proposal base, finalizes without replay
when the expected post-apply hash is already live, and fails stale for every
other hash. Legacy approved steps without recovery metadata fail safely and
resume without another page mutation.

Approval also resolves the stored `toolName` through the built-in registry and
requires `writeClass=write` plus `approvalMode=current_page_hash`. Every live
policy layer is checked again before recovery; this does not turn the strict
four-operation page proposal union into a generic callback mechanism.

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
images, arbitrary code execution, and _write_ operations on external MCP servers
are not agent tools.

Read-only tools on approved external MCP servers are a separate, gated surface
described in section 7. They can never propose a page change and never create an
approval step; `ai_run_steps` carries a check constraint that makes an
`external_mcp` step with `write_class = 'write'` unrepresentable.

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

Current-document fields are always reloaded by `pageId` on the server; fields
from the editor snapshot are not trusted. Page, database, and database-row
contexts use the shared knowledge projection: enabled `status`, `assigneeId`,
`stakeholderIds`, and `aiRole`, current member display names without email,
database property names/types/options, and named cells including explicit empty
values. These fields enrich a source after the existing page/row text search
has selected it and therefore do not change page ranking. Dictionary terms are
not explicit conversation-context roots and are never appended wholesale to a
prompt.

Chat files and page attachments retain separate limits of ten and twenty.
Context updates include `expectedRevision`; conflicts return
`ai_context_revision_conflict`. Every run stores an allowed context snapshot,
which makes retries reproducible without allowing lost access to expose or
reuse derived data. Page attachments and private chat files join the same live
dependency guard as pages: they are checked before provider use, while output
is flushed, and in the final transaction. An unreadable attachment is isolated
from valid files rather than failing their entire context batch.

Context-source search normalizes quotes, parentheses, guillemets, hyphens, and
Unicode without passing punctuation as PostgreSQL `tsquery` structure. Page and
attachment search vectors replace guillemet delimiters before `f_unaccent`, so
words enclosed in `«…»` remain indexed. Pagination advances by consumed raw
rows and deduplicates canonical `sourceType:sourceId` identities.

The chat composer uses a bounded TipTap schema but keeps Markdown as its public
draft/send format. Supported headings, lists and task lists, blockquotes, code,
bold/italic/strike, and sanitized links can be entered through Markdown input
rules or pasted as Markdown; the composer serializes them back to Markdown for
the existing API. Active inline formatting shows its Markdown delimiters, and
`Ctrl+Enter`/`Cmd+Enter` keeps the existing send shortcut.

On narrow mobile composers, Chat and Agent are equal-width 44 px segments in
a dedicated row. Space search is a labeled, controlled switch rather than a
pressed button. Draft saving and saved states remain available to assistive
technology without consuming the footer; a failed save stays visible as a
44 px retry action. The application viewport declares
`interactive-widget=resizes-content`, and the full-screen assistant flexes to
the resized layout viewport so the composer remains above the virtual
keyboard.

Private multipart uploads require an `Idempotency-Key` header. Supported types
are PDF, DOCX, TXT, Markdown, JPEG, PNG, and WebP. Limits are ten files,
25 MiB per file, and 100 MiB per conversation. Text extraction is asynchronous.
Images are sent to the provider only when `visionEnabled` is true. A send that
selects an image or an image-only PDF while vision is disabled is rejected with
`ai_vision_required`; Docmost never accepts and silently drops that input.
Deletion first commits a database tombstone and then performs retryable storage
cleanup.

Untrusted document parsing has additional worker budgets. DOCX extraction is
limited to 25 MiB per ZIP entry, 100 MiB decompressed total, 10,000 entries,
and 60 seconds. AI PDF rendering is limited to 20 pages, 8192 pixels per side,
16,777,216 pixels per page, 67,108,864 cumulative pixels, 10 MiB of PNG output,
and 60 seconds. At most two heavy parse/render operations run concurrently;
loading documents, render tasks, and canvases are released on every exit path.

An editor selection transform (`editor_transform`) is an `ai_aux_run`. It uses
the selected text and a page-snapshot hash and streams its result, but it does
not create chat messages or change chat history. Selected text is serialized as
explicitly marked untrusted JSON before the final transformation instruction;
document text cannot replace system policy. The page, exclusion policy, and
attachment dependencies are rechecked before the provider call, during stream
flushes, after the provider returns, and immediately before completion. A
change fails the action with `source_access_changed` and clears partial output.

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

The same **Knowledge access** section also stores the independent
`ragSearchDoneOnly` switch. It defaults to `false`. When enabled, query-time AI
retrieval, the RAG API, and built-in RAG Sync accept a page-backed source only
when that source's own `PageCustomFieldStatus` is the canonical `DONE` value;
missing, `null`, and unknown values fail closed. A page, database container,
and database row are evaluated independently, so an eligible row remains
available when its database container is not `DONE`. The database schema may
still be read as service context for those rows, but the database document is
not indexed. Attachments inherit their owner page's eligibility. Dictionary
terms are never status-filtered. The switch does not change current/manual chat
context, editor actions, Agent/MCP, explicit exclusion semantics, or regular
Docmost search.

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

When `ragSearchDoneOnly` is enabled, both the pre-request allowlist and the
post-result authorization pass apply the status rule. The external request
therefore stops receiving non-`DONE` page IDs immediately, even while an
asynchronous external index is still converging after a status transition.

The source-access guard computes the full allowed set before an outbound
retrieval call, then rechecks only returned identities after the call and just
before model use. The run records those page dependencies before provider
execution and rechecks them before each stream flush, between Agent/model steps,
and in the final transaction. If a source is deleted, archived, replaced,
excluded, moved across scope, or becomes unreadable, the run ends with stable
error `source_access_changed`; response text, reasoning, and citations are
cleared. Conversation history applies the same live-source policy and presents
the stored message as access restricted. The same fail-closed lifecycle covers
page attachments and private chat files, not only page and retrieval sources.

An external request is bounded to forty candidates, eight final results by
default, 16 KiB of text per hit, a 1 MiB serialized request, and a 256 KiB
response. Malformed, oversized, and non-UUID candidates are rejected
individually. Duplicate identities retain the highest score.

The shared Agent/MCP `search` capability also searches the dictionary as an
independent corpus when the space switch is enabled. Exact normalized term or
form matches precede prefix and substring matches, followed by definition
matches and a stable score/title/UUID tie-break. Dictionary and document
candidates share the caller-provided limit. A `dictionary_term` result carries
the UUID, term, forms, definition, `pageId: null`, and the stable link
`/s/:spaceSlug/dictionary?term=<uuid>`.

### Supported adapters

| Adapter                   | Configuration                                                    | Request and expected behavior                                          |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `none`                    | no additional fields                                             | retrieval is disabled                                                  |
| `http-json-v1`            | `url`, optional API key, timeout, and maxResults                 | versioned JSON `POST` to the configured URL; expects `{ items }`       |
| `open-webui-knowledge-v1` | base URL, Open WebUI API key, `knowledgeId`, timeout, maxResults | validates the Knowledge Base and calls Open WebUI collection retrieval |

`open-webui-knowledge-v1` accepts only documents with supported `docmost`
`schemaVersion: 1 | 2` metadata and matching `workspaceId` and `spaceId`. The
built-in writer emits version 2; version 1 remains a read/cleanup compatibility
format. External
result types are `page`, `database_row`, `attachment`, and `dictionary_term`.
A dictionary candidate is requested only while
`space.settings.dictionary.enabled` is true, uses `pageId: null`, and is
revalidated against workspace, space, active-term state, the switch, and the
caller's `Read Page` space ability; page ACL does not apply to terms. Page-backed
safe retrieval results and attachment excerpts receive current parent document
fields during local resolution. A `database` may be explicit context but is not
an external retrieval result type. The adapter
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

New space configurations store `none`, so retrieval stays disabled until an
administrator enables it. The configuration form preselects `http-json-v1`
when retrieval is enabled; the timeout defaults to 8000 ms and the result limit
to eight. The API accepts timeouts from 1000 to 60000 ms and one to twenty
results.
Configuration also includes `systemInstructions`, `visionEnabled`,
`reasoningEnabled`, and up to fifty quick commands. Model, retrieval, and Open
WebUI secrets are encrypted with the application secret. Public responses
return only `apiKeyConfigured` flags.

The client provides nine localized built-in quick commands. Each built-in
prompt contains five explicit instructions on separate Markdown numbered-list
lines, covering the requested transformation, preservation constraints, editing
rules, unsupported-content guardrails, and the expected output-only response.
Space administrators can replace these defaults with custom quick commands.

### Dictionary word-form generation

`DictionaryModule` imports the controller-free `AiProviderModule` and injects
`AI_TEXT_GENERATION_PORT`; it does not import the full `AiModule` or depend on
`AiConfigService` and `OpenAiCompatibleProviderService`. The port resolves and
decrypts the effective provider configuration once per operation and returns a
scoped completion session. Provider configuration lookup remains shared with
`AiConfigService`, so the dictionary and chat paths do not implement competing
configuration rules.

When the space provider is enabled and has both `baseUrl` and `chatModel`, the
dictionary exposes two model-assisted commands. A user who can manage pages in
the space can generate forms for the term currently open in the edit dialog.
That command returns a normalized form list to the client but does not save it;
the user reviews and saves it through the ordinary term update flow. Workspace
`owner|admin` users can generate forms for every dictionary term, and that
command saves the complete result immediately.

Only term spellings are sent to the provider. Definitions and other space
content are not included. Terms are JSON-encoded and treated as untrusted data;
the system prompt rejects instructions embedded in a term. Generation asks for
language-appropriate cases, declensions, conjugations where applicable,
singular/plural forms, grammatical genders, and common abbreviations. Provider
responses must match the expected indexed JSON shape and are retried once when
invalid. Bulk work uses batches of eight with at most three provider requests
in flight.

Existing forms are retained. Results use the same NFKC, whitespace, case-folded
deduplication, 255-character form limit, and 100-form-per-term limit as manual
dictionary updates. The bulk operation generates every batch before opening a
database transaction. It then verifies that the dictionary snapshot has not
changed, skips aliases already owned by another term, and replaces all aliases
atomically; concurrent edits return `409` without a partial save. A provider or
validation failure likewise leaves the dictionary unchanged. These synchronous
utility calls use the provider timeout and network policy from the space
configuration but are not stored as chat conversations or assistant runs.

The dictionary is also a knowledge/search corpus with one
`dictionary_term` source per active term. Term/form lookup uses exact,
prefix/substring, definition, and trigram ranking backed by PostgreSQL
expression indexes. Create, update, forms generation, bulk import, and soft
delete emit a post-commit RAG Sync wake-up; polling and the independent
dictionary update/delete feeds remain the recovery path. Disabling the space
dictionary removes remote term mappings, while re-enabling it changes the scope
fingerprint and backfills the corpus. The client deep link opens, scrolls to,
and focuses the requested term; disabled, deleted, or inaccessible terms show a
localized fail-closed state.

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
Concurrency leases have a ten-minute safety TTL and are renewed every third of
that interval until the request finishes, closes, or aborts. Release and renewal
use the random internal lease ID; API-key IDs and tokens are not logged. Only one
renewal is in flight at a time. If Redis cannot confirm an existing lease, the
guard fails closed: before response headers it returns `503
api_key_limit_lease_lost`, and after streaming begins it closes the connection.
The low-cardinality operational summary increments `leaseLost` without logging
the key or lease identity.

### Recovery and diagnostics

- PostgreSQL is authoritative for AI runs. The lifecycle reconciler delivers
  missing deterministic BullMQ jobs, fails undeliverable queued runs after five
  minutes, and terminalizes a running attempt after twelve minutes without a
  heartbeat. A stale attempt with a recorded cancellation request becomes
  `cancelled`; every other stale attempt fails with `worker_lost`. The
  reconciler never repeats a stale provider call automatically.
- Private chat file uploads hold a conversation-scoped PostgreSQL advisory lock
  across the storage write. Repeating the same multipart request and
  `Idempotency-Key` after a process failure resumes the reserved batch and its
  existing file rows; completed and failed batches remain terminal. Reusing the
  key with different file metadata or content returns `409`.
- An `awaiting_approval` run with a decided step is recovered by the hash rules
  in **Agent mode** above. Do not repair it by editing Yjs content or reopening a
  terminal `ai_runs` row.
- A user cancellation should release a streaming or agent provider request on
  the next cancellation poll. Diagnose longer delays from the structured
  provider outcome and cancel-latency summaries before changing timeouts.
- RAG/MCP `429` responses include `Retry-After`; `503 api_key_limit_unavailable`
  means Redis admission is unavailable. Long-running exports retain their slots
  through lease renewal until the HTTP lifecycle finishes. A `503
api_key_limit_lease_lost`, or a connection close after response headers, means
  the active lease could no longer be confirmed; retry only an idempotent read
  after Redis admission is healthy.
- Built-in RAG Sync commits checkpoints and mappings only through lease-fenced
  Redis operations. On lease loss it aborts remote polling and performs remote
  reconciliation before retrying an uncertain upload.
- If RAG Sync state is lost, keep the Knowledge Base, restore Redis, and let the
  main Docmost process reconstruct mappings from versioned remote metadata.
  Writer-key rotation is performed in the space UI and never requires a
  deployment environment change.
- Safe local diagnostics are `pnpm check:env`,
  `pnpm routes:inventory:check`, the targeted server AI/RAG/MCP/RAG-Sync tests,
  and the low-cardinality structured summaries. Never put
  prompts, document bodies, credentials, API-key IDs, source IDs, or
  credential-bearing URLs into diagnostic logs.

For a normal chat run, the worker reads current configuration and appends an
authoritative identity directive after space instructions. The directive uses
JSON-encoded `displayName` and `grammaticalGender`, requires the name to remain
verbatim without translation, transliteration, or inflection, and aligns
self-reference with the selected grammatical gender. A new name therefore
applies to subsequent send, retry, and regenerate operations without changing
the fingerprint or historical messages. Auxiliary title generation and editor
selection transforms do not receive this directive.

### AI and RAG migration ledger

The migration files are the schema source of truth. This ledger records the
data treatment and rollback boundary that operators need; feature sections
above remain authoritative for runtime rollout switches and recovery behavior.

| Migration                                                                                                                                                       | Authoritative change and data treatment                                                                                                                                                                                                                                                            | `down` impact                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`20260728T120000-ai-integration.ts`](../apps/server/src/database/migrations/20260728T120000-ai-integration.ts)                                                 | Creates per-space provider/retrieval configuration, private conversations and messages, generation runs, chat files, and message-source snapshots.                                                                                                                                                 | Drops every core AI table and all stored AI configuration, conversations, attempts, files, and sources.                                                                                        |
| [`20260729T120000-ai-reliability.ts`](../apps/server/src/database/migrations/20260729T120000-ai-reliability.ts)                                                 | Adds immutable attempt lineage, idempotency fingerprints, upload batches, and storage-cleanup state. Backfills each run's root, terminal response snapshot, assistant-message projection, and run-scoped message sources; the migration aborts if mandatory source/run links cannot be backfilled. | Removes lineage, response snapshots, upload-batch and cleanup metadata. Base conversation/message rows remain, but the added audit and retry state is lost.                                    |
| [`20260729T180000-ai-context-editor-actions.ts`](../apps/server/src/database/migrations/20260729T180000-ai-context-editor-actions.ts)                           | Enables the current document by default, marks existing non-empty titles as manual, and adds versioned conversation context, immutable run-context/source-dependency snapshots, and expiring auxiliary title/editor runs.                                                                          | Drops context, dependency, and auxiliary-run tables and their conversation/run columns. Saved selections and auxiliary history are lost.                                                       |
| [`20260729T220000-open-webui-rag.ts`](../apps/server/src/database/migrations/20260729T220000-open-webui-rag.ts)                                                 | Adds the `open-webui-knowledge-v1` retrieval configuration, encrypted credential storage, and attachment update/delete feed indexes.                                                                                                                                                               | Changes affected adapters to `none`, drops the Open WebUI URL, credential, and Knowledge ID columns, and removes the attachment indexes.                                                       |
| [`20260729T230000-ai-reasoning.ts`](../apps/server/src/database/migrations/20260729T230000-ai-reasoning.ts)                                                     | Adds the per-space reasoning switch, streamed message reasoning, and immutable run reasoning snapshot.                                                                                                                                                                                             | Deletes stored reasoning values and the configuration switch.                                                                                                                                  |
| [`20260730T120000-ai-content-policy.ts`](../apps/server/src/database/migrations/20260730T120000-ai-content-policy.ts)                                           | Adds space-scoped exclusion policies, descendant selection, prompt-history cutoffs, and bounded expanded context snapshots. Existing conversations default to no descendant expansion.                                                                                                             | Deletes exclusion policy and descendant-selection data and removes the associated conversation/context columns.                                                                                |
| [`20260730T130000-ai-assistant-identity.ts`](../apps/server/src/database/migrations/20260730T130000-ai-assistant-identity.ts)                                   | Adds optional assistant name and grammatical gender. Existing spaces remain disabled and use the masculine default until explicitly configured.                                                                                                                                                    | Deletes saved assistant identity settings.                                                                                                                                                     |
| [`20260730T140000-ai-agent-mcp.ts`](../apps/server/src/database/migrations/20260730T140000-ai-agent-mcp.ts)                                                     | Adds Agent enablement/verification, conversation and run execution modes, durable tool/approval steps, and the authoritative `rag` or `mcp` API-key type. Existing keys default to `rag`.                                                                                                          | Deletes tool-step and approval history, Agent state, and API-key type metadata; use runtime switches for operational rollback.                                                                 |
| [`20260730T150000-remove-legacy-ee-imports-and-ai-search.ts`](../apps/server/src/database/migrations/20260730T150000-remove-legacy-ee-imports-and-ai-search.ts) | Fails in-flight retired Confluence and DOCX imports, removes legacy workspace AI-search settings, and drops `page_embeddings`.                                                                                                                                                                     | No-op: removed settings, embeddings, and prior in-flight task state are not restorable.                                                                                                        |
| [`20260803T120000-ai-external-mcp.ts`](../apps/server/src/database/migrations/20260803T120000-ai-external-mcp.ts)                                               | Adds the disabled-by-default outbound MCP catalog, encrypted headers, layered workspace/space/group/user policy, run snapshots, and read-only external step provenance.                                                                                                                            | Drops the catalog, encrypted headers, policy/preferences, run snapshots, and external step metadata. Export configuration first; use `AI_EXTERNAL_MCP_ENABLED=false` for operational rollback. |
| [`20260804T120000-ai-citations.ts`](../apps/server/src/database/migrations/20260804T120000-ai-citations.ts)                                                     | Marks existing sources as `legacy`, adds stable candidate/citation keys and section/display metadata, snapshots citation headings, and normalizes historical `database` sources to their page identity. Historical answer text is not rewritten.                                                   | Drops citation metadata and heading snapshots. The prior `database` source type is not reconstructed from normalized page rows.                                                                |
| [`20260805T100000-ai-assistant-profiles.ts`](../apps/server/src/database/migrations/20260805T100000-ai-assistant-profiles.ts)                                   | Adds disabled-by-default workspace/profile/group/user policy, exact external-tool selections, immutable conversation/run/provider snapshots, and Agent verification rows. Existing conversations keep the legacy no-profile path.                                                                  | Destroys profile configuration, preferences, verifications, and immutable profile/provider history; use deployment or workspace switches instead.                                              |
| [`20260805T110000-ai-builtin-tool-policy.ts`](../apps/server/src/database/migrations/20260805T110000-ai-builtin-tool-policy.ts)                                 | Adds exact workspace/space capability policy and run snapshots. Seeds workspaces with the eleven legacy Agent capabilities and existing MCP keys with the seven legacy read capabilities.                                                                                                          | Deletes saved policy, API-key capability lists, and run snapshots; use policy switches or `AI_BUILTIN_TOOL_EXTENSIONS_ENABLED=false` instead.                                                  |
| [`20260806T090000-rag-sync-bindings.ts`](../apps/server/src/database/migrations/20260806T090000-rag-sync-bindings.ts)                                           | Adds disabled-by-default per-space RAG Sync bindings, encrypted writer credentials, lifecycle revisions, cleanup state, and unique target claims. Existing standalone env bindings and secrets are intentionally not imported.                                                                     | Deletes binding configuration, writer credentials, cleanup state, and target reservations; use `RAG_SYNC_ENABLED=false` for operational rollback instead.                                      |
| [`20260811T190000-rag-sync-target-verification.ts`](../apps/server/src/database/migrations/20260811T190000-rag-sync-target-verification.ts)                     | Adds nullable `last_tested_at` evidence for the current Open WebUI target and writer credential. Existing bindings remain unverified and must pass Test before a later Enable.                                                                                                                     | Removes target-test evidence; use `RAG_SYNC_ENABLED=false` for operational rollback instead of removing the column.                                                                            |
| [`20260807T140000-search-guillemet-indexing.ts`](../apps/server/src/database/migrations/20260807T140000-search-guillemet-indexing.ts)                           | Rebuilds page and attachment search vectors after removing guillemet delimiters before `f_unaccent`, preserving the enclosed searchable terms for AI context and ordinary search.                                                                                                                  | Restores the prior trigger expressions and rebuilds both vectors; words enclosed in guillemets may again disappear from search.                                                                |
| [`20260820T130000-knowledge-projection-dictionary-search.ts`](../apps/server/src/database/migrations/20260820T130000-knowledge-projection-dictionary-search.ts) | Extends only the persisted AI source-type constraint with `dictionary_term`; it performs no index build or table rewrite.                                                                                                                                                                          | Deletes persisted `dictionary_term` citations before restoring the old source-type constraint. Those citation rows are intentionally not recoverable by `down`.                                |
| [`20260820T140000-search-dictionary-database-projection.ts`](../apps/server/src/database/migrations/20260820T140000-search-dictionary-database-projection.ts)   | Builds trigram expression indexes for dictionary terms, definitions, and normalized aliases; adds the database search projection columns/trigger; rewrites existing `pages` rows; and builds the partial database-projection GIN index.                                                            | Drops the database-projection index, trigger, function, and columns, then drops the three dictionary trigram indexes.                                                                          |
| [`20260827T010000-ai-rag-search-done-filter.ts`](../apps/server/src/database/migrations/20260827T010000-ai-rag-search-done-filter.ts)                           | Adds the disabled-by-default `rag_search_done_only` space policy and a partial workspace/space/status index for active page-backed RAG sources. Existing spaces preserve their current output.                                                                                                     | Drops the status index and policy column; the runtime again uses the broad explicit-exclusion policy only.                                                                                     |

Apply the ordered set with `pnpm --filter ./apps/server migration:latest` only
after a database backup and normal deployment review. A schema `down` operation
is not an operational feature rollback unless the applicable row above states
that its data loss is acceptable.

## 5. Built-in synchronization with Open WebUI

RAG Sync is an optional module in the main Docmost backend. It does not require
a second process, API key, JSON configuration, Compose profile, or Docker image.
One binding belongs to one Docmost space and claims one pre-created Open WebUI
Knowledge Base. A target fingerprint derived from the normalized Open WebUI
origin and Knowledge ID prevents two spaces from writing to the same target.
Saving a complete target reserves that claim before Test or Enable. Space
administrators are therefore trusted not to reserve targets they do not own;
clear an unused clean binding to release its active claim.

Persistent per-space configuration is stored in PostgreSQL. The Open WebUI
writer credential is encrypted with `APP_SECRET` and API responses expose only
`writerApiKeyConfigured` plus the non-secret `lastTestedAt` timestamp. A
successful bounded probe records `rag_sync_bindings.last_tested_at`; changing
the target or writer key clears it. Existing bindings are intentionally not
backfilled because historical probe success cannot be reconstructed safely.
Query-time retrieval remains independent and keeps
its own adapter and query credential. The public `/api/rag/*` surface also
remains independent and continues to authorize an external indexer through a
space-scoped RAG API key. Keep `APP_SECRET` stable across replicas and restarts.
Before rotating it, normally disable every RAG sync binding and wait until each
cleanup finishes: the same secret protects writer credentials and signs remote
ownership metadata. After the rotation, re-enter the writer credentials and
enable the bindings again. If the secret was rotated before cleanup, restore the
previous value first so Docmost can verify and remove the existing managed
files; do not abandon those targets merely to work around the rotation.

When query-time retrieval uses `open-webui-knowledge-v1`, Enable additionally
requires the normalized retrieval origin and Knowledge ID to match the writer
target. Mismatch returns `409 rag_sync_target_mismatch`; the UI treats it as a
blocking alert and offers to copy the existing space-search target into the
disabled, clean writer binding. Every runtime quantum repeats the comparison from PostgreSQL
before any remote write, so a later mismatch stops the binding non-retryably
without writing to the wrong Knowledge Base. The writer key remains separate
and must still pass its own upload/process/delete Test.

The binding state machine is `disabled | enabled | draining`. Normal disable
stops new uploads and removes only files whose versioned `docmost` metadata
proves ownership by the binding. Cleanup completes only after two stable empty
remote scans in the same configuration generation. Target fields remain locked
until cleanup succeeds. After successful cleanup, the active claim remains
attached while the target is configured; changing or clearing a clean target
atomically releases that claim. Force disable is an emergency stop, not proof
of remote deletion.
Space and workspace deletion fail closed while an active or cleanup-required
binding exists.

The source exporter uses every live non-template page in the space except pages
excluded by `AiContentPolicyService`. With `ragSearchDoneOnly`, the database
document and every row are filtered independently by their own status. A
status-blocked database document is removed while eligible rows continue to be
projected with the database schema as service context. Attachments follow the
owner page and dictionary terms remain independent. Template catalog entries are not indexed;
pages created from regular or synchronized templates are ordinary materialized
pages and are indexed normally. This intentionally differs from `/api/rag/*`,
where the key creator's current page ACL remains part of the scope. Query-time
Open WebUI results still pass through Docmost source resolution and the
requesting user's current ACL. Direct user access to the Open WebUI Knowledge
Base is not safe because the external index contains the full policy-allowed
space scope.

All page/database/row Markdown is produced by `KnowledgeProjectionService`.
The scope/feed fingerprint contains projection version `1`, the enabled
document-field mask, the dictionary switch, `ragSearchDoneOnly`, explicit
exclusions, and `statusBlockedPageIds`. A change resets the applicable
update checkpoints, reconciles stale remote mappings, and reprojects existing
documents without relying on an event being delivered. Entity changes,
referenced member display-name changes, database schema/cell/row changes, and
dictionary mutations wake the supervisor only after commit; business writes do
not wait for Open WebUI and delivery remains at least once.

Moving a page across an excluded subtree boundary, crossing the `DONE` status
boundary, and moving a page tree to the trash wake the matching space binding
immediately after commit. Restoring a
page tree also refreshes the projection timestamps of every restored page and
its live attachments before waking the binding. The update and attachment
feeds can therefore upload a restored source even when its earlier deletion
tombstone already advanced the checkpoints. Query-time retrieval applies the
new exclusion and deletion state immediately; remote Open WebUI convergence
remains asynchronous and does not extend the page-mutation transaction.

Attachment update feeds include only attachments whose parent page is still
live in the same workspace and space. A page, database, or attachment can still
disappear after a feed snapshot; the embedded synchronizer treats that race as
a deletion, schedules cleanup of its managed remote files, and advances the
feed instead of retrying an internal not-found error indefinitely.
The portable Open WebUI document contract sends only PDF, DOCX, TXT, and
Markdown attachments. When Docmost has already indexed text from a PDF or DOCX,
the embedded synchronizer uploads a Markdown text projection instead of asking
the target to parse the binary again; ownership metadata still identifies the
original attachment. TXT and Markdown keep their original portable content.
Remote attachment file names include the Docmost attachment ID, preventing
same-named attachments from colliding inside one Knowledge Base.
The upstream `file_hash` is scoped to the source operation so equal content
from distinct sources remains valid; signed ownership metadata retains the
source content hash used by Docmost reconciliation.
JPEG, PNG, and WebP remain available in Docmost but are not synchronized because
their processing depends on target-specific OCR or vision configuration and can
otherwise poison an incremental document queue.

Retryable upstream and infrastructure errors keep bounded exponential backoff.
A non-retryable runtime error stops an enabled binding with the stable error
code instead of creating a retry storm. `rag_sync_target_unavailable` also
clears `lastTestedAt`, so the missing Knowledge Base must pass Test again before
Enable is accepted. Runtime failure logs contain only an allowlisted processing
stage and source kind; they never include source identifiers, target URLs,
credentials, or document content.

The settings screen presents the required order as a three-step workflow:
save the target, verify the writer, then enable synchronization. A new or
changed target uses one primary **Save and verify writer** action. Test begins
with a bounded read-only Knowledge Base preflight. A failure before any remote
write leaves `cleanupRequired=false`. Only after that preflight succeeds does
Docmost durably arm cleanup and upload the marker; from that point an interrupted
or failed write/process/delete stage keeps `cleanupRequired=true` until managed
files are confirmed absent. Recovery accepts an optional replacement writer key
and then retries cleanup as one sequential UI operation. While cleanup is
required or the binding is draining, the client polls the redacted status every
10 seconds. Abandon cleanup remains an explicitly dangerous secondary action.

The existing Test endpoint preserves safe, actionable writer codes instead of
collapsing them into `rag_sync_target_unavailable`. These include
`rag_sync_url_rejected`, `rag_sync_writer_unauthorized`,
`rag_sync_target_timeout`, `rag_sync_processing_timeout`,
`rag_sync_processing_failed`, `rag_sync_invalid_response`,
`rag_sync_redirect_rejected`, `rag_sync_source_too_large`,
`rag_sync_lease_lost`, and `rag_sync_aborted`; an unknown writer failure still uses the generic
unavailable code. The UI shows the safe reason and next recovery step in the
main flow, keeps timestamps and technical state in expandable details, and
stores the latest UI operation result only in transient component state.

The management contract is:

- `GET /api/spaces/:spaceId/ai/rag-sync` reads redacted configuration and status;
- `PATCH /api/spaces/:spaceId/ai/rag-sync` changes target fields only on a
  disabled, clean binding, rotates its writer key while enabled, and applies
  optimistic `expectedVersion` checking;
- `POST /api/spaces/:spaceId/ai/rag-sync/actions/test` first performs a bounded
  read-only target preflight on a clean disabled binding. It then durably marks
  cleanup as required before the upload/process/delete probe; only confirmed
  marker deletion clears that flag and records `lastTestedAt`, so a preflight
  failure stays clean while an interrupted write-stage test requires cleanup;
- `POST /api/spaces/:spaceId/ai/rag-sync/actions/enable` starts scheduling only
  after the current target and writer credential have passed Test. Otherwise it
  returns `rag_sync_target_not_tested`;
- `POST /api/spaces/:spaceId/ai/rag-sync/actions/disable` enters draining;
- `POST /api/spaces/:spaceId/ai/rag-sync/actions/retry-cleanup` resumes cleanup;
- `POST /api/spaces/:spaceId/ai/rag-sync/actions/force-disable` stops work while
  retaining the cleanup requirement and target claim;
- `POST /api/spaces/:spaceId/ai/rag-sync/actions/abandon-cleanup` requires an
  explicit acknowledgement and leaves an orphaned claim that prevents unsafe
  target reuse.

The runtime uses the shared deployment Redis under
`RAG_SYNC_REDIS_PREFIX=docmost:rag-sync`. Versioned keys hold target-specific
feed progress, checkpoints, mappings, scope fingerprints, reconciliation time,
operational status, and short-lived per-space administration locks. The admin
locks serialize Test and configuration changes without reserving a PostgreSQL
pool connection. A global semaphore limits concurrent bindings and a
random-token lease selects one owner per binding across backend replicas.
Renewal is sequential. Every mapping/checkpoint mutation is a Lua operation
that verifies the current lease token, so a stale replica cannot commit state.
Loss of either the binding lease or global concurrency slot aborts the current
quantum. Upload, delete, list, and processing-poll boundaries check the signal
before and after I/O; after observed loss the runtime starts no new remote work
and performs no unfenced state write. Uncertain side effects are found by
deterministic operation metadata before retry.

Reconciliation runs on first use, after state loss, target/scope change, and
periodically. It accepts legacy schema-v1 metadata for adoption and cleanup but
writes only schema v2 with binding, workspace, space, source, content hash,
target version, and operation identity. Foreign files and whole Knowledge Base
objects are never deleted. Deletions are scheduled ahead of updates; one feed
page is processed per scheduling quantum so a large space cannot starve another.
Mapping and ownership metadata use nullable `pageId` for `dictionary_term` and
a required page UUID for page-backed sources. Dictionary update/delete
checkpoints are independent; disable drains term files and re-enable backfills
them through fingerprint replay.

Deployment configuration contains no per-space identifiers or secrets:

```dotenv
RAG_SYNC_ENABLED=false
RAG_SYNC_ALLOWED_ORIGINS=
RAG_SYNC_REDIS_PREFIX=docmost:rag-sync
RAG_SYNC_POLL_INTERVAL_MS=60000
RAG_SYNC_DISCOVERY_INTERVAL_MS=30000
RAG_SYNC_MAX_CONCURRENT_BINDINGS=4
RAG_SYNC_MAX_CONCURRENT_DOCUMENTS=4
RAG_SYNC_REQUEST_TIMEOUT_MS=30000
RAG_SYNC_PROCESSING_TIMEOUT_MS=600000
RAG_SYNC_MAX_ATTACHMENT_BYTES=26214400
RAG_SYNC_RECONCILE_INTERVAL_MS=21600000
RAG_SYNC_SHUTDOWN_TIMEOUT_MS=30000
```

`RAG_SYNC_ALLOWED_ORIGINS` is an exact-origin SSRF boundary independent of the
model and retrieval allowlists. Writer requests use bounded bodies, DNS pinning,
manual redirect handling, safe error codes, and the configured timeouts. Setting
`RAG_SYNC_ENABLED=false` is the operational rollback and does not make Docmost
health fail. The ordinary `docker compose up -d --build` command includes this
runtime in the main image; there is no additional profile or release image.

Upgrade from the retired standalone worker with a database backup and an
explicit single-writer cutover: stop the old worker, deploy and migrate the new
server with `RAG_SYNC_ENABLED=false`, configure the deployment writer allowlist,
then configure and Test each space binding before enabling it. The API enforces
this order. Do not import the
old per-space environment secrets automatically. Revoke the old Docmost RAG API
keys only after the embedded binding is healthy. Initial reconciliation accepts
legacy schema-v1 ownership metadata and writes only schema v2 thereafter.

Emergency rollback is the deployment switch, not migration down. Keep the new
tables and remote Knowledge Bases. A down migration destroys encrypted writer
credentials and target claims. The old standalone worker may return only with
the previous application version and its previous credentials, after the
embedded runtime has been confirmed disabled.

Every server process writes a 60-second low-cardinality AI summary for queue
wait, run/provider outcomes, timeouts, retrieval, reconciliation, and rejected
files. The RAG/MCP admission layer writes request latency, response size,
429/503 saturation, and MCP tool latency/result-size summaries. These records
never include prompts, document content, credential-bearing URLs, API-key IDs,
user IDs, tokens, or source IDs. They use the existing application logger and
do not introduce a metrics exporter or diagnostics endpoint.

## 6. Inbound MCP for external assistants

### Purpose and relationship to RAG

Inbound MCP is the interactive external-assistant surface. It is intended for a model
or agent that needs to search and navigate one Docmost space while answering a
user. It does not replace query-time retrieval or the synchronization API:

| Surface                 | Caller                            | Primary use                                              | Credential                        | Data access                                                                                               |
| ----------------------- | --------------------------------- | -------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| query-time retrieval    | the Docmost AI worker             | add ranked external context to one answer                | provider-side                     | validated excerpts returned by the configured retrieval adapter                                           |
| `/api/rag/*`            | an external indexer               | bulk/delta synchronization and export                    | `keyType=rag`                     | pages, databases, comments, exports, and allowed attachment data                                          |
| `/mcp` (inbound)        | an external MCP-capable assistant | interactive search and targeted document reading         | `keyType=mcp`                     | seven baseline reads plus explicitly selected opt-in reads; no attachment body extraction                 |
| external MCP (outbound) | the Docmost AI worker             | call approved read-only remote tools during an agent run | per-server encrypted HTTP headers | the prompt, selected context, and page text are sent outward; the remote result returns as untrusted data |

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

The endpoint is always mounted; there is no MCP transport feature environment
variable. `AI_BUILTIN_TOOL_EXTENSIONS_ENABLED` only caps the optional shared
tool catalog and does not disable the seven baseline MCP reads.
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

The token appears only in the post-creation step. Ordinary key lists, update
responses, React Query list caches, and browser storage contain metadata only;
the create mutation discards its response immediately after handing the token
to the one-time modal. The step polls `lastUsedAt` and reports when the first
connection reaches Docmost.

### Creating and validating an MCP key

Workspace owners and administrators create the key on the MCP tab of
`/settings/keys` (`/settings/keys/mcp`) through the fixed MCP flow: space,
exact non-empty read capability selection, name/expiry, client, creation, and
connection. Existing MCP keys were migrated to the exact seven legacy read
capabilities. The JWT shape is unchanged; the authoritative
`api_keys.allowed_capabilities` row is read for every request. RAG keys reject
this field. The legacy `/settings/api-keys`
and `/settings/ai/mcp` URLs redirect to this tab.
`/settings/account/api-keys` and `/settings/ai/rag` redirect a workspace owner
or administrator to `/settings/keys/rag`, and `/settings/account/api-keys`
redirects a member to their profile. RAG and MCP key management is
therefore workspace-admin-only; existing member-created RAG tokens are not
revoked or migrated and continue through the normal live validation rules.
The plaintext token is returned during creation and must be stored securely.
The UI always selects an explicit 30, 60, 90, or 365 day expiry (or a valid
custom future date); it does not present an unlimited option.
`keyType`, `spaceId`, `creatorId`, and `expiresAt` are immutable after
creation. Supplying any of them to the update endpoint is rejected with `400`
rather than silently ignored; rotate the key to change scope, type, creator, or
expiry.

The JWT embeds `apiKeyId`, creator `sub`, `workspaceId`, `spaceId`, and
`keyType=mcp`, but the database row remains authoritative. Every request
revalidates all of the following:

- the token signature, issuer, and expiry;
- the live API-key row, type, scope, revocation state, and optional hard
  expiry;
- the active workspace, unarchived space, and key creator;
- the creator's active/deactivated/deleted state;
- current space membership for a non-admin creator;
- page ACL and AI content-exclusion policy for each returned page.

Archiving the scoped space invalidates its RAG and MCP keys immediately. New
keys cannot be created for an archived space; unarchive the space and rotate the
integration key if the integration must be restored.

An MCP token is accepted only on `/mcp`. RAG tokens, user access tokens,
cookies, and revoked or wrong-space keys are rejected. MCP tokens are rejected
on `/api/rag/*` and ordinary user API routes. The endpoint is CSRF-exempt
because it is bearer-only and does not accept cookie authentication.

### Read tools

All inputs use Docmost UUIDs and node identifiers returned by earlier tool
calls. Optional limits are clamped by server-side validation, not only
described in JSON Schema.

| Tool                         | Main inputs                                           | Result and bounds                                                                                                            |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `search`                     | `query`, optional `limit`                             | accessible pages/database rows enriched with document fields plus enabled dictionary terms; shared default 10, maximum 20    |
| `getTree`                    | none                                                  | readable hierarchy metadata, size-truncated within the 32 KiB tool limit; a hidden parent is returned as `parentPageId=null` |
| `getPageContext`             | `pageId`                                              | page metadata and server-resolved document fields, visible allowed breadcrumbs, and up to 50 readable direct children        |
| `getPage`                    | `pageId`                                              | title, document fields, text, editor JSON when compact, outline fallback, update time, and a `truncated` flag                |
| `getOutline`                 | `pageId`                                              | up to 300 structural nodes with index, optional stable ID, type, nesting level, and compact text                             |
| `getNode`                    | `pageId`, `nodeId`                                    | one ProseMirror node selected by stable ID or a fallback such as `#12` from the outline index                                |
| `searchInPage`               | `pageId`, `query`, optional `limit`                   | case-insensitive matches with character offsets and bounded excerpts; default 20, maximum 50                                 |
| `getWorkspaceContext`        | none                                                  | curated workspace identity and actor role; never raw workspace settings                                                      |
| `getSpaceContext`            | none                                                  | current-space metadata, explicit `spaceRole`, workspace role, and safe actor capability flags                                |
| `getDatabaseContext`         | `databaseId`                                          | database document fields, normalized property schema/options, and compact views                                              |
| `listDatabaseRows`           | `databaseId`, optional `limit`, `cursor`              | readable row pages, their document fields, and named/explicit cells; default 20, maximum 50                                  |
| `getDatabaseRowContext`      | `pageId`                                              | readable row fields, database root, schema/options, and named/explicit cells                                                 |
| `getTable`                   | `pageId`, `tableRef`                                  | bounded text/cell-ID matrices for one structural table                                                                       |
| `listComments`               | `pageId`, optional `limit`, `cursor`                  | active comments, parent/resolution state, compact content, and safe actors; maximum 50                                       |
| `listPageHistory`            | `pageId`, optional `limit`, `cursor`                  | version metadata only; maximum 50                                                                                            |
| `diffPageVersion`            | `pageId`, `historyId`                                 | bounded semantic version-to-live-Yjs diff, integrity counts, and current hash                                                |
| `listTransclusionReferences` | `sourcePageId`, `transclusionId`, optional pagination | readable, same-space, non-excluded reference pages                                                                           |
| `listPageAttachments`        | `pageId`, optional pagination                         | metadata/index status only; no path, bytes, extracted text, or token; maximum 100                                            |
| `getPublicShareInfo`         | `pageId`                                              | effective direct/inherited share state, indexing flag, and public URL                                                        |
| `listPageTemplates`          | optional `query`, `limit`                             | readable regular and synchronized templates in the key/run's current space; metadata only, maximum 50                        |
| `getPageTemplateMetadata`    | `pageId`                                              | safe metadata, kind, and archive state for one readable regular or synchronized template in the current scoped space         |
| `listPageTemplateUsages`     | `pageId`, optional `limit`                            | readable pages created from the template, excluding detached pages; maximum 50                                               |

Paginated built-in reads use opaque versioned keyset cursors bound to the tool
name and target resource. Replaying a cursor for another page, database, or
tool, or supplying a malformed or oversized cursor, returns `400`; cursors do
not encode a caller-controlled SQL offset.

`getPage` includes full editor JSON only when its serialized document fits the
compact-response threshold. For larger pages it returns `content=null`, at
most 16,000 text characters, and up to 80 outline items, with
`truncated=true`. A client can then use `getOutline`, `getNode`, and
`searchInPage` to read only the relevant sections. When an outline item has no
stable `id`, use `#<index>` as the `getNode.nodeId`.

Search and tree results include database rows where the underlying search/page
model represents them as pages. The opt-in database, table, comment, history,
attachment, transclusion, template, and share tools remain read-only. The
three template capabilities are `page.templates.list`,
`page.template.metadata.read`, and `page.template.usages.read`. They are not
part of either legacy catalog and require the deployment extension switch,
workspace and space exact allowlists, current template policy, and (for MCP)
the authoritative one-space API-key capability. Hidden or cross-space
consumers are neither returned nor included in the MCP-visible usage count.
MCP does not
provide database mutation, schema editing, comment mutation, restore, export,
attachment bodies, or page-management tools.

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

## 7. Outbound external MCP servers

Docmost is the MCP **client** here, calling remote servers on behalf of the
internal agent. This is the opposite direction from section 6.

Server code lives in `apps/server/src/core/ai/mcp`, client code in
`apps/client/src/features/ai-external-mcp`, and contracts in
`packages/api-contract/src/ai-external-mcp.ts`.

### The access gate

A tool is offered to the model only when every factor holds:

```
AI_EXTERNAL_MCP_ENABLED        (deployment kill switch, default false)
  and workspace master switch  (ai_mcp_workspace_settings.enabled, default false)
  and server enabled           (ai_mcp_servers.enabled, default false)
  and space binding enabled    (ai_mcp_space_bindings.enabled, default false)
  and no group denies it       (ai_mcp_group_policies.deny_connection)
  and the user opted in        (ai_mcp_user_preferences.enabled, default false)
```

Every level defaults to closed, and a missing row means disabled. A lower scope
can only narrow a higher one: a space may pick from the workspace catalog and
reduce the tool list, and a workspace allowlist entry is rejected unless the
deployment allowlist already contains it.

The effective tool set is the intersection of the workspace-approved read tools,
the space allowlist, the selected assistant profile's exact relation rows, and
every group allowlist that applies to the calling user. The dormant
`profile_allowed_tools.default` JSON remains only for legacy no-profile runs;
profile-aware runs do not inherit it.

### Lifecycle

1. A workspace administrator creates a server. It is **always stored disabled**.
2. `actions/test` opens a throwaway connection, initializes, and closes it.
3. `actions/discover` walks `tools/list` pagination, accepting at most 128 tools
   across at most 8 pages. Exceeding either limit rejects the whole discovery
   rather than truncating, because a truncated catalog would make "the
   administrator approved everything they saw" false. The probe and every page
   of discovery share one absolute deadline; pagination cannot multiply it.
4. The administrator approves tools individually and writes the model-facing
   description for each.
5. Only then can the server be enabled, and only with at least one approved
   tool.
6. A space administrator binds the server, optionally narrows the tool list,
   adds prompt hints, and manages per-group deny or tool-narrowing rules. When
   `groupPolicies` is present in the binding `PUT`, it fully replaces the
   binding's group rules in the same transaction and with the same single
   `policyVersion` increment; omitting it preserves the existing rules for API
   compatibility. A deny wins, while `toolSelection: "all"` adds no narrowing
   and a non-empty selected list is intersected with higher-scope allowlists.
7. Each user opts in per binding. Absence of a stored preference is opt-out.
   Changing a server URL atomically revokes every saved opt-in for that server,
   because the consent disclosure names the recipient host. Users must review
   and opt in to the new destination again. During an active run the composer
   permits revocation but does not permit a new opt-in.

### Why remote text is untrusted

A remote server controls its tool names, titles, descriptions, annotations, and
JSON Schemas. All of it is treated as hostile input:

- Remote titles and descriptions are **not stored**. Only a boolean recording
  that the server shipped prose is kept, so an administrator can see that fact
  without the text entering our data flow.
- `readOnlyHint` and the other annotations are displayed as claims and never
  used to decide the read/write class. The class is `read_only` because an
  administrator approved it, not because a server asserted it.
- JSON Schemas are rebuilt from an allowlist of structural keywords.
  `description`, `title`, `$comment`, `examples`, and `default` are dropped;
  `$ref`, `$defs`, `pattern`, string `enum`/`const` values, and dynamic object
  properties are dropped as well. Every remote property name is replaced by an
  opaque deterministic alias before the schema reaches the model, then mapped
  back immediately before the RPC. The mapping remains server-side. This
  removes remote-controlled prose from both keys and values while retaining a
  callable structural contract. Depth is capped at 5, nodes at 256, properties
  at 64 per object, and the serialized schema at 8 KiB.
- The only model-facing text about a tool is the description the administrator
  typed.
- Every result is wrapped in a server-generated envelope with
  `source: "external_mcp"` and `untrusted: true`, carrying the namespace only,
  never the URL or the server id.
- The agent preamble states the fixed Docmost policy first and the external-tool
  rules after it, and space hints last, explicitly marked as non-overriding. The
  remote server's own `instructions` are never placed in a prompt.

### Tool naming

`mcp__<namespace>__<slug>_<hash16>`, at most 64 characters. The namespace is
`^[a-z][a-z0-9_]{0,23}$` and is immutable after creation because it is part of
every tool name the model has already been shown. The hash is the first 16 hex
characters of `sha256(remoteName)`, taken from the full remote name, so two
remote names that collapse to the same slug still produce different tool names.
Discovery also rejects the entire catalog if two remote names ever map to the
same internal name. The `mcp__` prefix is reserved: the tool registry throws at
boot if a built-in tool claims it.

### Network policy

`AiMcpUrlPolicyService` wraps the shared outbound policy with three additional
constraints:

- **Dual allowlist.** The origin must appear in `AI_MCP_ALLOWED_ORIGINS` _and_ in
  the workspace allowlist. Membership is decided per parsed origin, never by
  string comparison. Docmost rejects an origin missing from either explicit
  allowlist before DNS resolution, so a denied hostname never causes an
  outbound DNS lookup.
- **No development escape hatch.** An unlisted origin is rejected even in
  development, unlike the provider and retrieval policies.
- **Loopback.** Rejected unconditionally in production. In development it is
  accepted only when both allowlists name it, so a local server can be tested
  without weakening the production posture.

Link-local, unspecified, and multicast addresses are always rejected, as are URL
credentials, query strings, and fragments. Only HTTP(S) and only Streamable HTTP
are supported: no stdio, no legacy SSE, no WebSocket, and no OAuth browser flow.

All transport policy lives in a `fetch` override rather than the transport's
`requestInit`, because the Streamable HTTP client overwrites `signal` on POST and
DELETE and does not spread `requestInit` at all for the GET SSE stream. The
override pins DNS results, forces `redirect: "manual"`, rejects every 3xx,
verifies the request URL has not drifted, and caps the response at 1 MiB while it
streams.

### Secrets

Request headers are validated case-insensitively against a blocklist covering
hop-by-hop, forwarding, cookie, and transport-owned names. `mcp-session-id`,
`mcp-protocol-version`, and `last-event-id` are on that list because the SDK
merges caller headers over its own. Limits are 20 fields, 8 KiB per value, and
32 KiB in total.

The whole map is stored as one AES-256-GCM envelope keyed from `APP_SECRET`.
Responses expose `headersConfigured` and, for workspace administrators only, the
header **names**. No endpoint returns a value, and no contract type has a field
that could carry one.

Update semantics: omitting `headers` keeps the stored ciphertext, `clearHeaders:
true` deletes it, and sending both is rejected. Deleting a server hard-deletes
the row so the ciphertext stops existing; run steps keep their audit trail
through an on-delete-set-null reference. Rotating `APP_SECRET` requires
re-entering headers.

### Connection pooling

Clients are cached per `serverId:configVersion:policyVersion`, so any version
bump yields a different key and a superseded client can never be found. Before
every lease the pool re-reads those versions from the database: Redis
invalidation on `ai:mcp:invalidate` is a latency optimisation, not a correctness
dependency, and a missed event costs one query.

At most 32 clients are cached, with a 5-minute idle and 30-minute absolute TTL.
Creation is single-flight. A retired entry aborts its holder immediately so the
lease fails fast rather than blocking a close for a full timeout. Any timeout,
abort, protocol error, oversized response, or unsupported content type discards
the connection, because the SDK settles the pending request on abort but only
`transport.close()` ends the underlying HTTP request and SSE stream.
Invalidation also aborts a pending build, so an obsolete client can never be
published after a config change. `OnModuleDestroy` rejects new acquisition and
closes everything, including builds that finish during shutdown.

### Run integration

When an agent run is created, a bounded snapshot is resolved **in the same
transaction** and stored in `ai_runs.mcp_policy_snapshot`: profile key, workspace
policy version, and per connection the server id, namespace, config version,
binding id, binding policy version, space hints, and the namespaced tool
definitions with their schema fingerprints. It carries no URL, no headers, and no
secret; the URL is re-read at connect time so it cannot go stale. The snapshot is
capped at 64 KiB and run creation fails closed above that rather than silently
narrowing what the space allowed.

Version 1 limits are 8 connections and 32 external tools per run, and at most 64
built-in plus external definitions in one model turn.

The snapshot is not authorization. Before every call, every 500 ms while a call
is active, and once again before accepting its response, the policy resolver
re-checks membership, the deployment and workspace switches, the server and
binding state, current group membership and denials, the current user opt-in, all
three version numbers, and the tool's schema fingerprint. Loosening policy after
a run starts does not widen it; any narrowing or version change aborts the
connection and ends the run with `agent_mcp_config_changed` or
`agent_mcp_access_revoked`. Retry, regenerate, and approval resume keep the
original snapshot and pass the same live checks.

External results flow through exactly the same budgets as built-in tool results:
32 KiB per result, 128 KiB cumulative, and the existing 16/64 tool-call ceilings.
Only MCP text blocks and JSON `structuredContent` are accepted; image, audio,
embedded resource, resource link, and task outputs are rejected. A valid MCP
response carrying `isError: true` is recorded as a failed external-tool step,
not returned to the model as a successful observation.

`ai_run_steps.tool_source` distinguishes `builtin` from `external_mcp`. An
external step is always `read_only`, never carries an `approvalPreview`, and
never participates in the approval or resume lifecycle.

External tools reach the internal agent only. Chat, query-time retrieval, and the
inbound `/mcp` surface never see them.

### Observability

The 60-second operational summary gains an `externalMcp` block: cache
hit/miss/evict/retire/close, test and discovery outcomes with latency, call
outcomes from a closed vocabulary, call latency, wire bytes, normalized result
bytes, and high-water lease counts. It records no workspace, server, tool, or
user id, no URL, no namespace, no arguments, and no output. Identifiers live only
in database rows.

### Rollout and rollback

The migration is additive. Deploy with `AI_EXTERNAL_MCP_ENABLED=false`, set the
deployment origins, then enable the workspace master switch and one test server
and space. Emergency rollback is flipping the deployment switch: the pool closes
its clients and the tables and ciphertext are preserved. Run the down migration
only after exporting configuration, because it drops the catalog and the stored
headers.

## 8. API

### Administrative UI routes

| Route                            | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `/settings/ai`                   | redirects to `/settings/ai/spaces`                                           |
| `/settings/ai/spaces`            | AI assistant overview with per-space configuration entry points              |
| `/settings/ai/built-in-tools`    | workspace policy for built-in Agent and inbound MCP capabilities             |
| `/settings/ai/external-tools`    | outbound external MCP catalog, tool approvals, and the workspace switch      |
| `/settings/ai/guide`             | administrator-facing AI/RAG/MCP operation and risk guide                     |
| `/settings/ai/spaces/:spaceSlug` | sectioned full-page configuration, including assistant profiles and RAG Sync |
| `/settings/keys`                 | "API keys" page; redirects to the MCP tab                                    |
| `/settings/keys/mcp`             | MCP onboarding and workspace MCP-key administration                          |
| `/settings/keys/rag`             | RAG synchronization onboarding and workspace RAG-key administration          |
| `/settings/ai/mcp`               | compatibility redirect to `/settings/keys/mcp`                               |
| `/settings/ai/rag`               | compatibility redirect to `/settings/keys/rag`                               |
| `/settings/account/api-keys`     | compatibility redirect to the RAG tab for admins or profile for members      |
| `/settings/api-keys`             | compatibility redirect to `/settings/keys/mcp`                               |

The space settings modal contains only an AI status summary and a link to the
full-page configuration. Workspace owners and administrators and space
administrators have full access to that route; writers and readers receive a
structured access-denied state without configuration or secret flags.
The full-page overview reports `requestsToday` and `tokensToday` from the start
of the current UTC day, plus `requestsLast7Days` and `tokensLast7Days` from the
seven UTC calendar days that include today. `activeRuns` remains an immediate
count rather than a period total.
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

| Method and path                                                       | Purpose                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET/PATCH /api/spaces/:spaceId/ai/config`                            | read or update space AI configuration                                                                                          |
| `GET/PATCH /api/ai/profile-policy`                                    | workspace profile and provider-override switches                                                                               |
| `GET/POST /api/spaces/:spaceId/ai/profiles`                           | member-safe picker list or create a profile                                                                                    |
| `GET/PATCH/DELETE /api/spaces/:spaceId/ai/profiles/:profileId`        | admin detail, optimistic update, or soft delete                                                                                |
| `POST /api/spaces/:spaceId/ai/profiles/:profileId/actions/test-model` | test the effective profile provider                                                                                            |
| `POST /api/spaces/:spaceId/ai/profiles/:profileId/actions/test-agent` | test and record the exact Agent verification                                                                                   |
| `GET/PUT /api/spaces/:spaceId/ai/profile-preferences`                 | current user's preferred and hidden profile IDs                                                                                |
| `GET/PATCH /api/ai/tool-policy`                                       | workspace catalog, master switch, stored exact allowlist, deployment `maximumCapabilities`, and active `effectiveCapabilities` |
| `GET/PUT /api/spaces/:spaceId/ai/tool-policy`                         | effective policy and optional exact space narrowing                                                                            |
| `POST /api/spaces/:spaceId/ai/config/actions/test-model`              | test the provider and optional vision                                                                                          |
| `POST /api/spaces/:spaceId/ai/config/actions/test-agent`              | force and validate provider tool calling                                                                                       |
| `POST /api/spaces/:spaceId/ai/config/actions/test-retrieval`          | test external retrieval                                                                                                        |
| `GET/PUT /api/spaces/:spaceId/ai/exclusions`                          | read or replace exclusion rules with optimistic revision                                                                       |
| `GET /api/spaces/:spaceId/ai/exclusions/candidates`                   | search page candidates for exclusions                                                                                          |
| `GET /api/spaces/:spaceId/ai/status?pageId=`                          | availability, permissions, identity, daily and last-7-calendar-day usage, active runs, and quick commands                      |
| `GET /api/dictionary-terms/word-form-generation/status?spaceId=`      | whether the configured space provider is available to a dictionary editor or workspace administrator                           |
| `POST /api/dictionary-terms/actions/generate-word-forms`              | return generated forms for one unsaved term form; requires dictionary edit access                                              |
| `POST /api/dictionary-terms/actions/generate-all-word-forms`          | generate and atomically save forms for every term; requires workspace `owner\|admin`                                           |
| `GET/POST /api/ai/conversations`                                      | list by required `pageId` or create a conversation                                                                             |
| `GET/PATCH/DELETE /api/ai/conversations/:id`                          | read, update, or soft-delete an owned conversation                                                                             |
| `POST /api/ai/conversations/:id/actions/open`                         | update the last-opened time                                                                                                    |
| `GET /api/ai/conversations/:id/messages`                              | list messages with `before` and `limit`                                                                                        |
| `GET/PUT /api/ai/conversations/:id/context`                           | read or version-replace context                                                                                                |
| `GET /api/ai/conversations/:id/context-sources`                       | search accessible explicit-context candidates                                                                                  |
| `GET /api/ai/conversations/:id/context-descendants`                   | lazily list accessible direct descendants of a page root                                                                       |
| `POST /api/ai/conversations/:id/messages`                             | send a message and create a run; returns `202`                                                                                 |
| `GET /api/ai/runs/:id`                                                | read a single attempt                                                                                                          |
| `POST /api/ai/runs/:id/steps/:stepId/actions/approve`                 | approve one pending agent write as its initiating user                                                                         |
| `POST /api/ai/runs/:id/steps/:stepId/actions/reject`                  | reject one pending agent write and resume the bounded loop                                                                     |
| `POST /api/ai/runs/:id/actions/cancel`                                | request cancellation                                                                                                           |
| `POST /api/ai/runs/:id/actions/retry`                                 | create a new attempt; returns `202`                                                                                            |
| `POST /api/ai/messages/:id/actions/regenerate`                        | regenerate an answer; returns `202`                                                                                            |
| `GET/POST /api/ai/conversations/:conversationId/files`                | list files or perform idempotent multipart upload                                                                              |
| `GET/DELETE /api/ai/conversations/:conversationId/files/:fileId`      | download or delete a private chat file                                                                                         |
| `GET /api/ai/pages/:pageId/attachments`                               | list page attachments available for context                                                                                    |
| `POST /api/ai/editor-actions`                                         | create an editor-selection transform; returns `202`                                                                            |
| `GET /api/ai/editor-actions/:id`                                      | read editor-action state                                                                                                       |
| `POST /api/ai/editor-actions/:id/actions/cancel`                      | cancel an editor action                                                                                                        |

Outbound external MCP adds the following. The `/ai/mcp-*` routes require
workspace `owner|admin`; the space routes require full space access, except
`mcp-preferences`, which is the calling user's own consent.

| Method and path                                             | Purpose                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET/PATCH /api/ai/mcp-settings`                            | read or update the workspace master switch and allowlist                              |
| `GET/POST /api/ai/mcp-servers`                              | list the catalog or create a server (always stored disabled)                          |
| `GET/PATCH/DELETE /api/ai/mcp-servers/:serverId`            | read, update, or hard-delete one server                                               |
| `POST /api/ai/mcp-servers/:serverId/actions/test`           | probe the connection without caching a client                                         |
| `POST /api/ai/mcp-servers/:serverId/actions/discover`       | list remote tools and store a sanitized snapshot                                      |
| `GET /api/spaces/:spaceId/ai/mcp-bindings`                  | read space bindings plus the bindable catalog                                         |
| `PUT/DELETE /api/spaces/:spaceId/ai/mcp-bindings/:serverId` | bind and narrow, fully replace optional group deny/tool rules, or remove the binding  |
| `GET/PUT /api/spaces/:spaceId/ai/mcp-preferences`           | read or fully replace the calling user's opt-in set; omitted bindings become disabled |

### Synchronization RAG API

Every `/api/rag/*` route is read-only (`GET`), does not use CSRF, and accepts
only `Authorization: Bearer <token>` from a workspace API key. User JWTs and
cookies are rejected, and API keys are rejected outside `/api/rag/*`. The key
contains `workspaceId`, `spaceId`, `apiKeyId`, and `sub`; key scope, current
creator membership, page ACL, and the content policy bound all live data.
Template catalog entries are excluded from feeds and direct page reads; pages
created from templates remain ordinary materialized pages in scope.
Cursor feeds are at least once, so consumers must perform idempotent
upsert/delete operations. Opaque cursor v2 is bound to the feed, workspace,
space, scope fingerprint, original watermark, database-derived snapshot upper
bound, and last `(timestamp, id)` position. A watermark advances only on the
terminal page; v1, cross-feed, cross-scope, or changed-watermark cursors fail
with `400 Invalid RAG feed cursor`.

`RagScope.projectionVersion` starts at `1`; the fingerprint also includes the
enabled document-field mask and dictionary switch. Detail responses preserve
legacy `contentMarkdown`/`rowMarkdown` and add canonical `knowledgeMarkdown`,
structured fields, named database cells, and `projectionUpdatedAt`. Feed
`updatedAt`/`updatedAtMs` are the latest RAG-relevant time across the entity,
database structure/content, and only referenced assignee/stakeholder user rows.
Attachment binaries are not replayed for parent-field changes; current parent
fields are joined when RAG or safe retrieval reads the attachment.

| Path                                                            | Data                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/rag/scope`                                            | schema-v3 policy and readable-page fingerprint                     |
| `GET /api/rag/scope/blocked?limit=&cursor=`                     | opaque IDs currently outside effective sync scope                  |
| `GET /api/rag/pages?includeContent=&limit=&cursor=`             | active page/database list with optional SQL-backed pagination      |
| `GET /api/rag/updates?updatedSince=&limit=&cursor=`             | changed pages and databases with database `documentEligible`       |
| `GET /api/rag/deleted?deletedSince=&limit=&cursor=`             | page/database/database-row tombstones                              |
| `GET /api/rag/attachments/updates?updatedSince=&limit=&cursor=` | changed attachments                                                |
| `GET /api/rag/attachments/deleted?deletedSince=&limit=&cursor=` | attachment tombstones                                              |
| `GET /api/rag/dictionary/terms?limit=&cursor=`                  | active dictionary term projections                                 |
| `GET /api/rag/dictionary/terms/:termId`                         | one active term projection                                         |
| `GET /api/rag/dictionary/updates?updatedSince=&limit=&cursor=`  | dictionary changes                                                 |
| `GET /api/rag/dictionary/deleted?deletedSince=&limit=&cursor=`  | dictionary tombstones                                              |
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

## 9. Contracts

Canonical TypeScript contracts live in `packages/api-contract/src/ai.ts` and
the built-in catalog/policy contracts live in
`packages/api-contract/src/ai-tools.ts`.
Important enumerations include provider `openai-compatible`; adapters `none`,
`http-json-v1`, and `open-webui-knowledge-v1`; run statuses `queued`, `running`,
`awaiting_approval`, `completed`, `failed`, and `cancelled`; execution modes
`chat` and `agent`; and source types `page`, `database`, `database_row`,
`attachment`, `dictionary_term`, and `chat_file`.
`packages/api-contract/src/rag.ts` also owns `RagDocumentCustomFields`, named
database property/cell projections, dictionary feed/detail DTOs, and
`RagScope.projectionVersion`.

The primary public models are `AiSpaceConfig`, `AiAvailability`,
`AiConversation`, `AiConversationContext`, `AiMessage`, `AiRun`, `AiCitation`,
`AiRunStep`, `AiChatFile`, and `AiEditorActionRun`. `AiRunStep` exposes the
discriminated `approvalPreview` for `editPageText`, `patchNode`, `insertNode`,
and `deleteNode`. Assistant messages expose `reasoning`,
`runStatus`, `retrievalOutcome`, `retrievalErrorCode`, `applyContext`, and
citations when applicable. Secret and credential fields are never part of
public models.

Assistant-profile contracts live in
`packages/api-contract/src/ai-profiles.ts`. Member-safe summaries expose display
fields, frozen quick commands, launch behavior, availability, and a coarse
Agent status. Only Manage Settings responses expose instructions, provider
overrides, exact tool selections, group policies, actor IDs, or verification
fingerprint details.

Outbound external MCP contracts live in
`packages/api-contract/src/ai-external-mcp.ts`: `AiExternalMcpSettings`,
`AiExternalMcpServerListItem`, `AiExternalMcpServer`,
`AiExternalMcpCatalogEntry`, `AiExternalMcpDiscoveredTool`,
`AiExternalMcpApprovedTool`, `AiExternalMcpBinding`,
`AiExternalMcpGroupPolicy`,
`AiExternalMcpUserPreference`, and their request types. `AiRunStep` gains
`toolSource` (`builtin | external_mcp`) and `toolNamespace`, and `AiAvailability`
gains an optional `externalMcp` block. Two invariants hold by construction: no
type in that file carries an HTTP header value, and
`AiExternalMcpApprovedTool.writeClass` is the literal `"read_only"`, which makes
an external write tool unrepresentable at compile time.

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
  sourceTypes: Array<
    "page" | "database_row" | "attachment" | "dictionary_term"
  >;
  limit: number;
  candidateLimit: number;
};

type AiRetrievalQueryResponse = {
  items: Array<{
    sourceType: "page" | "database_row" | "attachment" | "dictionary_term";
    sourceId: string;
    pageId: string | null;
    text: string;
    score?: number;
  }>;
};
```

`pageId` is `null` only for `dictionary_term`; every page-backed result requires
a UUID. This is a deliberate extension of `http-json-v1`, so external services
with strict response validators must add the new discriminant and nullable
branch before enabling dictionary retrieval.

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
`source_access_changed` means a previously accepted source became inaccessible
during execution; clients discard streamed state and reload the scrubbed,
access-restricted message.
