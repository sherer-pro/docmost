# API Routing Conventions

This document defines routing style for backend API endpoints in `apps/server`.

Generated inventory reference:

- `apps/server/docs/api-route-inventory.generated.md`
- regenerate with `pnpm routes:inventory`
- verify drift with `pnpm routes:inventory:check`

Paths in this document are shown without the global `/api` prefix unless the
prefix is explicitly needed for clarity.

Deprecation tracking:

- `apps/server/docs/api-route-deprecation-matrix.md`
- every retained compatibility alias should have a canonical replacement,
  removal condition, and matching `@DeprecatedRoute(...)` metadata unless the
  matrix explicitly lists it as a non-deprecated dual-method route.

## Core rules

1. Use resource-oriented routes for CRUD:
   - collections: `/pages`, `/spaces`, `/users`
   - resources: `/spaces/:spaceId`, `/databases/:databaseId`
2. Use `/actions/*` for non-CRUD commands:
   - `/pages/actions/import`
   - `/pages/actions/import-zip`
   - `/pages/actions/export`
   - `/pages/actions/copy-markdown-with-comments`
   - `/spaces/actions/export`
   - `/dictionary-terms/actions/import`
   - `/dictionary-terms/actions/export`
3. Keep read-only computational/service endpoints under explicit domain namespaces:
   - `/search`, `/health`, `/version`, `/collab`

## Authentication policy scopes

- Routes without an explicit scope use the workspace policy.
- Bootstrap routes expose only the authenticated principal and minimal navigation
  context needed to complete step-up authentication.
- `GET /spaces` is the paginated bootstrap catalog. `GET
/spaces/policy-context?spaceSlug=...` is the canonical bootstrap lookup for an
  active route and is not limited to the first catalog page.
- Space/resource routes resolve the owning space before evaluating MFA and SSO
  assurance. A failed evaluation returns `428
AUTHENTICATION_ASSURANCE_REQUIRED`; it must not be converted into a global
  login redirect.

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

## AI tool policy and MCP namespaces

- Workspace built-in tool policy uses the singleton resource
  `GET/PATCH /ai/tool-policy`. It is restricted to workspace `owner|admin` and
  returns the catalog together with the deployment maximum and exact workspace
  allowlist.
- Space narrowing is a nested singleton resource:
  `GET/PUT /spaces/:spaceId/ai/tool-policy`. It requires the space
  `Manage Settings` ability; the stored allowlist is nullable so `null` means
  inherit and `[]` means deny all.
- API-key management remains under the existing authenticated API-key routes.
  The `allowedCapabilities` field is valid only for `keyType=mcp`; RAG keys
  reject it.
- The inbound MCP protocol endpoint is the root-level `/mcp`, outside the
  global `/api` prefix and outside this controller-generated inventory. It is
  stateless, accepts only `keyType=mcp`, and exposes only read definitions
  allowed by the shared policy resolver and the key's exact allowlist.
- Outbound external MCP settings remain under `/ai/mcp-*` and
  `/spaces/:spaceId/ai/mcp-*`. They are not part of the inbound key policy and
  must not reuse its routes or credentials.

## Current status

- Canonical action/resource routes are primary API surface.
- The only retained compatibility aliases are the private and public `GET /api/files/*` routes because persisted page content may still reference them.
- Any alias route must have a documented deprecation path and backward-compatibility tests.
- Retained legacy aliases should use `@DeprecatedRoute(...)` so responses include `Deprecation` and `Sunset` headers and server logs point to the canonical replacement.
- Canonical command routes for pages, shares, groups, and comments are active under resource roots or `/actions/*`. The old `/create`, `/update`, `/delete`, and read-like aliases were removed in August 2026; see `release-notes/api-alias-removal-2026-08.md`.

## Read-like route policy

Several existing read-only endpoints still use `POST` for historical body-shaped queries (`/info`, `/recent`, `/ids`, `/pages`, `/lookup`, and similar routes). Do not add new read-only `POST` endpoints unless the request body is too complex for query parameters or the route intentionally requires CSRF semantics.

Rules:

- Add a canonical `GET` route for read-only operations when parameters can be represented as path/query values.
- Do not add a second method or path for an existing operation without an explicit compatibility decision and removal condition.
- Regenerate the route inventory and test the canonical route behavior whenever the routing contract changes.
- Leave command-like routes (`/actions/*`, create/update/delete, imports, exports, revoke, unsync) as mutating methods.

## Databases API shape

- Database CRUD:
  - `POST /databases`
  - `GET /databases?spaceId=:spaceId`
  - `GET /databases/:databaseId`
  - `PATCH /databases/:databaseId`
  - `DELETE /databases/:databaseId`
  - `POST /databases/:databaseId/convert-to-page`
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
  - `PATCH /databases/:databaseId/rows/:pageId`
  - `DELETE /databases/:databaseId/rows/:pageId`
  - `GET /databases/rows/:pageId/context`
- Cells batch update:
  - `PATCH /databases/:databaseId/rows/:pageId/cells`
- Table markdown and export:
  - `GET /databases/:databaseId/markdown`
  - `POST /databases/:databaseId/export`
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
- Import/export:
  - `POST /dictionary-terms/actions/import`
  - `POST /dictionary-terms/actions/export`
- LLM word-form generation:
  - `GET /dictionary-terms/word-form-generation/status?spaceId=:spaceId`
  - `POST /dictionary-terms/actions/generate-word-forms`
  - `POST /dictionary-terms/actions/generate-all-word-forms`
- Space feature flag:
  - `PATCH /spaces/:spaceId` with `dictionaryEnabled: boolean`

## Page Conversion And Export Commands

- Page/database conversion:
  - `POST /pages/:pageId/convert-to-database`
  - `POST /databases/:databaseId/convert-to-page`
- Page/space export and copy helpers:
  - `POST /pages/actions/export`
  - `POST /pages/actions/copy-markdown-with-comments`
  - `POST /spaces/actions/export`
