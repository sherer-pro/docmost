# Docmost Server (`apps/server`)

NestJS backend application in the Docmost monorepo.

## Prerequisites

- Node.js 22.x
- pnpm 10.4.0
- PostgreSQL
- Redis

Install dependencies from repository root:

```bash
pnpm install --frozen-lockfile
```

## Required environment variables

Minimum:

- `APP_URL`
- `APP_SECRET` (at least 32 characters)
- `DATABASE_URL`
- `REDIS_URL`

Full list: root `.env.example`.

## Run commands

All commands are executed from repository root:

```bash
# development
pnpm --filter ./apps/server start:dev

# build
pnpm --filter ./apps/server build

# production (requires build artifacts)
pnpm --filter ./apps/server start:prod
```

## Tests and quality checks

```bash
# unit/integration tests
pnpm --filter ./apps/server test

# e2e tests
pnpm --filter ./apps/server test:e2e

# alias smoke
pnpm --filter ./apps/server test:alias:smoke

# coverage
pnpm --filter ./apps/server test:cov

# lint
pnpm --filter ./apps/server lint
```

## Migrations

```bash
pnpm --filter ./apps/server migration:create
pnpm --filter ./apps/server migration:up
pnpm --filter ./apps/server migration:down
pnpm --filter ./apps/server migration:latest
pnpm --filter ./apps/server migration:redo
pnpm --filter ./apps/server migration:reset
pnpm --filter ./apps/server migration:codegen
```

## Routing policy

See `docs/api-routing-conventions.md` for current API routing conventions and endpoint grouping.
