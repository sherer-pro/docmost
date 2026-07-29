# Docmost Architecture

## Repository Shape

Docmost is a pnpm workspace orchestrated by Nx. The main runtime surfaces are:

- `apps/server` - NestJS API, background jobs, websocket gateway, migrations, and storage/search integrations.
- `apps/client` - Vite and React frontend.
- `packages/editor-ext` - shared Tiptap/ProseMirror editor extensions consumed by the client and server-side rendering paths.
- `packages/api-contract` - shared API-facing TypeScript contracts used by backend and frontend code.
- `packages/ee` plus `apps/*/src/ee` - Enterprise Edition code loaded conditionally by app-level EE modules.

The production container uses Node.js 22 and runs the built backend entrypoint directly with `node apps/server/dist/apps/server/src/main`. The root `pnpm build` task builds all workspace projects.

## Backend

The backend is organized around Nest modules under `apps/server/src/core`. Most HTTP controllers are served under the global `/api` prefix; explicit `robots.txt` and share SEO exclusions remain outside that prefix. Domain services own business rules and database writes. Kysely repositories under `apps/server/src/database/repos` encapsulate repeated database access patterns.

At the application level, `apps/server/src/app.module.ts` wires the core domain module, collaboration and general WebSocket modules, queue, static frontend serving, health, import/export, storage, mail, security headers/version/robots support, telemetry, Redis, database access, and optional Enterprise modules.

`CoreModule` currently groups auth, workspace, page, attachment, comment, search, space, group, share, notification/watcher, MFA, push, database, API key, RAG, AI, page access, dictionary, session, favorite, label, synced block transclusion, and presence functionality. The core AI feature keeps per-space provider and optional external retrieval configuration separate from `spaces.settings`, persists private per-user/page conversations, and treats background runs in the database as the source of truth while Socket.IO delivers realtime progress.

Security-sensitive cross-cutting behavior is centralized:

- JWT authentication is enforced by controllers and gateways that opt into `JwtAuthGuard`; routes marked `@Public()` intentionally bypass it. Access tokens must carry a `sessionId` claim, which is validated against a live `user_sessions` row on every request; this is what makes logout, session revocation, and password reset effective. Collab tokens carry the same claim and are validated by the collaboration server.
- Mutating non-public routes are protected by the global CSRF guard, which validates a trusted origin/referer and the double-submit CSRF cookie/header pair. Routes marked `@Public()` and routes marked with the explicit CSRF exemption decorator bypass CSRF validation.
- Page and space visibility is resolved through `PageAccessService`. Space-level CASL abilities are not a substitute for it: any surface that expands a single authorized page into a subtree or a list (export, the Notion-like database API, RAG, search) must filter through `PageAccessService` as well, either per page or via the batched `getEffectiveAccessForPages` / `getSidebarAccessSnapshot` helpers.
- Recursive page-hierarchy queries are depth-bounded by `MAX_PAGE_TREE_DEPTH`, and `PageService.movePage` rejects moves that would place a page under its own descendant, so `pages.parent_page_id` cannot be turned into a cycle that stalls those queries.
- RAG routes use API-key auth and reject regular user JWT/cookie auth. API keys re-check the creator's space membership on every use and resolve page reads through `PageAccessService`, so a key never grants more than its creator currently has.
- Link preview metadata fetching validates public destinations and pins the resolved IP for the outbound request.
- Attachment uploads validate trusted signatures for inline-capable formats; attachment responses only render inline when stored MIME and extension match the safe inline allowlist.
- PDF export uses Chromium request interception and only allows `data:`, `about:blank`, and same-origin public attachment URLs. Mermaid diagrams are rendered in strict mode and sanitized before insertion into the PDF DOM.
- `X-Forwarded-*` request headers are trusted only when `TRUSTED_PROXIES` explicitly configures the reverse proxy IP/CIDR ranges. Rate limiting, session IP capture, request logging, and HTTPS/HSTS detection use the Fastify-resolved client request metadata.
- Embed iframes are restricted by a shared provider frame-source policy used by both client validation and server CSP. Generic iframe origins must be explicitly configured through `EMBED_ALLOWED_ORIGINS`.
- Per-space AI provider and external retrieval endpoints are restricted through independent `AI_PROVIDER_ALLOWED_ORIGINS` and `AI_RETRIEVAL_ALLOWED_ORIGINS` policies. Credentials are encrypted at rest, redacted from API responses, and resolved by workers instead of being copied into queue payloads. External retrieval candidates are mapped back to Docmost sources and filtered through current page access before entering a prompt or citation.
- File import treats attachment upload failure as task failure so imported pages are not committed with broken attachment references.

The database schema is managed through Kysely migrations in `apps/server/src/database/migrations`. Generated Kysely types live under `apps/server/src/database/types`. AI chat persists configuration, conversations, runs, files, and citation snapshots without requiring a local vector index.

Import/export controllers live under integration modules but expose canonical page/space routes such as `/api/pages/actions/export`, `/api/pages/actions/import`, and `/api/spaces/actions/export`. Backend route inventory is generated from controllers and should be treated as the route source of truth for documentation.

## Frontend

The frontend is feature-oriented under `apps/client/src/features`. API calls are kept in feature service modules and use the shared API client. Attachments, auth, comments, database, dictionary, editor, favorite, file tasks, notifications, page/page-history, presence, search, session, share, space, transclusion, user, websocket, and workspace functionality are grouped by feature instead of by technical layer.

Frontend configuration has two layers:

- Build-time values are loaded in `apps/client/vite.config.ts` from the repository root `.env*` files and injected into `process.env`.
- Deployment/runtime values are served by the backend from `/window-config.js` and injected into `window.CONFIG` without mutating the built client files on disk.

PWA support is static-file based: `apps/client/public/manifest.json`, `apps/client/public/sw.js`, and `apps/client/public/offline.html` are served as public assets. Locale JSON files live under `apps/client/public/locales/*/translation.json`; user-facing static files outside that tree must be reviewed manually when UI text changes.

## Collaboration And Editor

Realtime collaboration is handled by the backend collaboration entrypoints and websocket infrastructure. General WebSocket relay accepts only `broadcast` envelopes to authorized `workspace-*`, `space-*`, or `user-*` rooms and allowlisted nested realtime event operations. Authenticated presence events use `presence:update` and `presence:clear`, with Redis-backed state grouped by session where available. Editor node definitions and serializers live partly in `packages/editor-ext` so the client and server can share document behavior.

Synced blocks use `transclusionSource` and `transclusionReference` nodes. Server-side lookup and unsync logic is under `apps/server/src/core/page/transclusion`, while client lookup UI and node views are under `apps/client/src/features/editor/components/transclusion` and `apps/client/src/features/transclusion`.

## Search

Page search supports the database full-text implementation and the Typesense driver selected by `SEARCH_DRIVER`. Attachment search uses a trigram index on normalized `attachments.file_name` values and applies the same page access filtering through `PageAccessService`.

Generated backend route inventory is maintained by `pnpm routes:inventory` and checked by CI through `pnpm routes:inventory:check`.

## Environment Contract

`.env.example` is the canonical checked-in environment contract for host development, and `.env.compose.example` mirrors the same keys with Docker Compose service host defaults. Local `.env` may contain deployment-specific values, but it must keep the same key set as `.env.example`. The server validation class in `apps/server/src/integrations/environment/environment.validation.ts`, frontend build-time keys in `apps/client/vite.config.ts`, backend-served frontend runtime keys in `apps/server/src/integrations/static/static.module.ts`, optional `.env.compose.example`, and local `.env` key parity are checked by `pnpm check:env`.

Reverse proxy deployments must set `TRUSTED_PROXIES` to the controlled proxy addresses or CIDRs, for example `loopback,linklocal,uniquelocal` or `10.0.0.0/8,172.16.0.0/12`. Leaving it empty disables forwarded-header trust.

Generic iframe deployments must set `EMBED_ALLOWED_ORIGINS` to exact trusted `http(s)` origins when arbitrary iframe embeds are required. Built-in providers remain allowlisted by the shared embed frame-source policy.

AI deployments must set `AI_PROVIDER_ALLOWED_ORIGINS` to the exact trusted model origins and `AI_RETRIEVAL_ALLOWED_ORIGINS` to the exact trusted optional retrieval origins that space administrators may configure. Both transports use the shared outbound URL/DNS policy but retain independent allowlists and stable error codes. `AI_STREAM_IDLE_TIMEOUT_MS` bounds inactivity between provider SSE chunks independently from the per-space full-request timeout; both timers start before URL resolution. Development permits loopback services such as LM Studio. Containers must use host or network URLs reachable from the Docmost container because container-local `127.0.0.1` does not address the host.

Persistent core AI chat uses immutable `ai_runs` attempts. Retry/Regenerate create linked attempts and update only the assistant message projection; terminal usage, response snapshots, errors, and run-scoped citation snapshots are retained. BullMQ provides at-least-once delivery on `AI_CHAT_QUEUE`; deterministic job IDs, atomic database claims, compare-and-set terminal transitions, and monotonic transactional sequences provide effectively-once generation state. PostgreSQL admission locks serialize conversation/user/space quota decisions, and a database-readiness-gated reconciler repairs the PostgreSQL/Redis dual-write boundary without automatically repeating a provider call after a stale running worker.

AI chat file uploads use idempotent upload batches, deterministic storage keys, extraction compare-and-set, database-first tombstones, and retriable storage cleanup. Legacy `AI_QUEUE`, PageEmbeddings/indexing, EE AI search, and `/api/ai/answers` stay separate. The removed EE editor Ask AI flow and `settings.ai.generative` toggle are not part of the core AI architecture.

Production startup validation requires `APP_URL` to be valid, rejects trust-all proxy configuration, and requires `AUTH_RATE_LIMIT_STORAGE=redis`.

## Verification

Baseline local verification:

1. `pnpm install --frozen-lockfile`
2. `pnpm verify:quick`
3. `pnpm verify:full` before release or broad architectural changes

Root composite scripts call `corepack pnpm` internally. If the local `pnpm` shim is missing, run root/package checks with `corepack pnpm ...`; enable Corepack first only when a direct `pnpm` command is required.

Security regression coverage is available through `pnpm test:security`, and production dependency audit is run in CI with `pnpm audit --prod --audit-level high`.
