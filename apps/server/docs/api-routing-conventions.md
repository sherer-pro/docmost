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
  - `POST /databases/:databaseId/rows`
- Cells batch update:
  - `PATCH /databases/:databaseId/rows/:pageId/cells`
- Views:
  - `GET /databases/:databaseId/views`
  - `POST /databases/:databaseId/views`
  - `PATCH /databases/:databaseId/views/:viewId`
  - `DELETE /databases/:databaseId/views/:viewId`
