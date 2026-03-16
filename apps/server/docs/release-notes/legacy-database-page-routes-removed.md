# Release note: legacy database/page routes removed

## Change

Legacy database/page routes are no longer the primary navigation format.

- Primary database URL format in the client: `/s/:spaceSlug/db/:databaseSlug` (via `slugId`).
- Primary page URL format in the client: `/s/:spaceSlug/p/:pageSlug`.

The legacy branch `/s/:spaceSlug/databases/:databaseId` is kept only as a **temporary fallback** for cases where a database tree node still has no `slugId`.

## Current client behavior (fixed priority)

Database node URL generation is centralized in `buildDatabaseNodeUrl` (`apps/client/src/features/page/page.utils.ts`) and follows this strict order:

1. Canonical URL by `slugId`: `/s/:spaceSlug/db/:databaseSlug`.
2. Temporary fallback by `databaseId`: `/s/:spaceSlug/databases/:databaseId`.
3. If route data is missing, fallback to `/s/:spaceSlug`.

Fallback lifetime is explicitly declared in `DATABASE_ROUTE_FALLBACK_CONFIG`:

- `enabled: true`
- `removeBy: '2026-03-31'`
- `ticket: 'DOC-2471'`

After `DOC-2471` is resolved, the fallback must be removed completely.

## Verification: no legacy URLs in active templates/exports

A codebase search was executed across notification and export paths.

Command used:

```bash
rg -n "databases/:databaseId|/s/\$\{.*\}/databases/|/databases/" apps/server/src/core/notification apps/server/src/integrations/export apps/server/src/integrations/transactional
```

Result: no active `/s/:spaceSlug/databases/:databaseId` link generators were found in notification/export flows.
