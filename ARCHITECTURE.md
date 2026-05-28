# Docmost Architecture

## Repository Shape

Docmost is a pnpm workspace orchestrated by Nx. The main runtime surfaces are:

- `apps/server` - NestJS API, background jobs, websocket gateway, migrations, and storage/search integrations.
- `apps/client` - Vite and React frontend.
- `packages/editor-ext` - shared Tiptap/ProseMirror editor extensions consumed by the client and server-side rendering paths.

The production container uses Node.js 22 and runs the built backend through the root `pnpm start` script. The root `pnpm build` task builds all workspace projects.

## Backend

The backend is organized around Nest modules under `apps/server/src/core`. HTTP controllers expose `/api/*` routes, while domain services own business rules and database writes. Kysely repositories under `apps/server/src/database/repos` encapsulate repeated database access patterns.

Security-sensitive cross-cutting behavior is centralized:

- JWT authentication is enforced by `JwtAuthGuard`.
- Mutating routes are protected by the global CSRF guard, except explicit auth/setup exemptions.
- Page and space visibility is resolved through `PageAccessService`.
- RAG routes use API-key auth and reject regular user JWT/cookie auth.
- Link preview metadata fetching validates public destinations and pins the resolved IP for the outbound request.

The database schema is managed through Kysely migrations in `apps/server/src/database/migrations`. Generated Kysely types live under `apps/server/src/database/types`.

## Frontend

The frontend is feature-oriented under `apps/client/src/features`. API calls are kept in feature service modules and use the shared API client. Search, editor, transclusion, database, session, favorite, and dictionary functionality are grouped by feature instead of by technical layer.

Runtime environment values for the frontend are loaded in `apps/client/vite.config.ts` from the repository root `.env*` files and injected into `process.env` at build time.

## Collaboration And Editor

Realtime collaboration is handled by the backend collaboration entrypoints and websocket infrastructure. Editor node definitions and serializers live partly in `packages/editor-ext` so the client and server can share document behavior.

Synced blocks use `transclusionSource` and `transclusionReference` nodes. Server-side lookup and unsync logic is under `apps/server/src/core/page/transclusion`, while client lookup UI and node views are under `apps/client/src/features/editor/components/transclusion` and `apps/client/src/features/transclusion`.

## Search

Page search supports the database full-text implementation and an enterprise Typesense implementation. Attachment search uses the database full-text index on `attachments.tsv` and applies the same page access filtering through `PageAccessService`.

Generated backend route inventory is maintained by `pnpm routes:inventory` and checked by CI through `pnpm routes:inventory:check`.

## Environment Contract

`.env.example` is the canonical checked-in environment contract. Local `.env` may contain deployment-specific values, but it must keep the same key set. The server validation class in `apps/server/src/integrations/environment/environment.validation.ts` and the frontend runtime keys in `apps/client/vite.config.ts` are checked against `.env.example` by `pnpm check:env`.

## Verification

Baseline local verification:

1. `pnpm install --frozen-lockfile`
2. `pnpm verify:quick`
3. `pnpm verify:full` before release or broad architectural changes

Security regression coverage is available through `pnpm test:security`, and production dependency audit is run in CI with `pnpm audit --prod --audit-level high`.
