# AGENTS.md — practical automation cheat sheet for `docmost`

> Goal: give an agent/developer the minimum context needed to **start executing tasks immediately without follow-up questions**. Only practical steps, verified against the current code and configs, are included below.

## 0) Quick repository profile

- Monorepo built with **pnpm workspaces** + **Nx**.
- Main applications:
  - `apps/server` — NestJS backend.
  - `apps/client` — Vite + React frontend.
  - `packages/editor-ext` — shared TypeScript package with editor extensions.
  - `packages/api-contract` — shared API-facing TypeScript contracts.
- Root package manager is pinned: `pnpm@10.4.0`.
- **Only the root `package.json` `pnpm.overrides` block actually affects resolution.** The `overrides` and `patchedDependencies` blocks in `pnpm-workspace.yaml` are inert: pnpm reads those keys from that file only from v10.6 onward, and `packageManager` pins pnpm 10.4.0. `pnpm-lock.yaml` therefore records just the 7 root overrides, and the `react-arborist` patch is not applied. See the warning comment in `pnpm-workspace.yaml` for how to activate them (requires a lockfile regeneration with network access and a full re-verification).
- Root composite scripts call `corepack pnpm` internally, so `corepack pnpm verify:full` works even when a global `pnpm` shim is not on `PATH`.
- `node:22-slim` is used for the production image.

---

## 1) Code navigation

### Entry points

- Local fullstack development: `pnpm dev` (frontend + backend in parallel).
- Backend dev: `pnpm server:dev`.
- Frontend dev: `pnpm client:dev`.
- Production run for the built backend: `pnpm start` (root script → `apps/server start:prod`).
- Realtime collaboration server: `pnpm collab` / `pnpm collab:dev`.
- Email templates preview (backend): `pnpm email:dev`.

### Where things are located

- `apps/server/src` — main backend code.
- `apps/server/src/app.module.ts` — backend module wiring, global CSRF guard, static/client serving, Redis, queue, import/export, security, telemetry, and optional EE loading.
- `apps/server/src/core/api-key` — workspace API key management used by RAG integrations.
- `apps/server/src/core/ai` — per-space AI configuration, persistent private chat, async generation, chat files, and optional external retrieval.
- `apps/server/src/core/database` — Notion-like database API, rows/properties/views, conversion, markdown/export support.
- `apps/server/src/core/dictionary` — space-scoped dictionary API and services.
- `apps/server/src/core/favorite` — page/space favorites API.
- `apps/server/src/core/label` — labels and page-label assignment API.
- `apps/server/src/core/mfa` — TOTP MFA API and login challenge support.
- `apps/server/src/core/notification` and `apps/server/src/core/push` — in-app, email, and Web Push notification flows.
- `apps/server/src/core/page-access` — page ACL and effective access resolution.
- `apps/server/src/core/page/transclusion` — synced blocks backend, lookup, references, and unsync logic.
- `apps/server/src/core/presence` — Redis-backed live member presence for active sessions and current page/space locations.
- `apps/server/src/core/rag` — API-key-only RAG export and sync API.
- `apps/server/src/core/session` — user session API and active session revocation.
- `apps/server/src/collaboration` and `apps/server/src/ws` — collaboration server, Yjs helpers, Socket.IO relay, and presence events.
- `apps/server/src/integrations/{import,export,static,security,telemetry}` — import/export jobs, static frontend serving, security/version/robots helpers, and telemetry.
- `ARCHITECTURE.md` — high-level repository architecture and verification map.
- `docs/documentation-audit-2026-06-20.md` — latest local documentation audit report.
- `apps/server/docs/api-routing-conventions.md` — API routing policy, endpoint inventory, and RPC migration plan.
- `apps/server/docs/api-route-inventory.generated.md` — generated backend route inventory (`pnpm routes:inventory`).
- `apps/server/docs/security-regression-runbook.md` — security pre-release checks for GHSA regression classes.
- `apps/server/docs/release-notes/security-ghsa-remediation-2026-03.md` — security advisory mapping and remediation notes.
- `apps/client/src` — main frontend code.
- `apps/client/src/features/dictionary` — dictionary page, term editor, matching/highlighting UI.
- `apps/client/src/features/session` — account active sessions UI.
- `apps/client/src/features/presence` — authenticated Socket.IO presence heartbeat/reporting hooks.
- `apps/client/src/features/favorite` — favorite star/actions and favorite lists.
- `apps/client/src/features/transclusion` and `apps/client/src/features/editor/components/transclusion` — synced block lookup UI and editor node views.
- `apps/client/src/features/editor/components/tag` — inline TBD/TODO tag node view.
- `apps/client/src/features/editor/components/fixed-toolbar` — persistent editor toolbar shown when the user preference is enabled.
- `apps/client/src/features/page/components/reading-time` — live page reading-time calculation, localized labels, and theme-aware indicator styling.
- `apps/client/src/features/space/components/custom-links` — admin-managed space sidebar custom links: curated Tabler icon registry, URL safety helper, and the settings UI.
- `apps/client/public/locales/*` — JSON translations.
- `apps/client/public/{manifest.json,sw.js,offline.html}` — PWA manifest, Service Worker, and static offline page; these user-facing strings are outside the i18next locale JSON pipeline.
- `apps/server/src/database` — migrations and DB tooling.
- `apps/server/src/database/migrations/20260728T120000-ai-integration.ts` — AI provider/retrieval configuration, private chat, run, file, and citation schema.
- `packages/editor-ext/src/lib/{audio,pdf,transclusion,indent,page-break,tag}` — editor nodes/extensions for audio, embedded PDFs, synced blocks, paragraph/heading indentation, print page breaks, and inline TBD/TODO tags.
- `packages/api-contract/src` — shared API-facing TypeScript contracts used by server/client code; it builds to `packages/api-contract/dist` for runtime server consumption.
- `patches/` — pnpm patch files (for example, for `react-arborist`).
- `packages/ee`, `apps/*/src/ee` — Enterprise code (separate license).

### What can be safely ignored during analysis

- `node_modules/`
- `apps/*/dist`, `packages/*/dist`, root `/dist`
- `.nx/`, `coverage/`, logs (`*.log`)
- `data/` (local runtime data)

---

## 2) Reusable commands (runbook)

### Installation and baseline checks

- Install dependencies: `pnpm install --frozen-lockfile`
- If the local `pnpm` shim is missing, use `corepack pnpm ...`; root composite scripts and explicit Nx build targets are Corepack-safe.
- Build the entire monorepo: `pnpm build`
- Targeted root builds: `pnpm server:build`, `pnpm client:build`, `pnpm editor-ext:build`
- Quick local verification (env contract + lint + backend test + frontend smoke + security suite): `pnpm verify:quick`
- Full local verification (env contract + build → lint → backend tests + frontend smoke + frontend unit + security suite): `pnpm verify:full`
- Clean build artifacts: `pnpm clean`
- Check `.env.example`, `.env.compose.example`, local `.env`, server validation, and frontend runtime env drift: `pnpm check:env`
- Regenerate backend route inventory from controllers: `pnpm routes:inventory`
- Check route inventory drift without rewriting the generated file: `pnpm routes:inventory:check`
- Run dependency boundary audit (non-blocking report): `pnpm audit:deps`
- Run dead-code audit (non-blocking report): `pnpm audit:dead-code`
- Run duplicate-code audit (non-blocking report): `pnpm audit:duplicates`
- Run all architecture audit reports (non-blocking): `pnpm audit:architecture`

### Development

- Fullstack dev: `pnpm dev`
- Backend only: `pnpm server:dev`
- Frontend only: `pnpm client:dev`
- Local preview of the frontend build: `pnpm --filter ./apps/client preview`

### Linting and formatting

- Backend lint (with autofixes): `pnpm --filter ./apps/server lint`
- Frontend lint: `pnpm --filter ./apps/client lint`
- Combined lint stage (server + client): `pnpm lint`
- Backend format: `pnpm --filter ./apps/server format`
- Frontend format: `pnpm --filter ./apps/client format`
- Check comments/docs language (source comments + docs + key root docs/Dockerfile): `pnpm check:comments:en`

### Tests

- Combined default test stage (backend + frontend smoke): `pnpm test`
- Full root test stage (default + frontend unit): `pnpm test:all`
- Security regression suite (server + client targeted tests): `pnpm test:security`
- Backend unit/integration: `pnpm --filter ./apps/server test`
- Backend security subset (share SEO, cloud host parsing, CSRF origin checks, ZIP traversal/quotas/decompression budget, attachment token/MIME handling, attachment image path resolution, import embed formatting, PDF resource allowlist, page ACL resolution, space abilities, API key scoping, JWT session binding, collab token session binding, WebSocket room authorization, credential protection, trusted proxies, database-module page access, and page move cycle guard): `pnpm --filter ./apps/server test:security`
- Frontend smoke test equivalent (build-based temporary target): `pnpm --filter ./apps/client build`
- Frontend unit tests (Vitest): `pnpm --filter ./apps/client test`
- Editor extension package-local tests (run through client Vitest): `pnpm test:editor-ext`
- Frontend security subset (Mermaid + link/embed sanitize/sandbox): `pnpm --filter ./apps/client test:security`
- Backend coverage: `pnpm --filter ./apps/server test:cov`
- Backend coverage smoke (fast regression check): `pnpm --filter ./apps/server test:cov:smoke`
- Backend alias smoke (verify tsconfig alias resolution in Jest): `pnpm --filter ./apps/server test:alias:smoke`
- Backend e2e: `pnpm --filter ./apps/server test:e2e`
- Backend e2e quarantine note: `apps/server/test/app.e2e-quarantine.ts` is temporarily excluded from Jest by filename until DOC-2471 resolves ESM interoperability for collaboration dependencies.
- Unit quarantine note: `apps/server/src/core/page/page.controller.quarantine.ts` and `apps/server/src/core/page/services/page.service.quarantine.ts` are temporarily excluded by filename for the same DOC-2471 reason.

### Database migrations (backend)

- Create migration: `pnpm --filter ./apps/server migration:create`
- Apply: `pnpm --filter ./apps/server migration:up`
- Roll back 1 step: `pnpm --filter ./apps/server migration:down`
- Apply up to latest: `pnpm --filter ./apps/server migration:latest`
- Redo: `pnpm --filter ./apps/server migration:redo`
- Full reset: `pnpm --filter ./apps/server migration:reset`
- Generate DB types: `pnpm --filter ./apps/server migration:codegen`

### Containers

- Host development env: copy `.env.example` to `.env`, replace secrets, and point `DATABASE_URL`/`REDIS_URL` at local host services.
- Docker Compose env: copy `.env.compose.example` to `.env`, replace `REPLACE_WITH_LONG_SECRET` and `STRONG_DB_PASSWORD`, keep `AUTH_RATE_LIMIT_STORAGE=redis`, then run `docker compose up -d`.
- Local container startup (prebuilt image): `docker compose up -d`
- Build the current code into an image: `docker build -t docmost:local .`
- The production image starts the built backend directly with `node apps/server/dist/apps/server/src/main`; it should not invoke `pnpm start` or Corepack at runtime.
- Local file storage resolves to `<repo-or-runtime-root>/data/storage`; the Docker image uses runtime root `/app`, and Compose mounts the `docmost` volume at `/app/data/storage`.

> `DATABASE_URL`, `REDIS_URL`, and `APP_SECRET` are required for migrations, backend startup, and part of the integration functionality (see `.env.example`).

---

## 3) Style conventions (as observed)

### TypeScript/JS style

- Prettier in backend/editor-ext: `singleQuote: true`, `trailingComma: all`.
- The frontend has places with double quotes (ESLint config/code); there is no globally enforced quote style in the shared root config — **do not perform mass style-only quote rewrites unless explicitly requested**.
- Indentation in the codebase uses spaces (typically 2).

### Frontend UI conventions

- Non-editor icon-only controls should use `AccessibleActionIcon` from `apps/client/src/components/ui/accessible-action-icon.tsx` or provide an equivalent accessible name and at least a 32px hit target. Dense editor toolbars may stay compact, but each control still needs an accessible label.
- Simple product/admin data tables should opt into the shared responsive-card pattern in `apps/client/src/components/ui/responsive-table.module.css` and add `data-label` values for mobile cells. Keep database grids as scrollable grids with explicit horizontal-scroll affordance instead of converting them to cards.
- Use `EmptyState` or `NoTableResults` for empty/loading/no-data surfaces instead of bare centered text when the state is user-facing.
- When adding reusable UI text, update every `apps/client/public/locales/*/translation.json` file and keep static PWA strings in `apps/client/public/{manifest.json,sw.js,offline.html}` in mind if touched.

### ESLint practices

- In both backend and frontend, several strict TS rules are intentionally relaxed (`no-explicit-any`, `no-unused-vars`, `ban-ts-comment` are disabled).
- Backend lint runs with `--fix`; running lint in the touched app before commit is recommended.
- Write comments in code only in English (ASCII), without Cyrillic.
- Before opening a PR, run `pnpm check:comments:en` and ensure it passes.

### Commit message format (based on history)

- Conventional Commits-like style is prevalent: `feat(...)`, `fix(...)`, `docs: ...`.
- Merge commits from PRs are acceptable.
- Write commit title and description in code only in English (ASCII), without Cyrillic.

---

## 4) Constraints and environment variables

### Minimum versions/runtimes

- Node.js: target **22.x** (from Dockerfile: `node:22-slim`).
- pnpm: **10.4.0** (pinned in `packageManager` and Dockerfile).
- PostgreSQL in compose: `postgres:18`.
- Redis in compose: `redis:8`.

### Required env for local backend startup

Use `.env.example` for host development and `.env.compose.example` when Docker Compose owns the `db` and `redis` services.

Minimum:

- `APP_URL` (usually `http://localhost:3000`)
- `PORT` (default 3000)
- `APP_SECRET` (minimum 32 characters)
- `DATABASE_URL`
- `REDIS_URL`

### Frequently used optional env

- Storage: `STORAGE_DRIVER`, `AWS_S3_*`
- Mail: `MAIL_DRIVER`, `SMTP_*`, `POSTMARK_TOKEN`
- Web Push: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`
- PDF export: `PDF_CHROMIUM_EXECUTABLE_PATH`, `PDF_RENDER_TIMEOUT_MS`
- Diagnostics: `DEBUG_MODE`, `DEBUG_DB`, `LOG_HTTP`
- Search: `SEARCH_DRIVER`, `TYPESENSE_URL`, `TYPESENSE_API_KEY`, `TYPESENSE_LOCALE`
- AI/RAG support: `AI_DRIVER`, `AI_EMBEDDING_MODEL`, `AI_COMPLETION_MODEL`, `AI_EMBEDDING_DIMENSION`, `OPENAI_API_KEY`, `OPENAI_API_URL`, `GEMINI_API_KEY`, `OLLAMA_API_URL`
- Per-space AI provider network policy: `AI_PROVIDER_ALLOWED_ORIGINS` is a comma-separated list of exact trusted `http(s)` origins. Keep it empty until the provider origins are approved; development additionally permits loopback endpoints.
- External retrieval network policy: `AI_RETRIEVAL_ALLOWED_ORIGINS` separately allowlists exact trusted `http(s)` origins for optional `http-json-v1` retrieval adapters. Development additionally permits loopback endpoints.
- AI provider streaming: `AI_STREAM_IDLE_TIMEOUT_MS` controls the maximum wait between provider SSE chunks, including the first chunk. It defaults to 120000 ms, accepts 5000-600000 ms, resets on every chunk, and is capped by the per-space request timeout. Slow local reasoning models may use 300000 ms.
- Reverse proxy attribution: `TRUSTED_PROXIES` is a comma-separated list of trusted proxy IPs/CIDRs or proxy-addr keywords (`loopback`, `linklocal`, `uniquelocal`). Leave it empty unless Docmost is behind a controlled proxy; `X-Forwarded-*` headers are ignored when it is empty.
- Auth throttling storage: `AUTH_RATE_LIMIT_STORAGE` may be `memory` for local development, but production validation requires `redis`.
- Embed iframe allowlist: `EMBED_ALLOWED_ORIGINS` is a comma-separated list of exact trusted `http(s)` origins for generic iframe embeds. Built-in providers are allowlisted separately; keep this empty unless the origin is trusted.
- Frontend build-time defines are loaded via `vite loadEnv`; deployment/runtime defines such as `APP_URL`, `COLLAB_URL`, `SUBDOMAIN_HOST`, `POSTHOG_*`, `BILLING_TRIAL_DAYS`, `FILE_UPLOAD_SIZE_LIMIT`, `FILE_IMPORT_SIZE_LIMIT`, `EMBED_ALLOWED_ORIGINS`, and `DRAWIO_URL` are served by the backend from `/window-config.js` without mutating built client files. Keep this contract in sync with `pnpm check:env`.

---

## 5) Dependencies and package managers

- Primary package manager: **pnpm** (workspace).
- Monorepo task orchestration: **Nx** (`nx run ...`, `nx run-many ...`).
- Dependency updates: via `pnpm up` (targeted by package or workspace).
- Security/audit:
  - baseline: `pnpm audit`
  - additionally account for `overrides` in `pnpm-workspace.yaml` and root `package.json` `pnpm.overrides` (used to pin vulnerable/conflicting package versions).
  - architecture reports: `pnpm audit:deps`, `pnpm audit:dead-code`, `pnpm audit:duplicates`, `pnpm audit:architecture` use `dependency-cruiser`, `knip`, and `jscpd`; they are non-blocking local audit commands.
- Dependency patches: keep and maintain them in `patches/` and in `patchedDependencies` inside `pnpm-workspace.yaml`.

---

## 6) CI/CD and local reproduction

- The repository includes GitHub Actions workflows:
  - `.github/workflows/docker.yml` — release/docker build and push.
  - `.github/workflows/ci.yml` — PR validation (`install`, `build`, `routes:inventory:check`, `check:env`, `lint`, `client test`, `server test`, `pnpm test:security`, `check:comments:en`, `pnpm audit --prod` fail on high/critical).
- De facto required local pipeline before PR:
  1. `pnpm install --frozen-lockfile`
  2. for quick checks on day-to-day changes: `pnpm verify:quick`.
  3. before PR / release candidates: `pnpm verify:full` (build → lint → tests → security suite).
  4. for infrastructure changes — `docker build` and/or `docker compose up` smoke check.
- Functional checks (`check:env`, `build`, `lint`, `test`, `test:security`) remain mandatory local pre-PR validation.

---

## 7) Mismatches and pitfalls

- All mutating non-public API methods (POST/PUT/PATCH/DELETE) are protected by global CSRF validation: the request origin/referer must be trusted and the `csrfToken` cookie must match the `x-csrf-token` header.
- CSRF exceptions by design: routes marked `@Public()` and routes explicitly marked with the CSRF exemption decorator. Auth/setup examples include `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/password-reset`, `POST /api/auth/verify-token`, `POST /api/auth/setup`.
- Attachment/file API notes:
  - canonical upload routes: `POST /api/attachments/actions/upload-file`, `POST /api/attachments/actions/upload-image`, `POST /api/attachments/actions/remove-icon`.
  - canonical file routes: `GET /api/attachments/files/:fileId/:fileName`, `GET /api/attachments/files/public/:fileId/:fileName`.
  - compatibility aliases are still enabled for older clients/content: `POST /api/files/upload`, `GET /api/files/:fileId/:fileName`, `GET /api/files/public/:fileId/:fileName`, `POST /api/attachments/upload-image`, `POST /api/attachments/remove-icon`.
  - public attachment `?jwt=` query tokens remain accepted only as a legacy fallback after header/cookie tokens; responses using the query token include deprecation headers.
  - inline responses are allowed only for trusted extension/MIME pairs; spoofed inline extensions such as `.mp4` with HTML content are served as downloads with a safe content type.
  - `GET /api/attachments/img/:attachmentType/:fileName` stays unauthenticated (workspace logos and avatars are needed on the login and public share pages), but the storage path is rebuilt from the validated UUID plus an allowlisted image extension. The raw route parameter is never concatenated into the path, so encoded separators (`%2F`) cannot reach another workspace's folder.
- Page/space export authorizes the root page in the controller, then filters the descendant subtree through `PageAccessService.getEffectiveAccessForPages` inside `ExportService.exportPages`. A denied page prunes its whole subtree. Callers that authorize only the root (page export, database export, RAG export) must pass the `authorizedUser` argument.
- The Notion-like database API gates on space abilities **and** page access rules: row pages are filtered by the space readable-page snapshot on list endpoints, and `assertCanAccessTargetPage` asserts read/write/create-child on the target page.
- `POST /api/pages/move` rejects a move under the page itself or under one of its own sub pages (`PageRepo.hasSelfOrAncestor`). Every recursive page-hierarchy CTE carries a `level` column bounded by `MAX_PAGE_TREE_DEPTH` (`apps/server/src/common/config/page-tree.constants.ts`), so a malformed tree cannot spin a query forever.
- Docmost archive import never trusts the uncompressed sizes recorded in the ZIP central directory: entries are decompressed through `readZipEntryWithBudget`, which aborts as soon as the per-entry or cumulative byte budget is exceeded, and CRC32 checking is enabled.
- PDF export runs Chromium with a resource allowlist: only `data:`, `about:blank`, and same-origin public attachment URLs are fetched; external URLs in page content are blocked.
- File import fails the task if referenced attachment uploads fail after retries, preventing committed pages with broken attachment references.
- Generic iframe embeds are blocked unless their exact origin is listed in `EMBED_ALLOWED_ORIGINS`; built-in providers use the shared frame-source allowlist and server CSP.
- RAG API (`/api/rag/*`) is API-key-only:
  - pass `Authorization: Bearer <token>` from workspace API keys;
  - user JWT/cookie auth is rejected on `/api/rag/*`;
  - API keys are rejected outside `/api/rag/*`;
  - key scope is enforced by `spaceId` inside API key JWT payload;
  - page-level access rules are enforced as well: single-page reads go through `PageAccessService`, and `GET /api/rag/pages` / `GET /api/rag/updates` are filtered by the key creator's readable pages, so a key never exposes more than its creator can read. `GET /api/rag/deleted` intentionally still returns tombstones for deleted pages, because the access snapshot only covers live pages.
- API key management routes are active in this fork:
  - user page: `/settings/account/api-keys`;
  - workspace management page: `/settings/api-keys`;
  - create key requires selecting `spaceId`;
  - access is restricted to workspace `admin|owner`;
  - space membership is re-checked on **every** key use, so removing the creator from the scoped space invalidates their keys (workspace `admin|owner` are exempt);
  - keys created without an explicit expiry get a bounded 365d JWT instead of a non-expiring one; `api_keys.expires_at` remains the authority.
- User session management routes are active:
  - account page: `/settings/account/profile` -> Active sessions;
  - API routes: `GET /api/sessions`, `POST /api/sessions/revoke`, `POST /api/sessions/revoke-all`;
  - access tokens **must** carry `sessionId`: the JWT strategy and the Socket.IO gateway reject a token without it, because such a token cannot be revoked by logout, session revocation, or a password reset. Tokens issued before this became mandatory are no longer accepted and require a new sign-in.
  - collab tokens (`GET /api/auth/collab-token`) are also bound to the issuing `sessionId` and are validated against an active session by the collaboration server, so revoking a session also cuts off Yjs access. Their lifetime is 4h; keep the client `useCollabToken` staleTime below that value.
- Live member presence is active for workspace admins/owners:
  - members page: `/settings/members` -> Presence column;
  - API route: `GET /api/workspace/members/presence?userIds=...`;
  - Socket.IO events: `presence:update` and `presence:clear`;
  - state is ephemeral in Redis and grouped by `sessionId`.
- Favorites and labels routes are active:
  - favorites: `POST /api/favorites`, `/api/favorites/add`, `/api/favorites/remove`, `/api/favorites/ids`;
  - page labels: `POST /api/pages/labels`, `/api/pages/labels/add`, `/api/pages/labels/remove`;
  - label search/list pages: `POST /api/labels`, `/api/labels/pages`.
  - page labels are space-scoped: label names are unique per space, list/search calls should pass `spaceId`, and labels from one space must not be shown as suggestions in another.
- Synced blocks replace the older Linked quote implementation:
  - editor node types: `transclusionSource` and `transclusionReference`;
  - API routes: `POST /api/pages/transclusion/lookup`, `/references`, `/unsync-reference`, and public `POST /api/shares/transclusion/lookup`;
  - legacy `quoteSource` marks and `quoteEmbed` nodes are cleaned by migration and are no longer registered in the editor schema.
- WebSocket relay accepts only `broadcast` envelopes targeting authorized `workspace-*`, `space-*`, or `user-*` rooms; nested realtime event operations are allowlisted server-side.
- Document custom fields are named `status`, `assignee`, `stakeholders`, `aiRole`, and `readingTime` at the space settings layer, and `status`, `assigneeId`, `stakeholderIds`, and `aiRole` on page/database row payloads. `readingTime` is derived from editor word count and is not persisted in page payloads. Do not document this feature as an `owner` field unless the code is renamed first. Editor word count uses whitespace splitting (TipTap default `wordCounter`), not `alfaaz`, to avoid inflated counts from punctuation/URLs; the reading-time estimate assumes `READING_WORDS_PER_MINUTE = 238`.
- Space sidebar custom links are stored at `space.settings.customLinks.links` (`{ id, label, url, icon }`). They are managed inline in the space sidebar main-links block: users with the space `Manage Settings` ability get a hover/focus delete action (with confirm) on each link and an "Add link" button that opens the add form (`custom-link-form-modal.tsx`). Persistence goes through `PATCH /api/spaces/:spaceId`, which is also gated by `Manage Settings`. URLs are restricted to `http(s)`, links open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`), and `icon` must be one of the curated identifiers in `SPACE_CUSTOM_LINK_ICONS` (server DTO) mirrored by the client icon registry `CUSTOM_LINK_ICONS`. The removed sidebar "Space settings" and "New page" main-menu entries are still reachable via the space menu dropdown and the page-tree create actions.
- PWA static files can contain user-facing strings outside i18next. Review `apps/client/public/offline.html`, `manifest.json`, and `sw.js` when changing offline or notification text.
- Root `start` script runs **backend prod**, but requires prebuilt `dist` (typically via `pnpm build`).
- Docker production startup bypasses the root `start` script and Corepack by running the compiled backend entrypoint directly.
- Backend production entrypoints are resolved from Nx/Nest build output under `apps/server/dist/apps/server/src/*` (not `apps/server/dist/main`).
- The production image copies runtime workspace package builds for `packages/editor-ext` and `packages/api-contract`; keep their package manifests and `dist` outputs in sync with server imports.
- Compose uses placeholders (`REPLACE_WITH_LONG_SECRET`, `STRONG_DB_PASSWORD`) in `.env.compose.example` and Docker defaults; do not forget to replace them.
- Per-space model and retrieval credentials live in `ai_space_configs`, encrypted with the application secret. Never return encrypted credential columns, put secrets in queue payloads, or store them in `spaces.settings`.
- Persistent AI chat uses the dedicated `AI_CHAT_QUEUE` for generation, file extraction, and retention cleanup. Do not attach its processor to the legacy `AI_QUEUE`, which still receives existing page/index lifecycle jobs.
- AI provider calls are immutable attempts introduced by `20260729T120000-ai-reliability.ts`. Bull delivery is at-least-once; workers claim queued runs with database compare-and-set, and the post-migration reconciler repairs missing deterministic jobs. Never reopen a terminal `ai_runs` row or automatically retry a stale running provider call.
- AI conversation/create/send/retry/regenerate idempotency keys are payload-bound. Private multipart chat uploads require `Idempotency-Key`, and deletes commit tombstones before retriable storage cleanup. Keep list responses exact (`{items}`; messages also include `hasMore` and `nextCursor`).
- AI conversation context is versioned through `GET/PUT /api/ai/conversations/:id/context`; explicit page/database/row sources are snapshotted per run and included in the Send fingerprint. Selection-only transforms use `/api/ai/editor-actions`, `ai_aux_runs`, and `ai:editor-action.*` events and must never create chat messages.
- The first successful chat response may schedule one auxiliary title run. Generated/fallback titles are limited to four Unicode word segments, manual rename wins every race, and realtime updates use `ai:conversation.updated`.
- Core AI locale strings live only under explicit `ai.*` keys in all supported translation files. `/locales/*` uses a network-first Service Worker strategy; bump the cache version when that delivery contract changes.
- Core per-space AI is the only editor generation UX. Do not reintroduce the EE Ask AI menu or read/write `settings.ai.generative`; historical JSON remains inert. Legacy EE AI search, `/api/ai/answers`, `AI_QUEUE`, and PageEmbeddings/indexing remain supported independently.
- `AI_PROVIDER_ALLOWED_ORIGINS` is the production SSRF boundary for administrator-configured model endpoints. Loopback URLs such as LM Studio are development-only, and `127.0.0.1` inside Docker refers to the Docmost container rather than the host.
- `AI_RETRIEVAL_ALLOWED_ORIGINS` is an independent SSRF boundary for external retrieval endpoints. Retrieval candidates are untrusted until their Docmost source IDs and current user page access are revalidated.
- `AI_STREAM_IDLE_TIMEOUT_MS` is a deployment-level inactivity limit, while `requestTimeoutMs` remains per-space and bounds the full provider request. The effective idle timeout is the smaller of the two.
- `/api/rag/*` remains the API-key-only synchronization/export surface for an external index. Query-time AI retrieval is optional `http-json-v1`, does not create a local vector index, and must degrade to the live document/file context when unavailable.
- Web Push compose defaults are intentionally empty; set all VAPID variables together when enabling push notifications.
- `migration:codegen` reads env from `../../.env`; if the file is missing, the command fails.
- Runtime image now includes headless `chromium` + Cyrillic-capable fonts for PDF export, and sets default `PDF_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
- There are Enterprise areas (`*/ee`): edits there may affect license-restricted code.
- The repository includes lock/override/patched dependencies — do not remove seemingly redundant pins without verification.

---

## 8) Useful external links

- Main documentation: https://docmost.com/docs
- Development section (mentioned in README): https://docmost.com/docs/self-hosting/development
- Localization platform: https://crowdin.com/
- i18next backend docs (for the current stack): https://github.com/i18next/i18next-http-backend

---

## 9) Localization (translations)

- Source of UI translations: `apps/client/public/locales/<locale>/translation.json`.
- Base locale and fallback: `en-US`.
- Crowdin sync config: `crowdin.yml` (source = `en-US/translation.json`, target = `%locale%`).
- When adding new user-facing strings:
  1. update `en-US/translation.json`;
  2. add keys in other locales as well (at minimum stub/copy if translation is handled externally);
  3. verify keys are used via `react-i18next` (`useTranslation`);
  4. separately review static PWA strings in `apps/client/public/{manifest.json,sw.js,offline.html}`, because they are not loaded through i18next.

---

## 10) Rule for keeping this file up to date

**You must update `AGENTS.md` for any changes affecting:**

- run/build/test/migration commands;
- directory structure and entry points;
- linters/formatters/style rules;
- required env and runtime versions;
- CI/CD process or container workflow;
- localization workflow and translation storage paths.

If a change is not reflected in `AGENTS.md`, the automation task is considered incomplete.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
