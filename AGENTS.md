# AGENTS.md — practical automation cheat sheet for `docmost`

> Goal: give an agent/developer the minimum context needed to **start executing tasks immediately without follow-up questions**. Only practical steps, verified against the current code and configs, are included below.

## 0) Quick repository profile

- Monorepo built with **pnpm workspaces** + **Nx**.
- Main applications:
  - `apps/server` — NestJS backend.
  - `apps/client` — Vite + React frontend.
  - `packages/editor-ext` — shared TypeScript package with editor extensions.
- Root package manager is pinned: `pnpm@10.4.0`.
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
- `apps/client/src` — main frontend code.
- `apps/client/public/locales/*` — JSON translations.
- `apps/server/src/database` — migrations and DB tooling.
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
- Build the entire monorepo: `pnpm build`
- Clean build artifacts: `pnpm clean`

### Development

- Fullstack dev: `pnpm dev`
- Backend only: `pnpm server:dev`
- Frontend only: `pnpm client:dev`
- Local preview of the frontend build: `pnpm --filter ./apps/client preview`

### Linting and formatting

- Backend lint (with autofixes): `pnpm --filter ./apps/server lint`
- Frontend lint: `pnpm --filter ./apps/client lint`
- Backend format: `pnpm --filter ./apps/server format`
- Frontend format: `pnpm --filter ./apps/client format`
- Check comments language (server/client src + server tests + client public + editor-ext src): `pnpm check:comments:en`

### Tests

- Backend unit/integration: `pnpm --filter ./apps/server test`
- Backend coverage: `pnpm --filter ./apps/server test:cov`
- Backend coverage smoke (fast regression check): `pnpm --filter ./apps/server test:cov:smoke`
- Backend alias smoke (verify tsconfig alias resolution in Jest): `pnpm --filter ./apps/server test:alias:smoke`
- Backend e2e: `pnpm --filter ./apps/server test:e2e`

### Database migrations (backend)

- Create migration: `pnpm --filter ./apps/server migration:create`
- Apply: `pnpm --filter ./apps/server migration:up`
- Roll back 1 step: `pnpm --filter ./apps/server migration:down`
- Apply up to latest: `pnpm --filter ./apps/server migration:latest`
- Redo: `pnpm --filter ./apps/server migration:redo`
- Full reset: `pnpm --filter ./apps/server migration:reset`
- Generate DB types: `pnpm --filter ./apps/server migration:codegen`

### Containers

- Local container startup (prebuilt image): `docker compose up -d`
- Build the current code into an image: `docker build -t docmost:local .`

> `DATABASE_URL`, `REDIS_URL`, and `APP_SECRET` are required for migrations, backend startup, and part of the integration functionality (see `.env.example`).

---

## 3) Style conventions (as observed)

### TypeScript/JS style

- Prettier in backend/editor-ext: `singleQuote: true`, `trailingComma: all`.
- The frontend has places with double quotes (ESLint config/code); there is no globally enforced quote style in the shared root config — **do not perform mass style-only quote rewrites unless explicitly requested**.
- Indentation in the codebase uses spaces (typically 2).

### ESLint practices

- In both backend and frontend, several strict TS rules are intentionally relaxed (`no-explicit-any`, `no-unused-vars`, `ban-ts-comment` are disabled).
- Backend lint runs with `--fix`; running lint in the touched app before commit is recommended.
- Write comments in code only in English (ASCII), without Cyrillic.
- Before opening a PR, run `pnpm check:comments:en` and ensure it passes.

### Commit message format (based on history)

- Conventional Commits-like style is prevalent: `feat(...)`, `fix(...)`, `docs: ...`.
- Merge commits from PRs are acceptable.

---

## 4) Constraints and environment variables

### Minimum versions/runtimes

- Node.js: target **22.x** (from Dockerfile: `node:22-slim`).
- pnpm: **10.4.0** (pinned in `packageManager` and Dockerfile).
- PostgreSQL in compose: `postgres:18`.
- Redis in compose: `redis:8`.

### Required env for local backend startup

Minimum:

- `APP_URL` (usually `http://localhost:3000`)
- `PORT` (default 3000)
- `APP_SECRET` (minimum 32 characters)
- `DATABASE_URL`
- `REDIS_URL`

### Frequently used optional env

- Storage: `STORAGE_DRIVER`, `AWS_S3_*`
- Mail: `MAIL_DRIVER`, `SMTP_*`, `POSTMARK_TOKEN`
- Diagnostics: `DEBUG_MODE`, `DEBUG_DB`, `LOG_HTTP`
- Frontend runtime defines: `COLLAB_URL`, `SUBDOMAIN_HOST`, `POSTHOG_*`, `BILLING_TRIAL_DAYS`, etc. (loaded via `vite loadEnv`).

---

## 5) Dependencies and package managers

- Primary package manager: **pnpm** (workspace).
- Monorepo task orchestration: **Nx** (`nx run ...`, `nx run-many ...`).
- Dependency updates: via `pnpm up` (targeted by package or workspace).
- Security/audit:
  - baseline: `pnpm audit`
  - additionally account for `pnpm.overrides` in root `package.json` (used to pin vulnerable/conflicting package versions).
- Dependency patches: keep and maintain them in `patches/` and in `pnpm.patchedDependencies`.

---

## 6) CI/CD and local reproduction

- The repository currently has **no** `.github/workflows` directory or any other explicit CI manifest.
- De facto required local pipeline before PR:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm build`
  3. lint/test only for impacted parts (`apps/server`, `apps/client`).
  4. for infrastructure changes — `docker build` and/or `docker compose up` smoke check.

---

## 7) Mismatches and pitfalls

- All mutating API methods (POST/PUT/PATCH/DELETE) are protected by global CSRF validation (double-submit cookie): `csrfToken` cookie must match the `x-csrf-token` header.
- CSRF exceptions by design: `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`, `POST /api/auth/password-reset`, `POST /api/auth/verify-token`, `POST /api/auth/setup`.
- Root `start` script runs **backend prod**, but requires prebuilt `dist` (typically via `pnpm build`).
- Compose uses placeholders (`REPLACE_WITH_LONG_SECRET`, `STRONG_DB_PASSWORD`) — do not forget to replace them.
- `migration:codegen` reads env from `../../.env`; if the file is missing, the command fails.
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
  3. verify keys are used via `react-i18next` (`useTranslation`).

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
