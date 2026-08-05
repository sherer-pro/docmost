# API Route Deprecation Matrix

This matrix tracks compatibility aliases that remain because persisted page
content can still reference them. Deprecated aliases keep their response
payloads but emit the standard `Deprecation` and `Sunset` headers through
`@DeprecatedRoute`.

Default sunset for legacy API aliases: `Fri, 01 Jan 2027 00:00:00 GMT`.

## Deprecated File Aliases

| Alias                                     | Canonical route                                       | Removal condition                                       |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/files/:fileId/:fileName`        | `GET /api/attachments/files/:fileId/:fileName`        | Persisted content no longer references the legacy path. |
| `GET /api/files/public/:fileId/:fileName` | `GET /api/attachments/files/public/:fileId/:fileName` | Persisted content no longer references the legacy path. |

## Non-Deprecated Dual-Method Routes

The following method pairs are not compatibility aliases and must not receive
`@DeprecatedRoute` without a separate API design decision:

- resource collection CRUD, for example `GET /api/databases` and
  `POST /api/databases`;
- resource item CRUD, for example `GET/PATCH/DELETE /api/databases/:databaseId`
  and `GET/PATCH/DELETE /api/spaces/:spaceId`;
- collection create/list pairs such as `GET /api/dictionary-terms` and
  `POST /api/dictionary-terms`;
- command routes under `/actions/*`;
- import, export, upload, transclusion lookup, search, MFA, auth, and RAG
  routes whose request bodies or semantics are intentionally POST-based.
