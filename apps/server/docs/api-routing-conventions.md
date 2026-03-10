# API Routing Conventions

This document defines routing style for backend API endpoints in `apps/server`.

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

- Legacy alias endpoints for space/import/export RPC routes were removed.
- Only canonical action/resource routes are part of active API surface.

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
