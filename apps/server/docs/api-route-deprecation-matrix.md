# API Route Deprecation Matrix

This matrix tracks compatibility aliases retained during the API route
normalization work. Deprecated aliases keep their response payloads but emit the
standard `Deprecation` and `Sunset` headers through `@DeprecatedRoute`.

Default sunset for legacy API aliases: `Fri, 01 Jan 2027 00:00:00 GMT`.

## Deprecated Read-Like POST Aliases

| Alias                                  | Canonical route                       | Removal condition                                       |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `POST /api/auth/collab-token`          | `GET /api/auth/collab-token`          | First-party clients and supported integrations use GET. |
| `POST /api/comments`                   | `GET /api/comments`                   | First-party clients and supported integrations use GET. |
| `POST /api/comments/info`              | `GET /api/comments/info`              | First-party clients and supported integrations use GET. |
| `POST /api/favorites`                  | `GET /api/favorites`                  | First-party clients and supported integrations use GET. |
| `POST /api/favorites/ids`              | `GET /api/favorites/ids`              | First-party clients and supported integrations use GET. |
| `POST /api/groups`                     | `GET /api/groups`                     | First-party clients and supported integrations use GET. |
| `POST /api/groups/info`                | `GET /api/groups/info`                | First-party clients and supported integrations use GET. |
| `POST /api/groups/members`             | `GET /api/groups/members`             | First-party clients and supported integrations use GET. |
| `POST /api/notifications`              | `GET /api/notifications`              | First-party clients and supported integrations use GET. |
| `POST /api/notifications/unread-count` | `GET /api/notifications/unread-count` | First-party clients and supported integrations use GET. |
| `POST /api/pages/backlinks`            | `GET /api/pages/backlinks`            | First-party clients and supported integrations use GET. |
| `POST /api/pages/backlinks-count`      | `GET /api/pages/backlinks-count`      | First-party clients and supported integrations use GET. |
| `POST /api/pages/breadcrumbs`          | `GET /api/pages/breadcrumbs`          | First-party clients and supported integrations use GET. |
| `POST /api/pages/history`              | `GET /api/pages/history`              | First-party clients and supported integrations use GET. |
| `POST /api/pages/history/info`         | `GET /api/pages/history/info`         | First-party clients and supported integrations use GET. |
| `POST /api/pages/info`                 | `GET /api/pages/info`                 | First-party clients and supported integrations use GET. |
| `POST /api/pages/recent`               | `GET /api/pages/recent`               | First-party clients and supported integrations use GET. |
| `POST /api/pages/sidebar-pages`        | `GET /api/pages/sidebar-pages`        | First-party clients and supported integrations use GET. |
| `POST /api/pages/trash`                | `GET /api/pages/trash`                | First-party clients and supported integrations use GET. |
| `POST /api/search/suggest`             | `GET /api/search/suggest`             | First-party clients and supported integrations use GET. |
| `POST /api/sessions`                   | `GET /api/sessions`                   | First-party clients and supported integrations use GET. |
| `POST /api/shares`                     | `GET /api/shares`                     | First-party clients and supported integrations use GET. |
| `POST /api/shares/for-page`            | `GET /api/shares/for-page`            | First-party clients and supported integrations use GET. |
| `POST /api/shares/info`                | `GET /api/shares/info`                | First-party clients and supported integrations use GET. |
| `POST /api/shares/page-info`           | `GET /api/shares/page-info`           | First-party clients and supported integrations use GET. |
| `POST /api/shares/tree`                | `GET /api/shares/tree`                | First-party clients and supported integrations use GET. |
| `POST /api/spaces/member-users`        | `GET /api/spaces/member-users`        | First-party clients and supported integrations use GET. |
| `POST /api/spaces/members`             | `GET /api/spaces/members`             | First-party clients and supported integrations use GET. |
| `POST /api/users/me`                   | `GET /api/users/me`                   | First-party clients and supported integrations use GET. |
| `POST /api/workspace/info`             | `GET /api/workspace/info`             | First-party clients and supported integrations use GET. |
| `POST /api/workspace/invites`          | `GET /api/workspace/invites`          | First-party clients and supported integrations use GET. |
| `POST /api/workspace/invites/info`     | `GET /api/workspace/invites/info`     | First-party clients and supported integrations use GET. |
| `POST /api/workspace/members`          | `GET /api/workspace/members`          | First-party clients and supported integrations use GET. |
| `POST /api/workspace/members/count`    | `GET /api/workspace/members/count`    | First-party clients and supported integrations use GET. |
| `POST /api/workspace/public`           | `GET /api/workspace/public`           | First-party clients and supported integrations use GET. |

## Deprecated Command Aliases

| Alias                                     | Canonical route                                       | Removal condition                                       |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `POST /api/attachments/remove-icon`       | `POST /api/attachments/actions/remove-icon`           | Supported clients use the action route.                 |
| `POST /api/attachments/upload-image`      | `POST /api/attachments/actions/upload-image`          | Supported clients use the action route.                 |
| `POST /api/comments/create`               | `POST /api/comments/actions/create`                   | Supported clients use the action route.                 |
| `POST /api/comments/delete`               | `POST /api/comments/actions/delete`                   | Supported clients use the action route.                 |
| `POST /api/comments/update`               | `POST /api/comments/actions/update`                   | Supported clients use the action route.                 |
| `POST /api/files/upload`                  | `POST /api/attachments/actions/upload-file`           | Supported clients use the attachment action route.      |
| `GET /api/files/:fileId/:fileName`        | `GET /api/attachments/files/:fileId/:fileName`        | Persisted content no longer references the legacy path. |
| `GET /api/files/public/:fileId/:fileName` | `GET /api/attachments/files/public/:fileId/:fileName` | Persisted content no longer references the legacy path. |
| `POST /api/groups/create`                 | `POST /api/groups/actions/create`                     | Supported clients use the action route.                 |
| `POST /api/groups/delete`                 | `POST /api/groups/actions/delete`                     | Supported clients use the action route.                 |
| `POST /api/groups/update`                 | `POST /api/groups/actions/update`                     | Supported clients use the action route.                 |
| `POST /api/pages/create`                  | `POST /api/pages`                                     | Supported clients use the resource route.               |
| `POST /api/pages/delete`                  | `POST /api/pages/actions/delete`                      | Supported clients use the action route.                 |
| `POST /api/pages/update`                  | `POST /api/pages/actions/update`                      | Supported clients use the action route.                 |
| `POST /api/shares/create`                 | `POST /api/shares/actions/create`                     | Supported clients use the action route.                 |
| `POST /api/shares/delete`                 | `POST /api/shares/actions/delete`                     | Supported clients use the action route.                 |
| `POST /api/shares/update`                 | `POST /api/shares/actions/update`                     | Supported clients use the action route.                 |

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
