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
- Workspace-level pnpm settings (`overrides`, `patchedDependencies`) live in `pnpm-workspace.yaml`, not in the root `package.json`.
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
- `apps/client/src/features/editor/components/fixed-toolbar` — persistent editor toolbar shown when the user preference is enabled.
- `apps/client/public/locales/*` — JSON translations.
- `apps/client/public/{manifest.json,sw.js,offline.html}` — PWA manifest, Service Worker, and static offline page; these user-facing strings are outside the i18next locale JSON pipeline.
- `apps/server/src/database` — migrations and DB tooling.
- `packages/editor-ext/src/lib/{audio,pdf,transclusion,indent,page-break}` — editor nodes/extensions for audio, embedded PDFs, synced blocks, paragraph/heading indentation, and print page breaks.
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
- Backend security subset (share SEO + ZIP traversal/quotas + attachment token/MIME handling + PDF resource allowlist): `pnpm --filter ./apps/server test:security`
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
- Docker Compose env: copy `.env.compose.example` to `.env`, replace `REPLACE_WITH_LONG_SECRET` and `STRONG_DB_PASSWORD`, then run `docker compose up -d`.
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
- Reverse proxy attribution: `TRUSTED_PROXIES` is a comma-separated list of trusted proxy IPs/CIDRs or proxy-addr keywords (`loopback`, `linklocal`, `uniquelocal`). Leave it empty unless Docmost is behind a controlled proxy; `X-Forwarded-*` headers are ignored when it is empty.
- Embed iframe allowlist: `EMBED_ALLOWED_ORIGINS` is a comma-separated list of exact trusted `http(s)` origins for generic iframe embeds. Built-in providers are allowlisted separately; keep this empty unless the origin is trusted.
- Frontend build-time defines are loaded via `vite loadEnv`; deployment/runtime defines such as `APP_URL`, `COLLAB_URL`, `SUBDOMAIN_HOST`, `POSTHOG_*`, `BILLING_TRIAL_DAYS`, `FILE_UPLOAD_SIZE_LIMIT`, `FILE_IMPORT_SIZE_LIMIT`, `EMBED_ALLOWED_ORIGINS`, and `DRAWIO_URL` are served by the backend from `/window-config.js` without mutating built client files. Keep this contract in sync with `pnpm check:env`.

---

## 5) Dependencies and package managers

- Primary package manager: **pnpm** (workspace).
- Monorepo task orchestration: **Nx** (`nx run ...`, `nx run-many ...`).
- Dependency updates: via `pnpm up` (targeted by package or workspace).
- Security/audit:
  - baseline: `pnpm audit`
  - additionally account for `overrides` in `pnpm-workspace.yaml` (used to pin vulnerable/conflicting package versions).
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

- All mutating non-public API methods (POST/PUT/PATCH/DELETE) are protected by global CSRF validation (double-submit cookie): `csrfToken` cookie must match the `x-csrf-token` header.
- CSRF exceptions by design: routes marked `@Public()` and routes explicitly marked with the CSRF exemption decorator. Auth/setup examples include `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`, `POST /api/auth/password-reset`, `POST /api/auth/verify-token`, `POST /api/auth/setup`.
- Attachment/file API notes:
  - canonical upload routes: `POST /api/attachments/actions/upload-file`, `POST /api/attachments/actions/upload-image`, `POST /api/attachments/actions/remove-icon`.
  - canonical file routes: `GET /api/attachments/files/:fileId/:fileName`, `GET /api/attachments/files/public/:fileId/:fileName`.
  - compatibility aliases are still enabled for older clients/content: `POST /api/files/upload`, `GET /api/files/:fileId/:fileName`, `GET /api/files/public/:fileId/:fileName`, `POST /api/attachments/upload-image`, `POST /api/attachments/remove-icon`.
  - public attachment `?jwt=` query tokens remain accepted only as a legacy fallback after header/cookie tokens; responses using the query token include deprecation headers.
  - inline responses are allowed only for trusted extension/MIME pairs; spoofed inline extensions such as `.mp4` with HTML content are served as downloads with a safe content type.
- PDF export runs Chromium with a resource allowlist: only `data:`, `about:blank`, and same-origin public attachment URLs are fetched; external URLs in page content are blocked.
- File import fails the task if referenced attachment uploads fail after retries, preventing committed pages with broken attachment references.
- Generic iframe embeds are blocked unless their exact origin is listed in `EMBED_ALLOWED_ORIGINS`; built-in providers use the shared frame-source allowlist and server CSP.
- RAG API (`/api/rag/*`) is API-key-only:
  - pass `Authorization: Bearer <token>` from workspace API keys;
  - user JWT/cookie auth is rejected on `/api/rag/*`;
  - API keys are rejected outside `/api/rag/*`;
  - key scope is enforced by `spaceId` inside API key JWT payload.
- API key management routes are active in this fork:
  - user page: `/settings/account/api-keys`;
  - workspace management page: `/settings/api-keys`;
  - create key requires selecting `spaceId`;
  - access is restricted to workspace `admin|owner`.
- User session management routes are active:
  - account page: `/settings/account/profile` -> Active sessions;
  - API routes: `GET /api/sessions`, `POST /api/sessions/revoke`, `POST /api/sessions/revoke-all`;
  - new access tokens include `sessionId`, while old tokens without it are temporarily accepted by auth strategy.
- Live member presence is active for workspace admins/owners:
  - members page: `/settings/members` -> Presence column;
  - API route: `GET /api/workspace/members/presence?userIds=...`;
  - Socket.IO events: `presence:update` and `presence:clear`;
  - state is ephemeral in Redis and grouped by `sessionId`.
- Favorites and labels routes are active:
  - favorites: `POST /api/favorites`, `/api/favorites/add`, `/api/favorites/remove`, `/api/favorites/ids`;
  - page labels: `POST /api/pages/labels`, `/api/pages/labels/add`, `/api/pages/labels/remove`;
  - label search/list pages: `POST /api/labels`, `/api/labels/pages`.
- Synced blocks replace the older Linked quote implementation:
  - editor node types: `transclusionSource` and `transclusionReference`;
  - API routes: `POST /api/pages/transclusion/lookup`, `/references`, `/unsync-reference`, and public `POST /api/shares/transclusion/lookup`;
  - legacy `quoteSource` marks and `quoteEmbed` nodes are cleaned by migration and are no longer registered in the editor schema.
- WebSocket relay accepts only `broadcast` envelopes targeting authorized `workspace-*`, `space-*`, or `user-*` rooms; nested realtime event operations are allowlisted server-side.
- Document custom fields are named `status`, `assignee`, and `stakeholders` at the space settings layer, and `status`, `assigneeId`, and `stakeholderIds` on page/database row payloads. Do not document this feature as an `owner` field unless the code is renamed first.
- PWA static files can contain user-facing strings outside i18next. Review `apps/client/public/offline.html`, `manifest.json`, and `sw.js` when changing offline or notification text.
- Root `start` script runs **backend prod**, but requires prebuilt `dist` (typically via `pnpm build`).
- Docker production startup bypasses the root `start` script and Corepack by running the compiled backend entrypoint directly.
- Backend production entrypoints are resolved from Nx/Nest build output under `apps/server/dist/apps/server/src/*` (not `apps/server/dist/main`).
- The production image copies runtime workspace package builds for `packages/editor-ext` and `packages/api-contract`; keep their package manifests and `dist` outputs in sync with server imports.
- Compose uses placeholders (`REPLACE_WITH_LONG_SECRET`, `STRONG_DB_PASSWORD`) in `.env.compose.example` and Docker defaults; do not forget to replace them.
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
