# Docmost Client (`apps/client`)

React + Vite frontend application for Docmost.

## Prerequisites

- Node.js 22.x
- pnpm 10.4.0

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

## Common commands

Run from repository root:

```bash
# Start frontend dev server
pnpm --filter ./apps/client dev

# Type-check and production build
pnpm --filter ./apps/client build

# Run unit tests (Vitest)
pnpm --filter ./apps/client test

# Lint
pnpm --filter ./apps/client lint

# Format
pnpm --filter ./apps/client format
```

## Runtime env consumed by the client

The client reads these values via `vite loadEnv`:

- `APP_URL`
- `COLLAB_URL`
- `FILE_UPLOAD_SIZE_LIMIT`
- `FILE_IMPORT_SIZE_LIMIT`
- `EMBED_ALLOWED_ORIGINS`
- `DRAWIO_URL`
- `CLOUD`
- `SUBDOMAIN_HOST`
- `BILLING_TRIAL_DAYS`
- `POSTHOG_HOST`
- `POSTHOG_KEY`

In development these values come from repository root `.env*` files. In production/static serving, the backend serves the deployment/runtime subset from `/window-config.js` without mutating built client files.

See `../../.env.example` (or repo root `.env.example`) for the host-development reference, and keep runtime key changes covered by `pnpm check:env`.
