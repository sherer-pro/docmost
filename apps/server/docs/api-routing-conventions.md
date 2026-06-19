# API Routing Conventions

This document defines routing style for backend API endpoints in `apps/server`.

Generated inventory reference:

- `apps/server/docs/api-route-inventory.generated.md`
- regenerate with `pnpm routes:inventory`

## Core rules

1. Use resource-oriented routes for CRUD:
   - collections: `/pages`, `/spaces`, `/users`
   - resources: `/spaces/:spaceId`, `/databases/:databaseId`
2. Use `/actions/*` for non-CRUD commands:
   - `/pages/actions/import`
   - `/pages/actions/import-zip`
   - `/pages/actions/export`
   - `/spaces/actions/export`
3. Keep read-only computational/service endpoints under explicit domain namespaces:
   - `/search`, `/health`, `/version`, `/collab`

## RAG API namespace

- RAG ingestion endpoints are exposed under `/rag/*`.
- `/rag/*` is read-only (`GET`) and does not use CSRF protection.
- Authentication contract:
  - only API keys (`Authorization: Bearer <token>`) are accepted;
  - user access JWT is rejected on `/rag/*`;
  - API keys are rejected outside `/rag/*`;
  - API key payload includes `spaceId`; all resource scope checks are derived from token scope.
- Current RAG routes:
  - `GET /rag/pages?includeContent=true|false`
  - `GET /rag/updates?updatedSince=<unix_ms>`
  - `GET /rag/deleted?deletedSince=<unix_ms>`
  - `GET /rag/pages/:pageIdOrSlug?includeContent=true|false`
  - `GET /rag/databases/:databaseIdOrPageSlug`
  - `GET /rag/databases/:databaseIdOrPageSlug/rows?pageIds=<pageId,pageId>`
  - `GET /rag/pages/:pageIdOrSlug/attachments`
  - `GET /rag/attachments/:fileId/:fileName`
  - `GET /rag/pages/:pageIdOrSlug/comments`
  - `GET /rag/pages/:pageIdOrSlug/export`
  - `GET /rag/space/export`

## Current status

- Canonical action/resource routes are primary API surface.
- Legacy compatibility aliases are intentionally preserved where migration safety is required (for example `/files/*` and select `/attachments/*` aliases).
- Any alias route must have a documented deprecation path and backward-compatibility tests.
- Retained legacy aliases should use `@DeprecatedRoute(...)` so responses include `Deprecation` and `Sunset` headers and server logs point to the canonical replacement.
- First-pass canonical command routes are active for pages, shares, groups, and comments under resource roots or `/actions/*`; old `/create`, `/update`, and `/delete` routes remain compatibility aliases.

## Read-like POST migration plan

Several existing read-only endpoints still use `POST` for historical body-shaped queries (`/info`, `/recent`, `/ids`, `/pages`, `/lookup`, and similar routes). Do not add new read-only `POST` endpoints unless the request body is too complex for query parameters or the route intentionally requires CSRF semantics.

Migration rules:

- Add a canonical `GET` route for read-only operations when parameters can be represented as path/query values.
- Keep the old `POST` route as a compatibility alias until older clients are no longer supported.
- Mark compatibility `POST` aliases with `@DeprecatedRoute(...)` and a concrete replacement route.
- Add route inventory updates and tests that prove the `GET` and compatibility `POST` routes return equivalent results.
- Document every retained read-like `POST` alias with a deprecation/removal condition.
- Leave command-like routes (`/actions/*`, create/update/delete, imports, exports, revoke, unsync) as mutating methods.

## Databases API shape

- Database CRUD:
  - `POST /databases`
  - `GET /databases?spaceId=:spaceId`
  - `GET /databases/:databaseId`
  - `PATCH /databases/:databaseId`
  - `DELETE /databases/:databaseId`
- Properties:
  - `GET /databases/:databaseId/properties`
  - `POST /databases/:databaseId/properties`
  - `PATCH /databases/:databaseId/properties/:propertyId`
  - `DELETE /databases/:databaseId/properties/:propertyId`
- Rows:
  - `GET /databases/:databaseId/rows`
    - optional query params: `limit`, `cursor`, `sortField`, `sortDirection`, `sortPropertyId`, `filters`
  - `POST /databases/:databaseId/rows`
  - `PATCH /databases/:databaseId/rows/batch`
- Cells batch update:
  - `PATCH /databases/:databaseId/rows/:pageId/cells`
- Views:
  - `GET /databases/:databaseId/views`
  - `POST /databases/:databaseId/views`
  - `PATCH /databases/:databaseId/views/:viewId`
  - `DELETE /databases/:databaseId/views/:viewId`

## Dictionary API shape

- Terms:
  - `GET /dictionary-terms?spaceId=:spaceId`
  - `POST /dictionary-terms`
  - `PATCH /dictionary-terms/:termId`
  - `DELETE /dictionary-terms/:termId`
- Space feature flag:
  - `PATCH /spaces/:spaceId` with `dictionaryEnabled: boolean`
