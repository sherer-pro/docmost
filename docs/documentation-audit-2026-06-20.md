# Documentation Audit 2026-06-20

## Scope

This audit checked repository documentation against the current local code and configuration. External documentation links were recorded as references only and were not live-audited.

Sources of truth used:

- root and workspace package scripts: `package.json`, `apps/*/package.json`, `packages/*/package.json`
- workspace/runtime config: `pnpm-workspace.yaml`, `nx.json`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.env.compose.example`
- CI: `.github/workflows/ci.yml`, `.github/workflows/docker.yml`
- backend wiring and routes: `apps/server/src/app.module.ts`, `apps/server/src/core/core.module.ts`, `apps/server/docs/api-route-inventory.generated.md`
- frontend routes and public assets: `apps/client/src/App.tsx`, `apps/client/public`

## Findings

| Severity | Document | Finding | Source of truth | Resolution |
| --- | --- | --- | --- | --- |
| P1 | `apps/server/docs/api-routing-conventions.md` | Database API shape omitted active conversion, row context, row update/delete, markdown, and export routes. | `apps/server/src/core/database/database.controller.ts`, generated route inventory | Fixed in this audit. |
| P1 | `apps/server/docs/api-routing-conventions.md` | Dictionary API shape omitted JSON import/export action routes. | `apps/server/src/core/dictionary/dictionary.controller.ts`, generated route inventory | Fixed in this audit. |
| P2 | `README.md`, `AGENTS.md` | Custom document fields were described as `owner`, while code uses `assignee` at space settings and `assigneeId` in page/database payloads. | `UpdateSpaceDocumentFieldsDto`, `UpdatePageCustomFieldsDto`, `SpaceDocumentFieldsSettings` | Fixed in this audit. |
| P2 | `ARCHITECTURE.md` | Backend architecture summary did not mention several active modules and integration surfaces: API keys, RAG, page access, MFA, notifications/push, presence, import/export, static serving, telemetry, and optional EE loading. | `apps/server/src/app.module.ts`, `apps/server/src/core/core.module.ts` | Fixed in this audit. |
| P2 | `ARCHITECTURE.md`, `AGENTS.md`, `apps/client/README.md` | PWA static assets and user-facing strings outside i18next were not documented. | `apps/client/public/manifest.json`, `apps/client/public/sw.js`, `apps/client/public/offline.html` | Documented in this audit; `offline.html` remains a product/localization follow-up. |
| P2 | `AGENTS.md` | Optional environment variable list missed Web Push, search, and AI/RAG provider variables that are validated by the backend and present in `.env.example`. | `environment.validation.ts`, `environment.service.ts`, `.env.example` | Fixed in this audit. |
| P3 | `README.md` | Local quality checklist did not point readers to the repository-level verification scripts that mirror CI better than isolated build/lint/test commands. | root `package.json`, `.github/workflows/ci.yml` | Fixed in this audit. |
| P3 | `apps/server/README.md` | Server README linked routing policy but did not explain generated route inventory maintenance commands. | `scripts/generate-api-route-inventory.mjs`, root scripts | Fixed in this audit. |
| P3 | `packages/editor-ext/README.md` | Package README was too minimal to explain package purpose, contents, build/test commands, or Docker runtime relevance. | `packages/editor-ext/package.json`, Dockerfile package copy steps | Fixed in this audit. |

## Verification

Baseline checks before documentation edits:

- `corepack pnpm routes:inventory:check` - passed, 238 routes.
- `corepack pnpm check:env` - passed.
- `corepack pnpm check:comments:en` - passed.
- `corepack pnpm --filter ./apps/client exec vitest run src/i18n/locales-coverage.test.ts` - passed.

Post-edit checks:

- `corepack pnpm routes:inventory:check` - passed, 238 routes.
- `corepack pnpm check:env` - passed.
- `corepack pnpm check:comments:en` - passed.
- `corepack pnpm --filter ./apps/client exec vitest run src/i18n/locales-coverage.test.ts` - passed.
- `corepack pnpm audit:architecture` - completed as non-blocking. It reported existing architecture signals: 2 dependency-cruiser circular dependency warnings, Knip dead-code/dependency findings, and jscpd duplicate-code findings above the configured zero threshold.

## Residual Follow-Up

- `apps/client/public/offline.html` is a user-facing static HTML file with hard-coded localized copy outside `public/locales/*/translation.json`. Decide whether the offline page should stay intentionally static/localized, become English-only, or be generated from locale resources.
