# Docmost Architecture

## Repository Shape

Docmost is a pnpm workspace orchestrated by Nx. The main runtime surfaces are:

- `apps/server` - NestJS API and a separate NestJS collaboration runtime, plus background jobs, migrations, and storage/search integrations.
- `apps/client` - Vite and React frontend.
- `apps/server/src/core/rag-sync` - optional built-in, per-space Docmost-to-Open-WebUI synchronizer.
- `packages/editor-ext` - shared Tiptap/ProseMirror editor extensions consumed by the client and server-side rendering paths.
- `packages/api-contract` - shared API-facing TypeScript contracts used by backend and frontend code.

The production container uses Node.js 22 and runs the built backend entrypoint directly with `node apps/server/dist/apps/server/src/main`. The root `pnpm build` task builds all workspace projects.

## Backend

The backend is organized around Nest modules under `apps/server/src/core`. Most HTTP controllers are served under the global `/api` prefix; explicit `robots.txt` and share SEO exclusions remain outside that prefix. Domain services own business rules and database writes. Kysely repositories under `apps/server/src/database/repos` encapsulate repeated database access patterns.

At the application level, `apps/server/src/app.module.ts` wires the HTTP API, core domain module, general Socket.IO relay, queue, static frontend serving, health, import/export, storage, mail, security/version support, Redis, and database access. It deliberately does not import the Hocuspocus collaboration runtime. `apps/server/src/collaboration/server/collab-app.module.ts` is the only application composition that owns Hocuspocus, `/collab`, Redis document leases, persistence hooks, and the collaboration history worker.

`CoreModule` currently groups auth, workspace, page, attachment, comment, search, space, group, share, notification/watcher, MFA, SSO, push, database, API key, RAG, AI, MCP, page access, dictionary, session, favorite, label, synced block transclusion, and presence functionality. The core AI feature keeps per-space provider and optional external retrieval configuration separate from `spaces.settings`, persists private per-user/page conversations, and treats background runs in the database as the source of truth while Socket.IO delivers realtime progress. Its access-aware tool registry is shared by the optional private-chat agent loop and the stateless read-only `/mcp` endpoint.

Reusable provider transport and configuration resolution are composed by the controller-free `AiProviderModule`. Feature modules outside the full AI surface depend on narrow ports: dictionary word-form generation injects `AI_TEXT_GENERATION_PORT` instead of importing `AiModule` or concrete provider/configuration services. `check:architecture` rejects Dictionary-to-AI implementation imports while allowing the port and its composition module.

Security-sensitive cross-cutting behavior is centralized:

- JWT authentication is enforced by controllers and gateways that opt into `JwtAuthGuard`; routes marked `@Public()` intentionally bypass it. Access tokens must carry a `sessionId` claim, which is validated against a live `user_sessions` row on every request; this is what makes logout, session revocation, and password reset effective. Session rows also record SSO and MFA assurance. Protected routes default to the workspace policy, while declarative space/page/resource scopes resolve `spaces.settings` overrides and return HTTP 428 when the current session needs step-up. Collab tokens carry the same session claim, are canonically bound to a page, and are validated by the collaboration server.
- Mutating non-public routes are protected by the global CSRF guard, which validates a trusted origin/referer and the double-submit CSRF cookie/header pair. Routes marked `@Public()` and routes marked with the explicit CSRF exemption decorator bypass CSRF validation.
- Page and space visibility is resolved through `PageAccessService`. Space-level CASL abilities are not a substitute for it: any surface that expands a single authorized page into a subtree or a list (export, the Notion-like database API, RAG, search) must filter through `PageAccessService` as well, either per page or via the batched `getEffectiveAccessForPages` / `getSidebarAccessSnapshot` helpers.
- Recursive page-hierarchy queries are depth-bounded by `MAX_PAGE_TREE_DEPTH`, and `PageService.movePage` rejects moves that would place a page under its own descendant, so `pages.parent_page_id` cannot be turned into a cycle that stalls those queries.
- RAG routes use API-key auth and reject regular user JWT/cookie auth. API keys re-check the creator's space membership on every use and resolve page and database-row reads through `PageAccessService`, so a key never grants more than its creator currently has. Scope schema v2 fingerprints the effective readable-page set plus content policy, and the opaque blocked-page feed lets an external writer purge data after ACL changes.
- RAG and MCP keys are distinct database-authoritative key types. `/mcp` accepts only one-space MCP keys, exposes no write tools, and applies the same page ACL and AI content exclusions as internal agent reads. Agent writes target only the current page and require an initiator-only, expiring approval plus a live Yjs content-hash check. Pending approvals have separate user/space limits and do not consume provider concurrency; approval is serialized by PostgreSQL admission locks, stores an expected post-apply hash, and is recovered after a crash only when the live Yjs hash proves that replay or finalization is safe.
- Built-in Agent and inbound MCP tools are described by one validated registry manifest: stable capability ID, category, target scope, approval mode, result-size ceiling, and safe annotations. Deployment policy is an absolute maximum; an enabled workspace exact allowlist and an optional space exact allowlist can only narrow it. MCP additionally intersects the authoritative key allowlist. New Agent runs persist the resolved capabilities, manifest fingerprint, and policy versions, while legacy runs and existing MCP keys retain only their legacy catalogs. ACL, deletion state, AI exclusions, and live object state remain per-call checks rather than snapshot data.
- Optional `assistantProfile` rows belong to one space and freeze display, instructions, quick commands, permitted provider overrides, and exact native/external tool selections into each conversation. Every run copies that profile snapshot and adds non-secret provider plus exact tool snapshots. Profile/group policy can only narrow deployment/workspace/space policy and never changes page ACL or target scope. Existing spaces have no default profile and retain the `legacy_space` path.
- The extended built-in catalog is read-only and routes workspace, space, database, row, table, comment, history, transclusion, attachment-metadata, and public-share access through scope-aware adapters. Version comparison uses the live Yjs document for current content and the pure ProseMirror diff utility in `packages/editor-ext`; collaboration unavailability fails closed instead of silently comparing against persisted stale content.
- Link preview metadata fetching validates public destinations and pins the resolved IP for the outbound request.
- Attachment uploads validate trusted signatures for inline-capable formats; attachment responses only render inline when stored MIME and extension match the safe inline allowlist.
- PDF and DOCX attachment text is extracted by the attachment queue with bounded decompression/page/character budgets. Extracted text is stored on the attachment row and indexed by both PostgreSQL full-text search and the optional Typesense driver.
- Workspace administrators can configure OIDC, SAML, or LDAP SSO providers in the core SSO module. OIDC uses authorization code flow with PKCE, state, and nonce; SAML responses are signature-checked and bound to an unconsumed request; LDAP uses escaped filters, bounded search, service bind, and user bind. Provider secrets are encrypted at rest and redacted from API responses. Optional group sync applies only administrator-defined external-group mappings and only revokes memberships it created itself. All outbound SSO endpoints must match the exact scheme, host, and port configured in `SSO_ALLOWED_ENDPOINTS`; the SSO migration resets existing enforcement so an administrator can verify that policy before explicitly re-enabling it.
- MFA, SSO, and public-sharing restrictions support per-space tri-state overrides in `spaces.settings`; absence inherits the workspace default, while an explicit boolean overrides it. Share creation, public page reads, public search, attachment access, SSO readiness, HTTP authorization, and realtime room authorization use the same effective-policy resolver. Security overrides are intentionally excluded from portable space exports.
- PDF export uses Chromium request interception and only allows `data:`, `about:blank`, and same-origin public attachment URLs. Mermaid diagrams are rendered in strict mode and sanitized before insertion into the PDF DOM.
- `X-Forwarded-*` request headers are trusted only when `TRUSTED_PROXIES` explicitly configures the reverse proxy IP/CIDR ranges. Rate limiting, session IP capture, request logging, and HTTPS/HSTS detection use the Fastify-resolved client request metadata.
- Embed iframes are restricted by a shared provider frame-source policy used by both client validation and server CSP. Generic iframe origins must be explicitly configured through `EMBED_ALLOWED_ORIGINS`.
- Per-space AI provider and external retrieval endpoints are restricted through independent `AI_PROVIDER_ALLOWED_ORIGINS` and `AI_RETRIEVAL_ALLOWED_ORIGINS` policies. Credentials are encrypted at rest, redacted from API responses, and resolved by workers instead of being copied into queue payloads. External retrieval candidates are mapped back to Docmost sources and filtered through current page access before entering a prompt or citation.
- Query-time retrieval selects one of `none`, the unchanged `http-json-v1` contract, or `open-webui-knowledge-v1`. Both HTTP adapters share bounded transport and SSRF enforcement. The Open WebUI adapter accepts only versioned Docmost metadata and still performs the same local database and page-ACL validation.
- AI, RAG, MCP, and RAG Sync emit 60-second or per-cycle low-cardinality structured summaries through the existing logger. Prompts, document content, credential-bearing URLs, tokens, API-key/user/source IDs, and fingerprints are excluded; no metrics exporter or public diagnostics endpoint is introduced. RAG/MCP request concurrency leases are renewed for the full HTTP response lifecycle instead of expiring during a long export; failure to confirm a renewal fails closed with a pre-header `503` or closes an active stream.
- Log metadata follows the same privacy boundary outside AI flows: logged URLs retain only their path and unique query-key names, while mail drivers exclude recipients, subjects, bodies, invitation links, and raw provider errors. The log-only mail driver never prints a message preview and emits `mail_delivery_disabled` in production.
- File import treats attachment upload failure as task failure so imported pages are not committed with broken attachment references.

The database schema is managed through Kysely migrations in `apps/server/src/database/migrations`. Generated Kysely types live under `apps/server/src/database/types`. Production uses `DATABASE_MIGRATION_MODE=external`: a read-only PostgreSQL runtime/topology/migration-history preflight gates a one-shot migration before collaboration and API startup, and both long-running processes repeat a require-latest preflight before becoming ready. PostgreSQL runtime changes use a new volume and logical dump/restore; the supported procedure is documented in `apps/server/docs/postgresql-production-migration.md`. Coordinated backup restore rebuilds planner statistics with `vacuumdb --analyze-in-stages` before application startup. AI chat persists configuration, conversations, runs, files, and citation snapshots without requiring a local vector index.

Invitation and notification delivery, page-duplication attachment copies, page-template synchronization, attachment deletion, and file imports use transactional `queue_outbox` rows written with their database state changes. PostgreSQL is the delivery source of truth; BullMQ carries only wake-up signals, and periodic sweeps recover lost signals, expired processing leases, incomplete attachment-cleanup batches, stale import work, and unconfirmed Docmost previews older than 24 hours. Delivery is at least once, while item identity, compare-and-set transitions, and lease fencing make the domain handlers replay-safe. Page-duplication source attachments are protected by database pins from the duplicate transaction until fenced completion, so page/space deletion cannot race the asynchronous storage copy. Completed or cancelled rows are purged in bounded batches after seven days. Failed delivery rows redact invitation PII and expire after 90 days; failed durability rows retain their recovery locators and duplicate pins until explicitly reconciled. See `apps/server/docs/queue-outbox-runbook.md` for lifecycle, monitoring, privacy, and rollback rules.

Collaboration history atomically records each event/content dirty state in Redis together with a persistent recovery index before attempting BullMQ delivery. The minute reconciler therefore recreates an initially lost queue job without requiring another edit; a bounded compatibility scan also adopts unindexed buffer, dirty, and processing keys left by an older runtime. Event processing then claims a stable Redis batch identity and persists it as `page_history.source_batch_id`; the per-page uniqueness constraint makes an ambiguous database commit replay-safe, while a fixed recovery job and processing index recover a stranded claimed batch. Content-history inserts and their `document-changed` notification-dispatch outbox rows commit in one PostgreSQL transaction. Workspace administrators may configure a nullable history-retention period, and the hourly cleanup deletes expired rows in bounded 500-row batches with a capped amount of work per run.

Import/export controllers live under integration modules but expose canonical page/space routes such as `/api/pages/actions/export`, `/api/pages/actions/import`, and `/api/spaces/actions/export`. Backend route inventory is generated from controllers and should be treated as the route source of truth for documentation.

## Frontend

The frontend is feature-oriented under `apps/client/src/features`. API calls are kept in feature service modules and use the shared API client. Attachments, auth, comments, database, dictionary, editor, favorite, file tasks, notifications, page/page-history, presence, search, session, share, space, transclusion, user, websocket, and workspace functionality are grouped by feature instead of by technical layer. The blocking dependency gate prevents foundational `components/ui`, `lib`, and `types` modules from importing feature implementations; cross-feature dependencies should enter through the owning feature's public contract or a genuinely shared foundation.

The shared API client provides fingerprinted idempotency leases backed by memory and `sessionStorage`. Page-template operations, AI file uploads, and page duplication reuse the same key after an ambiguous response and collapse concurrent submissions into one in-flight promise; only success, explicit cancellation, or a definitive key-reuse conflict releases the lease.

Frontend configuration has two layers:

- Build-time values are loaded in `apps/client/vite.config.ts` from the repository root `.env*` files and injected into `process.env`.
- Deployment/runtime values are served by the backend from `/window-config.js` and injected into `window.CONFIG` without mutating the built client files on disk.

PWA support is static-file based: `apps/client/public/manifest.json`, `apps/client/public/sw.js`, and `apps/client/public/offline.html` are served as public assets. The Service Worker caches only same-origin static/navigation resources, bounds runtime data to 200 entries and 30 days, and stores timestamps separately from response bodies. API, Socket.IO, collaboration, and `/window-config.js` requests bypass CacheStorage; deployment runtime configuration therefore cannot be served from a stale offline entry. Locale JSON files live under `apps/client/public/locales/*/translation.json`; user-facing static files outside that tree must be reviewed manually when UI text changes.

## Collaboration And Editor

Realtime document collaboration is handled only by the dedicated collaboration entrypoint. Browser Yjs traffic connects to the mandatory public `COLLAB_URL`; the API port never upgrades `/collab`. Page, template, and AI services depend on `CollaborationDocumentPort` and send bounded commands to `COLLAB_INTERNAL_URL`. The collaboration process authenticates that internal endpoint with the independent file-capable `COLLAB_INTERNAL_SECRET`, then routes the command to the current Redis lease owner. An outage fails affected API operations with `503`; persisted page content is never used as a silent live-document fallback.

General Socket.IO relay remains in the API process and accepts only `broadcast` envelopes to authorized `workspace-*`, `space-*`, or `user-*` rooms and allowlisted nested realtime event operations. Authenticated presence events use `presence:update` and `presence:clear`, with Redis-backed state grouped by session where available. Editor node definitions and serializers live partly in `packages/editor-ext` so the client and server can share document behavior. Redis collaboration ownership uses a random-token lease: Lua renewal and release verify the owner, renewals are sequential, and a lost or unverifiable lease closes the local document before another instance can become the writer.

Synced blocks use `transclusionSource` and `transclusionReference` nodes. The editor can wrap an allowed top-level selection as a source or create an empty source from the slash menu; nesting a source inside another synced block is rejected. Authenticated lookup subscriptions coalesce `transclusion:invalidate` events and refresh every active key while retaining the last successful content during the ACL-aware retry. Lookup, references, public-share rendering, and unsync remain fail-closed through the services under `apps/server/src/core/page/transclusion`.

Page templates are deployment-disabled by default through `PAGE_TEMPLATES_ENABLED=false`. The current template kinds are `regular` snapshots and `synced` template instances; workspace, space, role, and group policies only narrow the deployment gate. Whole-page `pageEmbed` nodes, commands, graph services, and database schema are retired. The pre-upgrade `page-embed:prepare-removal` CLI performs a read-only, keyset-batched semantic Yjs/content plan by default; apply requires a stopped API/collaboration/worker maintenance fence, a verified-backup acknowledgement, and an explicit policy for every affected surface. Safe live-page materialization enforces compatible audience boundaries and creates deterministic consumer-owned attachment copies through a restartable storage/DB ledger. Historical, template, database, and comment surfaces are never silently rewritten from current source content: an operator must choose neutralization, or the bounded page-history purge where supported. Migration `20260822T040000` verifies exact page hashes and completed clone ledgers, rejects remaining content, corrupt/orphan references, or pending/cleanup-bearing retired operations, then removes the legacy schema and restores the block-reference source-page cascade foreign key. The separate offline archive converter materializes V2-V4 archive JSON without contacting a source Docmost instance and creates deterministic consumer-owned attachment descriptors for materialized legacy content; the runtime archive API itself remains V5-only. The operational procedure and data-loss boundaries are documented in `apps/server/docs/page-embed-removal-runbook.md`.

`PageTemplateService` remains the stable controller facade and delegates to injectable instance-lifecycle and synchronization services. Publication/preflight serialization, live-content and access operations, and idempotency/lease recovery are isolated in dedicated injectable collaborators. `PageTemplateRuntimeService` consumes only the synchronization and operation collaborators. This keeps the HTTP and queue contracts stable while separating runtime recovery from policy, publication, and instance lifecycle behavior.

The product does not initialize or transmit external usage telemetry from either the browser or the server. `pnpm check:telemetry` rejects reintroduction of the removed dependency, runtime symbols, endpoint, and environment contract. Privacy-safe local operational logs and metrics remain part of security, queue, AI, and runtime diagnostics; they are not sent to an external product analytics collector.

Markdown, HTML, and PDF exports materialize synced content under the exporting user's current ACL and contain no live service identifiers. Canonical Docmost Archive V5 preserves and remaps internal synced references, stores access-checked snapshots only for external references, and materializes those external references on import. Export writes only V5; preview, confirmation, and worker processing reject V2, V3, V4, newer schemas, and any nested `pageEmbed` node.

## Search

Page and attachment search support the PostgreSQL full-text implementation and the Typesense driver selected by `SEARCH_DRIVER`. Typesense stores candidate IDs and searchable content; every result is rehydrated from PostgreSQL and filtered through current workspace, space, deletion, public-sharing, and page-access rules before it is returned. Attachment search covers both file names and extracted PDF/DOCX text.

Generated backend route inventory is maintained by `pnpm routes:inventory` and checked by CI through `pnpm routes:inventory:check`.

## Environment Contract

`.env.example` is the canonical checked-in environment contract for host development, and `.env.compose.example` mirrors the same keys with Docker Compose service host defaults. Local `.env` may contain deployment-specific values, but it must keep the same key set as `.env.example`. `COLLAB_URL`, `COLLAB_INTERNAL_URL`, and `COLLAB_INTERNAL_SECRET` are required: the first is public browser configuration, while the latter two are server-only. Compose classifies every key as container runtime, host/publish, image-fixed, database-service, or file-backed secret; the API and collaboration services share the same explicit runtime map. Required credentials are mounted by the base stack as Docker secrets. Optional integration credentials have defined Docker secret sources but are granted to the application services only by a deployment-local override, so an unused integration does not require a dummy secret. The server validation class in `apps/server/src/integrations/environment/environment.validation.ts`, frontend build-time keys in `apps/client/vite.config.ts`, backend-served frontend runtime keys in `apps/server/src/integrations/static/static.module.ts`, optional `.env.compose.example`, and local `.env` key parity are checked by `pnpm check:env`.

Reverse proxy deployments must set `TRUSTED_PROXIES` to the controlled proxy addresses or CIDRs, for example `loopback,linklocal,uniquelocal` or `10.0.0.0/8,172.16.0.0/12`. Leaving it empty disables forwarded-header trust.

Generic iframe deployments must set `EMBED_ALLOWED_ORIGINS` to exact trusted `http(s)` origins when arbitrary iframe embeds are required. Built-in providers remain allowlisted by the shared embed frame-source policy.

AI deployments must set `AI_PROVIDER_ALLOWED_ORIGINS` to the exact trusted model origins and `AI_RETRIEVAL_ALLOWED_ORIGINS` to the exact trusted optional retrieval origins that space administrators may configure. Both transports use the shared outbound URL/DNS policy, pin connections to the approved DNS results, and retain independent allowlists and stable error codes. `AI_STREAM_IDLE_TIMEOUT_MS` bounds inactivity between provider SSE chunks independently from the per-space full-request timeout; both timers start before URL resolution. Development permits loopback services such as LM Studio. Containers must use host or network URLs reachable from the Docmost container because container-local `127.0.0.1` does not address the host. `AI_ASSISTANT_PROFILES_ENABLED` defaults to `false` and is the operational deployment rollback for profile-bound runs; the workspace profile switch is independently closed by default. The root-level **inbound** `/mcp` endpoint is always mounted and needs no environment toggle; access is controlled by separate MCP API keys. `AI_BUILTIN_TOOL_EXTENSIONS_ENABLED` defaults to `false` and caps only the optional shared Agent/MCP read catalog; it does not disable the legacy Agent tools or seven baseline MCP reads. **Outbound** external MCP is the opposite direction and is off unless `AI_EXTERNAL_MCP_ENABLED=true`; `AI_MCP_ALLOWED_ORIGINS` is a third, independent outbound allowlist that a workspace administrator cannot widen, and per-server request headers are encrypted with `APP_SECRET`, never returned, and never placed in queue payloads or logs. RAG and MCP additionally use fail-closed Redis request/concurrency admission keyed by internal API-key ID.

Persistent core AI chat uses immutable `ai_runs` attempts. Retry/Regenerate create linked attempts and update only the assistant message projection; terminal usage, response snapshots, errors, and run-scoped citation snapshots are retained. BullMQ provides at-least-once delivery on `AI_CHAT_QUEUE`; deterministic job IDs, atomic database claims, compare-and-set terminal transitions, and monotonic transactional sequences provide effectively-once generation state. PostgreSQL admission locks serialize conversation/user/space quota decisions, and a database-readiness-gated reconciler repairs the PostgreSQL/Redis dual-write boundary without automatically repeating a provider call after a stale running worker.

`ai_run_steps.tool_source` distinguishes `builtin` from `external_mcp` calls. An external step is read-only, never carries an approval preview, and never participates in the approval or resume lifecycle. Each agent run stores a bounded, versioned external-MCP capability snapshot that carries no URL, header, or secret and is re-verified against live policy before every call, so revoking access or changing configuration stops an in-flight run instead of widening it.

Built-in tools have an independent immutable snapshot in
`ai_runs.builtin_tool_policy_snapshot`. A registry-manifest or live policy
version change ends a paused or resumed run with
`agent_tool_policy_changed`; profile-aware retry or regenerate preserves the
source snapshot and repeats every live revocation check. This
policy check augments the existing four-operation current-page approval union
and does not introduce a generic write executor. It is enforced before and
after every provider model turn, including final answers without tool calls.
Paginated built-in reads use versioned resource-bound keyset cursors rather
than caller-controlled SQL offsets.

AI conversation context is a versioned aggregate: the current document flag, explicit page/database/row descriptors, private chat files, and page attachments are persisted per conversation. Each provider attempt owns immutable resolved context snapshots and page dependencies so retries remain deterministic and access loss hides derived output. `ai_aux_runs` applies the same deterministic queue/CAS model to automatic four-word conversation titles and selection-only editor transforms without adding those results to chat history.

AI chat file uploads use idempotent upload batches, deterministic storage keys, extraction compare-and-set, database-first tombstones, and retriable storage cleanup. The retired AI Answers routes, embedding table, and legacy indexing queue are not part of the current architecture. Core per-space AI is the only document-generation UX.

The optional RAG Sync module runs inside the main backend process and discovers
enabled bindings from PostgreSQL. Each space owns an independent Open WebUI
target and encrypted writer credential. The deployment-wide
`RAG_SYNC_ENABLED` switch and `RAG_SYNC_ALLOWED_ORIGINS` allowlist remain in the
environment; per-space identifiers and credentials never do. The module reads
the same content-export implementation as `/api/rag/*`, but uses a system scope
containing every live page permitted by `AiContentPolicyService`. The public
RAG API keeps the API-key creator's page ACL.

Runtime checkpoints, mappings, operational status, a global concurrency
semaphore, and per-binding leases use the shared Redis under a versioned prefix.
Every state mutation is fenced by the current random lease token. Lease renewal
is sequential, observed loss aborts in-flight work, and uncertain Open WebUI
uploads are reconciled from versioned Docmost metadata before retry. A normal
disable drains only Docmost-managed files; emergency force disable preserves a
cleanup requirement and target claim so stale external data cannot be silently
reassigned.

Production startup validation requires `APP_URL` to be valid, rejects trust-all proxy configuration, and requires `AUTH_RATE_LIMIT_STORAGE=redis`.

## Verification

Baseline local verification:

1. `pnpm install --frozen-lockfile`
2. `pnpm verify:quick`
3. `pnpm verify:full` before broad architectural changes
4. `pnpm verify:release` against the documented production-like runtime before a release candidate

Root composite scripts call `corepack pnpm` internally. If the local `pnpm` shim is missing, run root/package checks with `corepack pnpm ...`; enable Corepack first only when a direct `pnpm` command is required.

Security regression coverage is available through `pnpm test:security`, and production dependency audit is run in CI with `pnpm audit --prod --audit-level high`.

The client build emits a Vite manifest and `pnpm check:client-bundle` enforces raw caps for ordinary JavaScript and CSS assets. It resolves entries by exact source, accounts for every CSS asset in each manifest closure, and measures the page route as the union of matched lazy layout and leaf roots minus the initial closure. Initial and page-incremental JavaScript/CSS gzip budgets are independent. The only larger JavaScript allowance is the measured lazy `@excalidraw/excalidraw` font-subsetting chunk, which has its own raw/gzip limits plus exact importer and initial-load boundary checks. CI and `verify:full` run this gate after the client build; Vite's display threshold is not the enforcement mechanism.

Backend e2e coverage uses disposable PostgreSQL and Redis services. The CI integration stage first applies every migration to an empty database, then verifies transactional outbox deduplication, expired-lease recovery, and owner fencing and runs two collaboration instances against real Redis to prove owner-checked lease renewal and release. CI additionally starts the production API and collaboration images and waits for both health endpoints.

`pnpm check:architecture` is a blocking dependency-cruiser gate; circular
dependencies are errors. `pnpm check:release-gates` verifies the reusable CI
workflow chain `publish -> gates -> production-smoke`, the required commands in
each CI job and root `verify:*` target, least-privilege workflow permissions,
concurrency policy, and immutable commit pins for third-party actions. It also
includes a negative smoke execution that must return non-zero and tests stream
redaction plus the exact-secret/credential-pattern artifact scan.
Production-smoke and Open WebUI compatibility logs are sanitized before they
are written and can be uploaded only after that scan creates its success
marker.

Typesense remains the selected external search projection; there is no hidden
PostgreSQL fallback when that driver is enabled. Lifecycle jobs provide low
latency, while a deterministic full reconciliation runs every 15 minutes and
converges missed DB-to-Redis events, including after Redis metadata loss. Each
application replica retries registration once per minute with the same BullMQ
identity. Attachment content indexing separately treats PostgreSQL status as
authoritative: every minute it recovers expired `processing` claims and
re-enqueues deterministic per-workspace work for remaining `pending` rows.
