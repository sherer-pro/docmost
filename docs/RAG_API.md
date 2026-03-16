# RAG API (Docmost Core)

This document describes the current RAG API contract implemented in `docmost` core: API-key authentication, scope behavior, endpoint semantics, and integration patterns.

## 1. Core behavior

- Backend API prefix: `/api`
- All RAG endpoints: `/api/rag/*`
- All RAG endpoints are read-only (`GET`)
- RAG endpoints return raw JSON (not wrapped into `{ data, success, status }`)
- Export endpoints return ZIP streams (`application/zip`)
- RAG endpoints currently do not support pagination

## 2. Authentication and scope

### 2.1 Token type

`/api/rag/*` accepts only workspace API keys in the `Authorization` header:

```http
Authorization: Bearer <token>
```

User JWT/cookie authentication is rejected for `/api/rag/*`.

### 2.2 Where API keys are accepted

- API keys are accepted only on `/api/rag/*`
- Using an API key outside `/api/rag/*` returns `401 Unauthorized`

### 2.3 Scope enforcement

API key JWT payload includes:

- `workspaceId`
- `spaceId`
- `apiKeyId`
- `sub` (creator user id)

Data returned by `/api/rag/*` is always restricted to `spaceId` from the API key.

- Resource exists but outside token scope -> `403 Forbidden`
- Missing/invalid/expired/revoked token -> `401 Unauthorized`

### 2.4 Host binding in cloud mode

In cloud mode, workspace is resolved by host/subdomain. `workspaceId` from the API key must match the host-resolved workspace, otherwise the request is rejected (`401`).

### 2.5 API key management endpoints

RAG uses keys created by API key management endpoints:

- `POST /api/api-keys`
- `POST /api/api-keys/create`
- `POST /api/api-keys/update`
- `POST /api/api-keys/revoke`

Only workspace `owner|admin` can manage API keys. `spaceId` is required when creating a key.

## 3. Error model

Common status codes:

- `400 Bad Request` - query/params/body validation failure
- `401 Unauthorized` - token missing/invalid, user JWT on `/rag/*`, or API key outside `/rag/*`
- `403 Forbidden` - resource is outside API key `spaceId` scope
- `404 Not Found` - resource not found or unavailable

## 4. Data semantics

### 4.1 Document types

RAG APIs use:

- `page`
- `database`
- `databaseRow` (in page detail and deleted tombstones)

### 4.2 Full list (`/rag/pages`)

Returns active `page|database` items:

- regular pages
- database container pages
- database rows are not returned here

### 4.3 Delta endpoints (`/rag/updates`, `/rag/deleted`)

Delivery guarantee is at-least-once:

- duplicates are possible
- loss is not expected when checkpointing correctly
- `updatedSince` / `deletedSince` are inclusive (`>=`)

Recommended consumer behavior:

- store `maxUpdatedAtMs` and `maxDeletedAtMs`
- send these values back on the next request
- use idempotent upsert/delete operations

### 4.4 `customFields` contract

`customFields` for `page`/`database`/`row.page` is derived from `space.settings.documentFields`.

Rules:

- if a field is disabled in space settings, the key is omitted
- if enabled, key is always present:
  - `status: string | null`
  - `assigneeId: string | null`
  - `stakeholderIds: string[]` (empty array allowed)

## 5. RAG endpoints

### 5.1 `GET /api/rag/pages`

Full list of active `page|database` in API key scope.

Query:

- `includeContent` (optional, default `false`)
  - truthy: `1|true|yes|on`
  - falsy: `0|false|no|off`

`contentMarkdown` and `descriptionMarkdown` are returned only when `includeContent=true`.

### 5.2 `GET /api/rag/updates`

Updates delta for `page|database`.

Query:

- `updatedSince` (required): Unix timestamp in milliseconds (`>= 0`)

Sort order:

- `updatedAt ASC`
- tie-breaker: `id ASC`

Database delta includes changes from:

- `databases.updatedAt`
- database container page `pages.updatedAt`
- `database_properties.updatedAt`
- `database_rows.updatedAt`
- `database_cells.updatedAt`
- row page `pages.updatedAt`

### 5.3 `GET /api/rag/deleted`

Deleted delta (tombstones) for `page|database|databaseRow`.

Query:

- `deletedSince` (required): Unix timestamp in milliseconds (`>= 0`)

Sort order:

- `deletedAt ASC`
- tie-breaker: `id ASC`

### 5.4 `GET /api/rag/pages/:pageIdOrSlug`

Page/document detail.

Params:

- `pageIdOrSlug`: page UUID or `slugId`

Query:

- `includeContent` (optional, default `true`)

### 5.5 `GET /api/rag/databases/:databaseIdOrPageSlug`

Full structured database export.

Params:

- `databaseIdOrPageSlug`:
  - database UUID
  - or database container page UUID/slug

Includes metadata, properties, rows/cells, and composed `knowledgeMarkdown`.

### 5.6 `GET /api/rag/databases/:databaseIdOrPageSlug/rows`

Rows export (raw cells + row markdown).

Query:

- `pageIds` (optional)
  - CSV format: `?pageIds=id1,id2`
  - repeated format: `?pageIds=id1&pageIds=id2`
  - omitted -> all rows

### 5.7 `GET /api/rag/pages/:pageIdOrSlug/attachments`

Attachment metadata list for the page, including ready-to-use `downloadUrl`.

### 5.8 `GET /api/rag/attachments/:fileId/:fileName`

Attachment binary stream.

Response headers:

- `Content-Type`
- `Content-Disposition: attachment`
- `Content-Length` (when known)
- `Cache-Control: private, max-age=3600`

### 5.9 `GET /api/rag/pages/:pageIdOrSlug/comments`

Page comments (including resolved).

### 5.10 `GET /api/rag/pages/:pageIdOrSlug/export`

Page export ZIP (optionally with children/attachments).

Query:

- `format`: `markdown|html` (default `markdown`)
- `includeAttachments`: boolean (default `true`)
- `includeChildren`: boolean (default `true`)

### 5.11 `GET /api/rag/space/export`

Space export ZIP for the API key scope.

Query:

- `format`: `markdown|html` (default `markdown`)
- `includeAttachments`: boolean (default `true`)

## 6. API key management (to obtain RAG token)

These endpoints use user auth session/JWT (`owner|admin`) and are not part of `/rag/*`.

### 6.1 `POST /api/api-keys`

List API keys.

Body:

- `limit` (optional, default `20`, max `100`)
- `cursor` (optional)
- `beforeCursor` (optional)
- `query` (optional, name filter)
- `adminView` (optional bool):
  - `true` -> all workspace keys
  - `false` or omitted -> current user keys only

### 6.2 `POST /api/api-keys/create`

Create API key and return one-time `token`.

Body:

- `name` (required, max 255)
- `spaceId` (required, UUID)
- `expiresAt` (optional ISO datetime)

### 6.3 `POST /api/api-keys/update`

Rename API key.

Body:

- `apiKeyId` (required UUID)
- `name` (required)

### 6.4 `POST /api/api-keys/revoke`

Revoke API key (soft delete).

Body:

- `apiKeyId` (required UUID)

## 7. Recommended RAG integration flow

### 7.1 Initial sync

1. Create API key scoped to the target `spaceId`.
2. Call `GET /api/rag/pages?includeContent=true`.
3. For each document:
   - `type=page` -> index as page
   - `type=database` -> call `GET /api/rag/databases/:databaseIdOrPageSlug`
4. For pages with attachments:
   - call `GET /api/rag/pages/:id/attachments`
   - download binaries through `downloadUrl` or `/api/rag/attachments/:fileId/:fileName`
5. Initialize checkpoints:
   - `updatedSince = 0`
   - `deletedSince = 0`

### 7.2 Incremental sync loop

1. `GET /api/rag/updates?updatedSince=<lastUpdatedCheckpoint>`
2. Upsert updated documents:
   - `type=page` -> `GET /api/rag/pages/:id?includeContent=true`
   - `type=database` -> `GET /api/rag/databases/:databaseIdOrPageSlug`
3. `GET /api/rag/deleted?deletedSince=<lastDeletedCheckpoint>`
4. Delete/deactivate tombstoned records in the index
5. Update checkpoints:
   - `lastUpdatedCheckpoint = maxUpdatedAtMs`
   - `lastDeletedCheckpoint = maxDeletedAtMs`

### 7.3 Idempotency requirement

Because delivery is at-least-once, consumers must:

- upsert by stable keys (`id`/`databaseId`/`rowId`)
- make delete operations idempotent
- avoid exactly-once assumptions

## 8. Practical notes

- `/api/rag/*` endpoints do not require CSRF tokens (all routes are `GET`).
- For large datasets, enable compression (gzip/br) in reverse proxy or server layer.
- In `/rag/attachments/:fileId/:fileName`, the file is resolved by `fileId`; `fileName` is URL metadata.
- Use separate API keys per integration client and per space.
