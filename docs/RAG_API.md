# RAG API (Docmost Core)

This document describes the current RAG API contract implemented in `docmost` core: API-key authentication, scope behavior, endpoint semantics, and integration patterns.

## 1. Core behavior

- Backend API prefix: `/api`
- All RAG endpoints: `/api/rag/*`
- All RAG endpoints are read-only (`GET`)
- RAG endpoints return raw JSON (not wrapped into `{ data, success, status }`)
- Export endpoints return ZIP streams (`application/zip`)
- Delta feeds support optional cursor pagination while preserving the legacy
  unpaginated response when `limit` and `cursor` are omitted

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

### 4.5 Delta pagination

`/rag/updates`, `/rag/deleted`, `/rag/attachments/updates`, and
`/rag/attachments/deleted` accept:

- `limit` (optional, `1..1000`);
- `cursor` (optional opaque string returned as `nextCursor`).

Responses retain `items` and `maxUpdatedAtMs|maxDeletedAtMs` and add `hasMore`
and `nextCursor`. The cursor binds the feed kind, timestamp, and ID tie-breaker;
an invalid or cross-feed cursor returns `400`. Consumers should not parse it.

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

### 5.4 `GET /api/rag/attachments/updates`

Live attachment delta scoped to the API key's space and the creator's current
read access to the owning page.

Query:

- `updatedSince` (required): Unix timestamp in milliseconds (`>= 0`)
- optional `limit` and `cursor` as described above

Items include `fileId`, file metadata, owning `pageId`, `updatedAtMs`, and an
API-key-authenticated `downloadUrl`.

### 5.5 `GET /api/rag/attachments/deleted`

Attachment tombstones for the scoped space.

Query:

- `deletedSince` (required): Unix timestamp in milliseconds (`>= 0`)
- optional `limit` and `cursor`

### 5.6 `GET /api/rag/pages/:pageIdOrSlug`

Page/document detail.

Params:

- `pageIdOrSlug`: page UUID or `slugId`

Query:

- `includeContent` (optional, default `true`)

### 5.7 `GET /api/rag/databases/:databaseIdOrPageSlug`

Full structured database export.

Params:

- `databaseIdOrPageSlug`:
  - database UUID
  - or database container page UUID/slug

Includes metadata, properties, rows/cells, and composed `knowledgeMarkdown`.

### 5.8 `GET /api/rag/databases/:databaseIdOrPageSlug/rows`

Rows export (raw cells + row markdown).

Query:

- `pageIds` (optional)
  - CSV format: `?pageIds=id1,id2`
  - repeated format: `?pageIds=id1&pageIds=id2`
  - omitted -> all rows

### 5.9 `GET /api/rag/pages/:pageIdOrSlug/attachments`

Attachment metadata list for the page, including ready-to-use `downloadUrl`.

### 5.10 `GET /api/rag/attachments/:fileId/:fileName`

Attachment binary stream.

Response headers:

- `Content-Type`
- `Content-Disposition: attachment`
- `Content-Length` (when known)
- `Cache-Control: private, max-age=3600`

The owning page and its ACL are checked again immediately before download.

### 5.11 `GET /api/rag/pages/:pageIdOrSlug/comments`

Page comments (including resolved).

### 5.12 `GET /api/rag/pages/:pageIdOrSlug/export`

Page export ZIP (optionally with children/attachments).

Query:

- `format`: `markdown|html` (default `markdown`)
- `includeAttachments`: boolean (default `true`)
- `includeChildren`: boolean (default `true`)

### 5.13 `GET /api/rag/space/export`

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

### 7.0 Relationship to built-in AI chat

The `/api/rag/*` endpoints are the synchronization/export side of an external
RAG integration. They do not provide query-time semantic search.

Built-in AI chat can call either the existing `http-json-v1` adapter or the
`open-webui-knowledge-v1` adapter. An external service may populate its index
through this RAG API and expose its query endpoint to Docmost. The API key used
by the external indexer and the credential Docmost uses to query that endpoint
are independent secrets.

Query results never grant access by themselves. The AI backend resolves returned
Docmost source IDs and re-checks the requesting user's current page access before
using content or creating citations.

The query adapter keeps a separate SSRF allowlist from both this inbound sync API
and the model provider. Its full timeout starts before DNS resolution, redirects
and URL credentials are rejected, the serialized request is capped at 1 MiB, and
the response is capped at 256 KiB. Individual malformed/non-UUID candidates are
discarded without losing valid siblings; duplicate source identities keep the
highest score. Timeout, oversized payload, `401`, `429`, `5xx`, or no readable
results degrades safely to document/file context and never invokes the model
inside the retrieval adapter.

The chat's external retrieval source types remain `page`, `database_row`, and
`attachment`. Core chat may separately resolve a whole database as an explicit
conversation-context source, but that internal `database` type does not extend
the external `http-json-v1` query contract.

### 7.0.1 Open WebUI writer

`apps/rag-sync` implements the optional Open WebUI 0.9.6 writer. One Knowledge
Base maps to one Docmost space. The application:

- reads only this API and never connects to the Docmost database;
- uses a separate Redis namespace/database for inclusive checkpoints,
  source-to-file mappings, and distributed space locks;
- uploads a new Open WebUI file and waits for processing before replacing the
  mapping and deleting the previous file;
- reconstructs lost Redis mappings from `meta.data.docmost`, removes duplicate
  superseded files, and ignores foreign workspace/space metadata;
- supports page, database-row, PDF, DOCX, TXT, MD, JPEG, PNG, and WebP sources;
- logs only IDs, states, counters, lag, and durations.

Configuration is loaded through `RAG_SYNC_CONFIG_PATH`. Docmost and Open WebUI
writer keys are paths to mounted secret files, never literal values in the JSON.
Use `rag-sync.config.example.json` as the schema reference. A Knowledge Base must
be created in advance; the worker never creates or deletes it.

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
   - attachment `updatedSince = 0`
   - attachment `deletedSince = 0`

### 7.2 Incremental sync loop

1. `GET /api/rag/updates?updatedSince=<lastUpdatedCheckpoint>&limit=500`
2. Upsert updated documents:
   - `type=page` -> `GET /api/rag/pages/:id?includeContent=true`
   - `type=database` -> `GET /api/rag/databases/:databaseIdOrPageSlug`
3. Follow `nextCursor` while `hasMore=true`
4. Process `/api/rag/attachments/updates` using its own checkpoint
5. Process `/api/rag/deleted` and `/api/rag/attachments/deleted`
6. Delete/deactivate tombstoned records in the index
7. Update each checkpoint only after its complete feed page succeeds:
   - `lastUpdatedCheckpoint = maxUpdatedAtMs`
   - `lastDeletedCheckpoint = maxDeletedAtMs`
   - attachment update/delete checkpoints advance independently

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
