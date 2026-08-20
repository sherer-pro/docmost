# RAG API (Docmost Core)

This document describes the current RAG API contract implemented in `docmost` core: API-key authentication, scope behavior, endpoint semantics, and integration patterns.

This file is the canonical external synchronization wire contract. Architecture,
internal AI behavior, security rationale, and recovery procedures live in
[`AI_ASSISTANT_AND_RAG.md`](./AI_ASSISTANT_AND_RAG.md). Executable examples are
kept in [`Docmost RAG API.postman_collection.json`](./Docmost%20RAG%20API.postman_collection.json).
`pnpm check:rag-docs` verifies that the collection covers every generated RAG
route and that its API-key examples explicitly create and list RAG keys.

## 1. Core behavior

- Backend API prefix: `/api`
- All RAG endpoints: `/api/rag/*`
- All RAG endpoints are read-only (`GET`)
- RAG endpoints return raw JSON (not wrapped into `{ data, success, status }`)
- Export endpoints return ZIP streams (`application/zip`)
- Delta feeds support optional cursor pagination while preserving the legacy
  unpaginated response when `limit` and `cursor` are omitted

## 2. Authentication and scope

Template catalog entries are outside RAG scope. Pages created from regular or
synchronized templates are ordinary materialized pages and remain eligible for
feeds and direct reads under the usual key, ACL, and content-policy checks.

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
The workspace must remain active and the scoped space must remain unarchived;
archiving the space invalidates its RAG and MCP keys immediately.

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
Create RAG keys with `keyType: "rag"`; MCP keys are not accepted by this API.

### 2.6 AI/RAG content exclusions

Every live RAG response is also filtered by the space AI content policy.
Rules may exclude one page or its current descendant subtree. The same filter
applies to pages, databases, rows, attachments, detail routes, and exports by
their backing `pageId`. Deleted feeds remain unfiltered so consumers can remove
objects that were indexed before a rule changed.

## 3. Error model

Common status codes:

- `400 Bad Request` - query/params/body validation failure
- `401 Unauthorized` - token missing/invalid, user JWT on `/rag/*`, or API key outside `/rag/*`
- `403 Forbidden` - resource is outside API key `spaceId` scope
- `404 Not Found` - resource not found or unavailable
- `429 Too Many Requests` - the per-key request or concurrency limit is saturated; retry after the `Retry-After` delay
- `503 Service Unavailable` - Redis admission control is unavailable, so the external endpoint fails closed

## 4. Data semantics

### 4.1 Document types

RAG APIs use:

- `page`
- `database`
- `databaseRow` (in page detail and deleted tombstones)
- `dictionaryTerm` (in the independent dictionary list and feeds)

The synchronizer source types are `page`, `database_row`, `attachment`, and
`dictionary_term`. A dictionary source has `pageId: null`; every page-backed
source keeps a required page UUID.

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

- keep the original `updatedSince` or `deletedSince` together with `nextCursor`
  until the paginated snapshot reaches `hasMore=false`
- only then store the terminal `maxUpdatedAtMs` or `maxDeletedAtMs` and send it
  as the next cycle's watermark
- use idempotent upsert/delete operations

### 4.4 `customFields` contract

`customFields` for `page`/`database`/`row.page` is derived from `space.settings.documentFields`.

Rules:

- if a field is disabled in space settings, the key is omitted
- if enabled, key is always present:
  - `status: string | null`
  - `assigneeId: string | null`
  - `stakeholderIds: string[]` (empty array allowed)
  - `aiRole: "NONE"|"EDITOR"|"COAUTHOR"|"COAUTHOR_PLUS"|"AUTHOR"`

UUIDs remain in structured metadata. `knowledgeMarkdown` resolves assignee and
stakeholder UUIDs to current display names without email addresses. A missing
member is rendered as `Unknown member (<id>)`.

`contentMarkdown`, `descriptionMarkdown`, and `rowMarkdown` keep their existing
semantics. `knowledgeMarkdown` is the canonical AI/index projection ordered as
title, `Document fields`, database schema or named cells where applicable, and
then the source text. Every configured database property is emitted by name;
an empty cell is represented explicitly as `null` in metadata and `Not set` in
Markdown. Database select/status settings include their user-defined options.

### 4.5 Delta pagination

`/rag/pages`, `/rag/updates`, `/rag/deleted`,
`/rag/attachments/updates`, `/rag/attachments/deleted`, and
`/rag/dictionary/terms`, `/rag/dictionary/updates`,
`/rag/dictionary/deleted`, and `/rag/scope/blocked` accept:

- `limit` (optional, `1..1000`);
- `cursor` (optional opaque string returned as `nextCursor`).

Change feeds retain `items` and `maxUpdatedAtMs|maxDeletedAtMs`; every
paginated response includes `hasMore` and `nextCursor`. Opaque cursor v2 binds
the feed kind, workspace, space, current scope fingerprint, original watermark,
a database-derived snapshot upper bound, and the last `(timestamp, id)` keyset
position. Every page stays inside that fixed snapshot. A cursor from another
feed or scope, a cursor replayed with a different `updatedSince`/`deletedSince`,
and every legacy v1 cursor return `400 Invalid RAG feed cursor`. Consumers must
not parse or synthesize cursors.

## 5. RAG endpoints

### 5.0 `GET /api/rag/scope`

Returns the current effective indexing scope:

```json
{
  "schemaVersion": 2,
  "projectionVersion": 1,
  "workspaceId": "<workspace-uuid>",
  "spaceId": "<space-uuid>",
  "syncTarget": {
    "adapter": "open-webui-knowledge-v1",
    "baseUrl": "https://open-webui.example",
    "knowledgeId": "<knowledge-id>"
  },
  "fingerprint": "<sha256>",
  "excludedPageIds": ["<page-uuid>"]
}
```

`workspaceId` and `spaceId` are resolved from the authenticated RAG key. An
external indexer should use these values as the authoritative indexing scope
instead of duplicating them in deployment configuration.

`syncTarget` contains the non-secret Open WebUI destination configured for the
space in AI settings, or `null` when the space does not use the
`open-webui-knowledge-v1` retrieval adapter. Credentials are never returned.

The fingerprint is based on the workspace and space identifiers, the effective
content policy, the sorted set of pages currently readable by the key creator,
`projectionVersion`, the enabled document-field mask, and the dictionary
switch. A key-scope, ACL, group-membership, space-role, exclusion, projection,
document-field, or dictionary-switch change therefore invalidates an external
sync. The legacy `excludedPageIds` field remains for one compatibility
transition.

### 5.0.1 `GET /api/rag/scope/blocked`

Returns a paginated opaque list of `{ "pageId": "<uuid>" }` records for live
pages that the key creator cannot currently read or that the AI content policy
excludes. No title, slug, hierarchy, or content metadata is returned.

### 5.1 `GET /api/rag/pages`

Full list of active `page|database` in API key scope.

Query:

- `includeContent` (optional, default `false`)
  - truthy: `1|true|yes|on`
  - falsy: `0|false|no|off`
- optional `limit` and opaque `cursor` as described above

`contentMarkdown` and `descriptionMarkdown` are returned only when
`includeContent=true`. Page/database entries also expose structured
`customFields`, `projectionUpdatedAt`, and canonical `knowledgeMarkdown` when
content is requested.

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
- `users.updatedAt` for assignees and stakeholders actually referenced by the
  projected page, database container, or row

`updatedAt` and `updatedAtMs` are the time of the last RAG-relevant change, not
only the base entity write. A property rename therefore replays the database
and every row. Detail responses expose the same derived time as
`projectionUpdatedAt`.

### 5.3 `GET /api/rag/deleted`

Deleted delta (tombstones) for `page|database|databaseRow`.

Query:

- `deletedSince` (required): Unix timestamp in milliseconds (`>= 0`)

Sort order:

- `deletedAt ASC`
- tie-breaker: `id ASC`

Tombstones contain only the stable identifiers required to delete a remote
mapping and the deletion timestamp. Deprecated `slugId`, `title`, and
`parentPageId` fields are returned as `null`; attachment tombstones likewise
return deprecated `pageId` and `spaceId` as `null`.

### 5.4 `GET /api/rag/attachments/updates`

Live attachment delta scoped to the API key's space and the creator's current
read access to the owning page.

Query:

- `updatedSince` (required): Unix timestamp in milliseconds (`>= 0`)
- optional `limit` and `cursor` as described above

Items include `fileId`, file metadata, owning `pageId`, `updatedAtMs`, and an
API-key-authenticated `downloadUrl`. At read time they also include the current
parent-page `customFields`. Changing a page field does not re-upload the binary.

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

Includes container-page `customFields`, metadata, named/type-bearing
properties, their select/status options, rows/cells, `projectionUpdatedAt`, and
composed `knowledgeMarkdown`.

### 5.8 `GET /api/rag/databases/:databaseIdOrPageSlug/rows`

Rows export (raw cell value and `propertyId`, property name/type, row Markdown,
row-page `customFields`, `projectionUpdatedAt`, and canonical
`knowledgeMarkdown`). Every database property is present even when no cell row
exists.

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

### 5.14 `GET /api/rag/dictionary/terms`

Paginated full list of active dictionary terms. The route returns an empty page
when the space dictionary switch is disabled. Each item contains the term UUID,
term, forms, definition, canonical `knowledgeMarkdown`, and timestamps.

### 5.15 `GET /api/rag/dictionary/terms/:termId`

Returns one active dictionary term by UUID. A disabled dictionary, a deleted
term, or a term outside the authenticated workspace/space returns `404`.

### 5.16 `GET /api/rag/dictionary/updates`

Independent at-least-once change feed. It accepts `updatedSince`, `limit`, and
an opaque cursor and returns `maxUpdatedAtMs` on the terminal page.

### 5.17 `GET /api/rag/dictionary/deleted`

Independent dictionary tombstone feed. It accepts `deletedSince`, `limit`, and
an opaque cursor. Tombstones remain available while the dictionary is disabled
so consumers can remove previously indexed sources.

## 6. API key management (to obtain RAG token)

These endpoints use user auth session/JWT (`owner|admin`) and are not part of `/rag/*`.

### 6.1 `POST /api/api-keys`

List API keys.

Body:

- `limit` (optional, default `20`, max `100`)
- `cursor` (optional)
- `beforeCursor` (optional)
- `query` (optional, name filter)
- `keyType` (optional, `rag|mcp`); use `rag` for this integration

The endpoint always requires workspace `owner|admin` and lists matching keys
across the workspace. The retired `adminView` field is ignored and must not be
used by new clients.

### 6.2 `POST /api/api-keys/create`

Create API key and return one-time `token`.

Body:

- `name` (required, max 255)
- `spaceId` (required, UUID)
- `keyType` (required by this integration: `rag`)
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

Query results never grant access by themselves. The AI backend computes the
allowed source set before the adapter call, resolves returned Docmost source
IDs, and re-checks their workspace, space, live-object state, exclusion policy,
and requesting-user ACL after the adapter returns and immediately before model
use. Dependencies are persisted before provider execution and rechecked during
streaming and before the final transaction. If access narrows mid-run, generation
fails with `source_access_changed`; partial content, reasoning, and citations are
cleared. History applies the same checks to deleted, archived, excluded, and
replaced sources.

The query adapter keeps a separate SSRF allowlist from both this inbound sync API
and the model provider. Its full timeout starts before DNS resolution, redirects
and URL credentials are rejected, the serialized request is capped at 1 MiB, and
the response is capped at 256 KiB. Individual malformed/non-UUID candidates are
discarded without losing valid siblings; duplicate source identities keep the
highest score. Timeout, oversized payload, `401`, `429`, `5xx`, or no readable
results degrades safely to document/file context and never invokes the model
inside the retrieval adapter.

The chat's external retrieval source types are `page`, `database_row`,
`attachment`, and `dictionary_term`. The request includes `dictionary_term`
only while `space.settings.dictionary.enabled` is true. A dictionary candidate
must use a term UUID as `sourceId` and `pageId: null`; this is an intentional
extension of the `http-json-v1` response shape, so strict external validators
must be updated. Core chat may separately resolve a whole database as explicit
conversation context, but that internal `database` type does not extend the
external query contract.

### 7.0.1 Built-in Open WebUI writer

The optional server-side RAG Sync module implements the Open WebUI writer. It is
separate from this public wire contract even though both reuse the same content
mapping rules. One Knowledge Base maps to one Docmost space. The module:

- reads source content through an internal system-scope exporter, while this
  public API retains API-key creator ACL behavior;
- uses the shared Redis with an isolated versioned namespace for checkpoints,
  source-to-file mappings, and distributed space locks;
- uploads a new Open WebUI file and waits for processing before replacing the
  mapping and deleting the previous file;
- reconstructs lost Redis mappings from `meta.data.docmost`, removes duplicate
  superseded files, and ignores foreign workspace/space metadata;
- supports page, database-row, dictionary-term, PDF, DOCX, TXT, and MD sources;
- logs only low-cardinality states, counters, reason codes, lag, and durations;
  stable binding, space, source, checkpoint, and fingerprint IDs are excluded;
- reads the internal policy scope before each cycle; on fingerprint change it
  restores mappings from Open WebUI metadata,
  purges inaccessible mappings, resets the live update checkpoints to `0`, and
  stores the new fingerprint only after a successful reindex cycle;
- deletes an existing attachment mapping when the file becomes too large or
  its extension is no longer allowed, while retaining mappings on transient
  remote/read errors for a later retry.
- refuses enable with `409 rag_sync_target_mismatch` unless the normalized
  writer origin and Knowledge ID match the configured Open WebUI retrieval
  target. A running binding performs the same check before remote writes and
  stops non-retryably on mismatch.
- renews the distributed binding lease and global slot during each cycle. Lease
  or slot loss aborts the current HTTP request; abort checks run before and after
  upload, delete, list, and processing polls. No later external request or
  unfenced mapping/checkpoint write is allowed. A remote side effect that won
  the race with cancellation is adopted or removed by metadata reconciliation.

Set `RAG_SYNC_ENABLED=true` to enable the deployment and list every exact writer
origin in `RAG_SYNC_ALLOWED_ORIGINS`. The remaining deployment env contains only
the Redis prefix, intervals, limits, and timeouts. Each target and encrypted
writer key is configured in the corresponding space UI. There is no Docmost RAG
key, per-space env variable, JSON file, standalone process, or Compose profile
for the built-in writer. A Knowledge Base must be created in advance; Docmost
never creates or deletes the Knowledge Base itself.

The built-in index contains every page allowed by the space AI content policy,
not only pages readable by the administrator who configured the binding. Direct
user access to that Open WebUI Knowledge Base can therefore expose content beyond
the user's Docmost ACL. Keep Knowledge Base access restricted and keep the
query-time credential separate from the writer key.

External indexers may continue to implement the initial and incremental flows
below through `/api/rag/*`; none of their routes or DTOs are changed by the
built-in writer.

### 7.1 Initial sync

1. Create API key scoped to the target `spaceId`.
2. Call `GET /api/rag/scope`, use its `workspaceId` and `spaceId` as the
   authoritative scope, and store its fingerprint.
3. Page through `GET /api/rag/pages?includeContent=true&limit=500`, retaining
   the original request watermark (where applicable) and following `nextCursor`
   until `hasMore=false`.
4. For each document:
   - `type=page` -> index as page
   - `type=database` -> call `GET /api/rag/databases/:databaseIdOrPageSlug`
5. For pages with attachments:
   - call `GET /api/rag/pages/:id/attachments`
   - download binaries through `downloadUrl` or `/api/rag/attachments/:fileId/:fileName`
6. If the dictionary is enabled, page through
   `GET /api/rag/dictionary/terms?limit=500` and upsert one source per term.
7. Initialize checkpoints:
   - `updatedSince = 0`
   - `deletedSince = 0`
   - attachment `updatedSince = 0`
   - attachment `deletedSince = 0`
   - dictionary `updatedSince = 0`
   - dictionary `deletedSince = 0`

### 7.2 Incremental sync loop

1. Read `/api/rag/scope`. If the fingerprint changed, purge mappings whose
   backing `pageId` is excluded and reset document, attachment, and dictionary
   update checkpoints to `0`. Reconcile `dictionary_term` mappings separately
   because their `pageId` is `null`.
2. `GET /api/rag/updates?updatedSince=<lastUpdatedCheckpoint>&limit=500`
3. Upsert updated documents:
   - `type=page` -> `GET /api/rag/pages/:id?includeContent=true`
   - `type=database` -> `GET /api/rag/databases/:databaseIdOrPageSlug`
4. Follow `nextCursor` while `hasMore=true`, always repeating the original
   `updatedSince`/`deletedSince` value for that snapshot
5. Process `/api/rag/attachments/updates` using its own checkpoint
6. Process `/api/rag/dictionary/updates` with its own checkpoint when enabled
7. Process `/api/rag/deleted`, `/api/rag/attachments/deleted`, and
   `/api/rag/dictionary/deleted`
8. Delete/deactivate tombstoned records in the index
9. Update each checkpoint only after the complete snapshot reaches
   `hasMore=false`:
   - `lastUpdatedCheckpoint = maxUpdatedAtMs`
   - `lastDeletedCheckpoint = maxDeletedAtMs`
   - attachment update/delete checkpoints advance independently
   - dictionary update/delete checkpoints advance independently
10. Persist the new scope fingerprint only after the complete cycle succeeds.

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
- RAG and MCP request concurrency leases are renewed while the HTTP response is
  active, so exports longer than the ten-minute safety TTL retain their slot. If
  renewal can no longer confirm the lease, a response that has not started fails
  with `503 api_key_limit_lease_lost`; an active stream is closed. Retry only
  idempotent reads after Redis admission is healthy.
- For queue, checkpoint, mapping, lock-loss, and key-rotation recovery, follow
  the canonical [Recovery and diagnostics](./AI_ASSISTANT_AND_RAG.md#recovery-and-diagnostics)
  procedure.
