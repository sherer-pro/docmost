# Docmost Server (`apps/server`)

Backend-приложение на NestJS в рамках монорепозитория Docmost.

## Prerequisites

Перед запуском убедитесь, что заданы обязательные переменные окружения:

- `DATABASE_URL`
- `REDIS_URL`
- `APP_SECRET` (минимум 32 символа)

См. также `.env.example` в корне репозитория.

## Installation

Установка зависимостей выполняется из корня монорепозитория:

```bash
pnpm install --frozen-lockfile
```

## Run (dev / prod)

Все команды ниже запускаются из корня репозитория.

```bash
# development
pnpm --filter ./apps/server start

# watch mode (recommended for local development)
pnpm --filter ./apps/server start:dev

# build backend before production run
pnpm --filter ./apps/server build

# production mode
pnpm --filter ./apps/server start:prod
```

## Migrations

```bash
# create a new empty migration file
pnpm --filter ./apps/server migration:create --name=init

# apply pending migrations
pnpm --filter ./apps/server migration:up

# rollback one step
pnpm --filter ./apps/server migration:down

# apply all migrations up to latest
pnpm --filter ./apps/server migration:latest

# rollback one step and apply again
pnpm --filter ./apps/server migration:redo

# rollback all migrations
pnpm --filter ./apps/server migration:reset

# generate DB types (reads env from ../../.env)
pnpm --filter ./apps/server migration:codegen
```

## Tests

```bash
# unit/integration tests
pnpm --filter ./apps/server test

# e2e tests
pnpm --filter ./apps/server test:e2e

# coverage
pnpm --filter ./apps/server test:cov

# tsconfig path alias smoke test
pnpm --filter ./apps/server test:alias:smoke
```

## API routing conventions

- See `docs/api-routing-conventions.md` for endpoint grouping (CRUD/commands/computational), routing policy, and the RPC migration plan with deprecated aliases.

## Import style policy

- Use relative imports (`./`, `../`) for modules inside `apps/server/src` to keep local boundaries explicit and avoid mixed patterns in a single file.
- Use workspace aliases (`@docmost/*`) for shared packages and cross-workspace dependencies.
- The `src/*` alias is kept in TypeScript and Jest configs as a compatibility contract for tests and legacy imports, but new backend code should prefer relative imports for local modules.

## Watcher API status

- Public watcher endpoints `POST /api/pages/watch`, `POST /api/pages/unwatch`, and `POST /api/pages/watch-status` are not part of the active API surface.
- Watcher records are managed internally by backend services and queue processors.
- If watcher actions are needed in the client again, add explicit API routes and cover them with e2e tests before exposing them.
