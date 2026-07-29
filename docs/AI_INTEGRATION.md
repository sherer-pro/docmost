# Built-in AI integration

Docmost provides a core, per-space OpenAI-compatible integration for private page conversations, document actions, file context, and optional retrieval from an external service. Chat history and runs are persisted; Socket.IO progress events are an optimization, while REST state remains authoritative after navigation or reconnects.

## Provider configuration

Each space has an independent record in `ai_space_configs`. Space administrators and workspace owners/admins can configure the provider base URL, chat model, generation limits, retention, vision, quick commands, and an optional retrieval adapter. Model and retrieval API keys are encrypted independently with the application credential-protection helper. API responses expose only whether each key is configured.

The first provider implementation is OpenAI-compatible. An API key is optional so local endpoints such as LM Studio can be used.

Set `AI_PROVIDER_ALLOWED_ORIGINS` to a comma-separated list of exact trusted `http(s)` origins:

```dotenv
AI_PROVIDER_ALLOWED_ORIGINS=https://llm.example.com
```

Development additionally permits loopback endpoints, including `http://127.0.0.1:56254`, when the backend runs directly on the host. When Docmost runs in Docker Desktop, use `http://host.docker.internal:56254/v1` as the space Base URL and add `http://host.docker.internal:56254` to `AI_PROVIDER_ALLOWED_ORIGINS`; `127.0.0.1` inside the container points back to Docmost itself.

For the current local LM Studio setup, use `google/gemma-4-26b-a4b-qat` as the model. The host-run Base URL is `http://127.0.0.1:56254/v1`; the Docker Base URL is `http://host.docker.internal:56254/v1`. These are setup examples only and are not application defaults.

Streaming has two independent limits. The per-space `requestTimeoutMs` limits the complete provider request, including body consumption. `AI_STREAM_IDLE_TIMEOUT_MS` limits the time between any two bytes received from the provider SSE stream, including the wait for the first byte and reasoning-only or keep-alive frames. The idle timeout defaults to 120000 ms, accepts 5000-600000 ms, resets for every received stream chunk, and is capped by the per-space request timeout. Slow local reasoning models may use 300000 ms:

```dotenv
AI_STREAM_IDLE_TIMEOUT_MS=300000
```

Increasing the idle timeout does not extend the complete request timeout. Keep `requestTimeoutMs` large enough for the expected generation while retaining a finite upper bound.

## API and permissions

Space configuration is available only to a space administrator or workspace `owner|admin`:

- `GET/PATCH /api/spaces/:spaceId/ai/config`
- `POST /api/spaces/:spaceId/ai/config/actions/test-model`
- `POST /api/spaces/:spaceId/ai/config/actions/test-retrieval`
- `GET /api/spaces/:spaceId/ai/status`

The status endpoint accepts an optional `pageId`. Page-scoped calls return chat availability after the current write ACL check. Calls without `pageId` require full space access and include only aggregate daily request/token and active-run counts.

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

## Persistence, queues, and files

The migration `20260728T120000-ai-integration.ts` creates:

- per-space configuration;
- private conversations, messages, generation runs, and chat files;
- immutable citation snapshots for sources used in assistant messages.

The additive reliability migration `20260729T120000-ai-reliability.ts` preserves and backfills existing data, adds immutable provider attempts, assistant `currentRunId` projections, run-scoped citations, upload batches, and storage-cleanup state. Existing terminal answers are copied into per-attempt `responseSnapshot` values.

The additive context/editor migration `20260729T180000-ai-context-editor-actions.ts` preserves existing conversations, enables the current document by default, and adds versioned conversation context, immutable run-context snapshots, source dependencies, and 24-hour auxiliary runs for conversation titles and selection-only editor transforms.

Every provider call is a new `ai_runs` attempt. Retry and Regenerate never reopen or erase a terminal run: they create a row linked through `rootRunId`, `previousRunId`, and `attemptNo`. They are allowed only for the latest assistant turn; older turns return `409 ai_run_not_latest`. A terminal attempt is immutable, and its usage, error, response snapshot, and citations remain available for audit.

AI generation, auxiliary title/editor operations, file extraction, and hourly retention cleanup run on `AI_CHAT_QUEUE`. The older `AI_QUEUE` remains untouched for existing page/index lifecycle jobs. Queue payloads contain only record IDs; workers resolve current configuration and encrypted credentials from the database.

BullMQ delivery is at-least-once; database transitions are effectively-once. Run and auxiliary jobs use deterministic identities (`ai-run-<runId>` and `ai-aux-<runId>`; BullMQ custom IDs cannot contain `:`), and a worker can claim each record only with an atomic `queued -> running` compare-and-set. Completion, failure, and cancellation are compare-and-set terminal transitions. The sequence is incremented in the same transaction as persisted state.

PostgreSQL is the source of truth when Redis is unavailable. A successfully admitted Send remains `queued` even if the initial `queue.add()` fails. A lifecycle-managed reconciler starts only after database migrations are ready, re-delivers missing deterministic jobs, resumes pending file work, and retries storage cleanup. Runs that cannot be delivered within five minutes fail with `queue_unavailable`. A running attempt without a heartbeat for 12 minutes is preserved as partial output and fails with `worker_lost`; it is never automatically sent to the provider again.

Admission uses transaction-scoped PostgreSQL advisory locks in the stable space/user/conversation order. Each provider attempt consumes a daily request. Queued/running attempts reserve estimated input plus maximum output tokens; terminal attempts account for actual usage. The partial unique active-run index remains the final one-run-per-conversation barrier.

By default, a space permits 100 requests per user per day, 2,000,000 input/output tokens per day, one active run per conversation, two per user, and eight per space. Conversations expire after 90 days. Deletion first commits database tombstones and cancellation requests, then retriable cleanup removes private storage; hard purge happens only after cleanup.

Private chat uploads support PDF, DOCX, TXT, MD, JPEG, PNG, and WebP. Limits are 10 files, 25 MiB per file, and 100 MiB per conversation. Upload batches move through `processing|completed|failed`; deterministic file IDs/storage keys and SHA-256 fingerprints make retries safe. Extraction claims only uploaded, non-deleted `pending` files with compare-and-set, so duplicate jobs cannot extract twice and deletion cannot be reverted to `ready`.

TXT/MD are decoded directly, DOCX uses `mammoth`, and PDF text uses `pdfjs-dist`. A textless PDF may be rendered for a configured vision model, up to 20 pages and the run's context/image budget. Existing page attachments are selected separately and their owning-page ACL is checked again by the worker.

Socket.IO emits monotonic `ai:run.delta`, `ai:run.status`, `ai:editor-action.delta`, and `ai:editor-action.status` events only to the owning `user-*` room. Conversation title changes use `ai:conversation.updated`. The database and REST API remain authoritative: clients ignore duplicate sequences and refetch after a gap or reconnect.

The client feeds REST results, deltas, status events, and reconnect recovery through one pure run-state reducer. Only active runs remain in ephemeral streaming state; a terminal run is pruned after persisted messages are refetched. Draft writes are serialized so an older response cannot replace a newer draft.

`AiOperationalMetricsService` keeps process-local, content-free aggregates for queue wait, first-token and total duration, cancel latency, attempt numbers, terminal statuses, reconciled jobs, retrieval outcomes, and file lifecycle transitions. Metrics and logs never include prompts, generated bodies, credentials, or remote response bodies; production deployments can export these aggregates through their existing monitoring boundary.

## Prompt and editor safety

The editor sends a Markdown document snapshot plus a SHA-256 hash of canonical editor JSON. It does not send TipTap JSON as model context. A selection is the primary document context; the enabled current document is the fallback. `AiPromptBuilderService` allocates context in this order: system/safety instructions, current prompt, selection/current document, explicit page/database/row snapshots, selected files, the latest complete user/assistant turns (at most 20 messages), then optional retrieval. It excludes the current turn and never starts history with an orphan assistant message.

The worker resolves every explicit source with current workspace/space/deletion/ACL checks before first use and stores immutable Markdown in `ai_run_context_sources`. Retry and Regenerate copy those snapshots instead of reading changed pages. Databases contribute their description and only readable rows within the shared budget. Every page that actually contributed content is recorded in `ai_run_source_dependencies`; losing access to any dependency hides the complete derived assistant response.

Selection AI captures the page ID, selected range/text, and canonical editor hash before focus leaves the editor. Its auxiliary run receives only the command and selection, without chat history, files, or retrieval. Replace/Insert actions require explicit confirmation, a current write check, and the unchanged hash. A stale result remains copyable but cannot mutate the editor.

Insert/Replace re-checks AI/page write availability immediately before mutation. If the canonical snapshot is unchanged, Insert uses the captured cursor or selection end; it never silently appends to the document end. A changed editor/page requires a fresh confirmation and uses only the current cursor. Generated Markdown and links remain sanitized.

## Optional external retrieval

The AI integration does not create a local embedding table or require pgvector. The existing `/api/rag/*` API remains the read-only, space-scoped synchronization surface for an external indexer. Query-time retrieval is a separate optional outbound adapter.

The supported adapter identifier is `http-json-v1`. In production, its URL must have an origin listed in `AI_RETRIEVAL_ALLOWED_ORIGINS`:

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

External results are candidates, not authorization decisions. Docmost resolves every returned ID against its own database, maps rows and attachments to their owning page, rejects deleted and cross-space sources, re-checks the requesting user's current page access, and constructs trusted titles and URLs locally. A run records whether retrieval was not requested, disabled, used, empty, or failed. A timeout, malformed response, authorization/rate-limit error, server error, or a result set with no currently readable sources does not fail the chat: generation continues with the live document and selected files, and the UI shows the retrieval outcome.

An external indexer normally uses two independent credentials:

- a space-scoped Docmost API key to synchronize content through `/api/rag/*`;
- an adapter credential stored by Docmost to query the external retrieval URL.

## Security properties

- Never store AI credentials in `spaces.settings`, logs, WebSocket events, or queue payloads.
- Validate provider and retrieval origins through the shared outbound URL policy while retaining independent allowlists and error codes, reject credentials and unexpected redirects, and re-check resolved addresses.
- Re-check conversation ownership and page access in both HTTP handlers and background workers.
- Emit private generation events only to the authenticated user's Socket.IO room.
- Treat external candidates as untrusted and build citations only after resolving source metadata and current page access server-side.
- Apply generated text to an editor only after explicit user confirmation and a fresh page/write-access check.

Provider streaming stores only `delta.content`; provider-specific reasoning fields are ignored. Redirects are rejected, full-request and idle timeouts start before DNS resolution and remain active until the response body is consumed, cancellation aborts URL resolution/header waits/body reads, and remote response bodies are never copied into client-facing errors or logs. JSON responses are limited to 4 MiB; SSE frames to 256 KiB; undecoded SSE buffers to 1 MiB; and cumulative generated content to 8 MiB.

Core per-space AI is the only document-generation UX. The former EE editor Ask AI menu and workspace `settings.ai.generative` toggle are no longer read or written; historical JSON values remain inert for rollback. Legacy EE AI search, `AI_QUEUE`, `PageEmbeddings`, indexing listeners, and `/api/ai/answers` remain independent and unchanged.

The client uses one Markdown sanitizer and safe-link policy for chat and selection results. `Copy` is always available for a normal assistant response. Replacing the original selection requires the same page and document snapshot hash; inserting below uses the original position only while that hash still matches. After the document changes, the chat flow may offer an explicitly confirmed insert at the current cursor, while selection-only actions become copy-only.

All core AI strings use explicit `ai.*` locale keys in every supported locale. Stable server error codes are resolved through a guarded localized fallback and never expose translation keys or remote provider messages. Service Worker cache version 3 loads `/locales/*` with a network-first strategy so an online client does not retain an older translation bundle.
