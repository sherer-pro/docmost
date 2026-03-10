# RAG API (Docmost Core)

Документ описывает фактический контракт RAG API в текущем коде `docmost` (core edition), включая авторизацию через API key, семантику данных, способы интеграции и примеры запросов.

## 1. Базовые принципы

- Базовый префикс backend API: `/api`
- Все RAG-методы: `/api/rag/*`
- Все RAG-методы read-only: `GET`
- Все RAG-методы возвращают **raw JSON** (без стандартной envelope-обертки `{ data, success, status }`)
- Экспорт-методы возвращают ZIP stream (`application/zip`)
- Пагинация в RAG-методах отсутствует (all-at-once)

## 2. Авторизация и scope

### 2.1. Тип токена

Для `/api/rag/*` принимается **только API key JWT** в заголовке:

```http
Authorization: Bearer <token>
```

User JWT (обычный auth token) для `/api/rag/*` отклоняется.

### 2.2. Где работает API key

- API key работает только на маршрутах `/api/rag/*`
- Попытка использовать API key вне `/api/rag/*` => `401 Unauthorized`

### 2.3. Scope

API key JWT содержит:

- `workspaceId`
- `spaceId`
- `apiKeyId`
- `sub` (creator user id)

Данные на `/api/rag/*` всегда отдаются только в рамках `spaceId` из токена.

- Если объект существует, но вне `spaceId` токена => `403 Forbidden`
- Если токен невалиден/просрочен/отозван/не найден => `401 Unauthorized`

### 2.4. Workspace host binding

В cloud режиме workspace резолвится по хосту (subdomain), и `workspaceId` из токена должен совпадать с workspace текущего host. При mismatch запрос отклоняется (`401`).

### 2.5. Как получить API key (management API)

RAG API использует ключи из backend API key management:

- `POST /api/api-keys` — список ключей
- `POST /api/api-keys/create` — создать ключ
- `POST /api/api-keys/update` — переименовать
- `POST /api/api-keys/revoke` — отозвать

Ограничение: только workspace `owner|admin`.

`spaceId` обязателен при создании ключа.

## 3. Формат ошибок

Типовые статусы:

- `400 Bad Request` — ошибка валидации DTO/query/params
- `401 Unauthorized` — нет токена, токен невалиден, user JWT на `/rag/*`, API key вне `/rag/*`
- `403 Forbidden` — объект вне `space` scope токена
- `404 Not Found` — объект не найден (или soft-deleted и недоступен)

## 4. Семантика данных

### 4.1. Типы документов

В RAG-контракте используются:

- `page`
- `database`
- `databaseRow` (в page info и deleted tombstones)

### 4.2. Full list (`/rag/pages`)

Возвращаются только активные элементы `page|database`:

- обычные страницы
- страницы-базы данных (`database`)
- строки баз (`databaseRow`) в этот список не входят

### 4.3. Delta (`/rag/updates`, `/rag/deleted`)

Гарантия: **at-least-once**.

- дубликаты возможны
- пропуски недопустимы при корректном использовании checkpoint
- `updatedSince` / `deletedSince` используются **инклюзивно** (`>=`)

Рекомендуется:

- хранить `maxUpdatedAtMs` и `maxDeletedAtMs`
- на следующем запросе передавать эти значения обратно
- выполнять идемпотентный upsert на стороне потребителя

### 4.4. Custom fields

В `page`/`database`/`row.page` поле `customFields` формируется из `space.settings.documentFields`.

Правила:

- если поле отключено в space, ключ отсутствует
- если включено, ключ всегда присутствует:
  - `status`: `string | null`
  - `assigneeId`: `string | null`
  - `stakeholderIds`: `string[]` (пустой массив допустим)

## 5. Эндпоинты RAG

---

## 5.1. `GET /api/rag/pages`

Полный список активных `page|database` в scope space.

### Query

- `includeContent` (optional, default `false`)
  - true values: `1|true|yes|on`
  - false values: `0|false|no|off`

### Response

```json
{
  "items": [
    {
      "type": "page",
      "id": "uuid",
      "slugId": "string",
      "title": "string|null",
      "icon": "string|null",
      "parentPageId": "uuid|null",
      "position": "string|null",
      "customFields": {
        "status": "in-progress",
        "assigneeId": null,
        "stakeholderIds": []
      },
      "settings": {},
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "contentMarkdown": "string|null"
    },
    {
      "type": "database",
      "id": "database page uuid",
      "databaseId": "database uuid",
      "slugId": "string",
      "title": "database name",
      "icon": "string|null",
      "parentPageId": "uuid|null",
      "position": "string|null",
      "customFields": {},
      "settings": {},
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "descriptionMarkdown": "string",
      "contentMarkdown": "string|null"
    }
  ]
}
```

`contentMarkdown` и `descriptionMarkdown` возвращаются только при `includeContent=true`.

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/pages?includeContent=true"
```

---

## 5.2. `GET /api/rag/updates`

Дельта обновлений для `page|database`.

### Query

- `updatedSince` (required): unix timestamp in milliseconds, integer `>= 0`

### Response

```json
{
  "items": [
    {
      "type": "page",
      "id": "uuid",
      "slugId": "string",
      "title": "string|null",
      "updatedAt": "ISO datetime",
      "updatedAtMs": 1730800000000
    },
    {
      "type": "database",
      "id": "database page uuid",
      "databaseId": "database uuid",
      "slugId": "string",
      "title": "string",
      "updatedAt": "ISO datetime",
      "updatedAtMs": 1730800001000
    }
  ],
  "maxUpdatedAtMs": 1730800001000
}
```

Сортировка: `updatedAt ASC`, tie-breaker `id ASC`.

### Важно по database delta

Database считается обновленной, если изменилось любое из:

- `databases.updatedAt`
- page-контейнер базы (`pages.updatedAt`)
- database properties (`database_properties.updatedAt`)
- database rows (`database_rows.updatedAt`)
- database cells (`database_cells.updatedAt`)
- row pages (`pages.updatedAt` для страниц-строк)

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/updates?updatedSince=0"
```

---

## 5.3. `GET /api/rag/deleted`

Дельта удалений (tombstones) для `page|database|databaseRow`.

### Query

- `deletedSince` (required): unix timestamp in milliseconds, integer `>= 0`

### Response

```json
{
  "items": [
    {
      "type": "page",
      "id": "uuid",
      "slugId": "string",
      "title": "string|null",
      "parentPageId": "uuid|null",
      "deletedAt": "ISO datetime",
      "deletedAtMs": 1730800100000
    },
    {
      "type": "database",
      "id": "database page uuid or databaseId fallback",
      "databaseId": "database uuid",
      "slugId": "string|null",
      "title": "string",
      "parentPageId": "uuid|null",
      "deletedAt": "ISO datetime",
      "deletedAtMs": 1730800200000
    },
    {
      "type": "databaseRow",
      "id": "row page uuid",
      "rowId": "databaseRow uuid",
      "databaseId": "database uuid",
      "slugId": "string|null",
      "title": "string|null",
      "parentPageId": "uuid|null",
      "deletedAt": "ISO datetime",
      "deletedAtMs": 1730800300000
    }
  ],
  "maxDeletedAtMs": 1730800300000
}
```

Сортировка: `deletedAt ASC`, tie-breaker `id ASC`.

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/deleted?deletedSince=0"
```

---

## 5.4. `GET /api/rag/pages/:pageIdOrSlug`

Детальная информация по странице/документу.

### Params

- `pageIdOrSlug`: UUID страницы или `slugId`

### Query

- `includeContent` (optional, default `true`)

### Response

```json
{
  "id": "uuid",
  "slugId": "string",
  "type": "page|database|databaseRow",
  "title": "string|null",
  "icon": "string|null",
  "parentPageId": "uuid|null",
  "position": "string|null",
  "spaceId": "uuid",
  "settings": {},
  "customFields": {},
  "databaseId": "uuid|null",
  "createdAt": "ISO datetime",
  "updatedAt": "ISO datetime",
  "contentMarkdown": "string|null"
}
```

`contentMarkdown` возвращается только при `includeContent=true`.

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/pages/<pageIdOrSlug>?includeContent=true"
```

---

## 5.5. `GET /api/rag/databases/:databaseIdOrPageSlug`

Полная структурированная выгрузка базы данных.

### Params

- `databaseIdOrPageSlug`:
  - UUID database
  - или UUID/slug page-контейнера базы

### Response

```json
{
  "id": "database page uuid",
  "slugId": "string",
  "databaseId": "database uuid",
  "type": "database",
  "name": "string",
  "title": "string",
  "icon": "string|null",
  "parentPageId": "uuid|null",
  "position": "string|null",
  "spaceId": "uuid",
  "settings": {},
  "customFields": {},
  "descriptionMarkdown": "string",
  "pageContentMarkdown": "string|null",
  "properties": [
    {
      "id": "uuid",
      "name": "string",
      "type": "string",
      "position": 0,
      "settings": {},
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime"
    }
  ],
  "rows": [
    {
      "id": "databaseRow uuid",
      "databaseId": "database uuid",
      "pageId": "row page uuid",
      "pageSlugId": "string",
      "pageTitle": "string|null",
      "archivedAt": null,
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "page": {
        "id": "uuid",
        "slugId": "string",
        "title": "string|null",
        "icon": "string|null",
        "parentPageId": "uuid|null",
        "position": "string|null",
        "customFields": {}
      },
      "cells": [
        {
          "id": "uuid",
          "databaseId": "uuid",
          "workspaceId": "uuid",
          "pageId": "uuid",
          "propertyId": "uuid",
          "value": {},
          "attachmentId": "uuid|null",
          "createdById": "uuid|null",
          "updatedById": "uuid|null",
          "createdAt": "ISO datetime",
          "updatedAt": "ISO datetime",
          "deletedAt": null
        }
      ],
      "rowMarkdown": "string|null"
    }
  ],
  "knowledgeMarkdown": "## Description ... ## Table ... ## Rows ...",
  "createdAt": "ISO datetime",
  "updatedAt": "ISO datetime"
}
```

`knowledgeMarkdown` собирается как: `описание -> markdown-таблица -> markdown rows`.

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/databases/<databaseIdOrPageSlug>"
```

---

## 5.6. `GET /api/rag/databases/:databaseIdOrPageSlug/rows`

Получение rows базы (raw cells + row markdown).

### Query

- `pageIds` (optional):
  - CSV: `?pageIds=id1,id2`
  - или repeated form: `?pageIds=id1&pageIds=id2`
  - если не задано: возвращаются все rows

### Response

```json
{
  "databaseId": "uuid",
  "items": [
    {
      "id": "databaseRow uuid",
      "databaseId": "uuid",
      "pageId": "uuid",
      "pageSlugId": "string",
      "pageTitle": "string|null",
      "archivedAt": null,
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "page": {},
      "cells": [],
      "rowMarkdown": "string|null"
    }
  ]
}
```

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/databases/<db>/rows?pageIds=<rowPageId1>,<rowPageId2>"
```

---

## 5.7. `GET /api/rag/pages/:pageIdOrSlug/attachments`

Список attachment-метаданных страницы + готовая ссылка скачивания.

### Response

```json
{
  "pageId": "uuid",
  "items": [
    {
      "id": "uuid",
      "fileId": "uuid",
      "fileName": "example.pdf",
      "fileExt": ".pdf",
      "mimeType": "application/pdf",
      "fileSize": 12345,
      "pageId": "uuid",
      "spaceId": "uuid",
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "downloadUrl": "/api/rag/attachments/<fileId>/<urlencoded-fileName>"
    }
  ]
}
```

### Example

```bash
curl -sS \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  "https://<host>/api/rag/pages/<pageIdOrSlug>/attachments"
```

---

## 5.8. `GET /api/rag/attachments/:fileId/:fileName`

Скачивание attachment stream.

### Params

- `fileId` (UUID, обязателен)
- `fileName` (маршрутный сегмент; для чтения файла используется `fileId`)

### Response

- Body: binary stream
- Headers:
  - `Content-Type` = mime type файла (или `application/octet-stream`)
  - `Content-Disposition` = attachment
  - `Content-Length` (если известен)
  - `Cache-Control: private, max-age=3600`

### Example

```bash
curl -L \
  -H "Authorization: Bearer $DOCMOST_RAG_TOKEN" \
  -o attachment.bin \
  "https://<host>/api/rag/attachments/<fileId>/<fileName>"
```

---

## 5.9. `GET /api/rag/pages/:pageIdOrSlug/comments`

Комментарии страницы (включая resolved).

### Response

```json
{
  "pageId": "uuid",
  "items": [
    {
      "id": "uuid",
      "pageId": "uuid",
      "content": {},
      "selection": "string|null",
      "parentCommentId": "uuid|null",
      "creatorId": "uuid|null",
      "resolvedById": "uuid|null",
      "resolvedAt": "ISO datetime|null",
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "deletedAt": null,
      "creator": {
        "id": "uuid",
        "name": "string|null",
        "avatarUrl": "string|null"
      },
      "resolvedBy": {
        "id": "uuid",
        "name": "string|null",
        "avatarUrl": "string|null"
      }
    }
  ]
}
```

`content` хранится как JSON (редакторный формат), не markdown.

---

## 5.10. `GET /api/rag/pages/:pageIdOrSlug/export`

Экспорт одной страницы (и, опционально, children) в ZIP.

### Query

- `format` (optional): `markdown|html`, default `markdown`
- `includeAttachments` (optional): bool, default `true`
- `includeChildren` (optional): bool, default `true`

### Response

- `200 application/zip`
- `Content-Disposition: attachment; filename="<page-title>.zip"`

---

## 5.11. `GET /api/rag/space/export`

Экспорт всего `space` из токена API key.

### Query

- `format` (optional): `markdown|html`, default `markdown`
- `includeAttachments` (optional): bool, default `true`

### Response

- `200 application/zip`
- `Content-Disposition` содержит имя файла space-экспорта

## 6. API keys management (для получения RAG токена)

Важно: эти методы используют обычную auth-сессию/JWT пользователя (`owner|admin`) и **не** являются частью `/rag/*`.

---

## 6.1. `POST /api/api-keys`

Список API keys workspace.

### Body

- `limit` (optional, default `20`, max `100`)
- `cursor` (optional)
- `beforeCursor` (optional)
- `query` (optional, фильтр по `name`)
- `adminView` (optional bool):
  - `true` => все ключи workspace
  - `false/omit` => только ключи текущего пользователя

### Response (standard envelope)

```json
{
  "success": true,
  "status": 200,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "string",
        "creatorId": "uuid",
        "workspaceId": "uuid",
        "spaceId": "uuid",
        "expiresAt": "ISO datetime|null",
        "lastUsedAt": "ISO datetime|null",
        "createdAt": "ISO datetime",
        "updatedAt": "ISO datetime",
        "deletedAt": null,
        "creator": {
          "id": "uuid",
          "name": "string|null",
          "avatarUrl": "string|null"
        },
        "space": {
          "id": "uuid",
          "name": "string|null",
          "slug": "string"
        }
      }
    ],
    "meta": {
      "hasNextPage": false,
      "hasPrevPage": false,
      "nextCursor": null,
      "prevCursor": null
    }
  }
}
```

---

## 6.2. `POST /api/api-keys/create`

Создание API key + возврат `token` (показывается один раз).

### Body

- `name` (required, max 255)
- `spaceId` (required, UUID)
- `expiresAt` (optional ISO datetime)

### Response

```json
{
  "success": true,
  "status": 200,
  "data": {
    "id": "uuid",
    "name": "RAG ingest key",
    "spaceId": "uuid",
    "...": "...",
    "token": "<JWT API key>"
  }
}
```

Если `expiresAt` не задан:

- запись в БД не имеет `expiresAt`
- JWT подписывается с очень длинным TTL
- фактически ключ считается `No expiration`

---

## 6.3. `POST /api/api-keys/update`

Переименование ключа.

### Body

- `apiKeyId` (required UUID)
- `name` (required)

---

## 6.4. `POST /api/api-keys/revoke`

Отзыв ключа (soft delete).

### Body

- `apiKeyId` (required UUID)

## 7. Рекомендованный алгоритм интеграции RAG

### 7.1. Первичная загрузка

1. Создать API key с нужным `spaceId`.
2. `GET /api/rag/pages?includeContent=true`
3. Для каждого документа:
   - если `type=page` => индексировать как page document
   - если `type=database`:
     - `GET /api/rag/databases/:databaseIdOrPageSlug`
     - при необходимости отдельно `GET /api/rag/databases/:.../rows`
4. Для pages с файлами:
   - `GET /api/rag/pages/:id/attachments`
   - скачать бинарники через `downloadUrl` или `/api/rag/attachments/:fileId/:fileName`
5. Инициализировать checkpoint:
   - `updatedSince = 0`
   - `deletedSince = 0`

### 7.2. Инкрементальный цикл

1. `GET /api/rag/updates?updatedSince=<lastUpdatedCheckpoint>`
2. Upsert документов из `items`
   - `type=page` => `GET /api/rag/pages/:id?includeContent=true`
   - `type=database` => `GET /api/rag/databases/:databaseIdOrPageSlug`
3. `GET /api/rag/deleted?deletedSince=<lastDeletedCheckpoint>`
4. Удалить/деактивировать в индексе по tombstones.
5. Обновить checkpoints:
   - `lastUpdatedCheckpoint = maxUpdatedAtMs`
   - `lastDeletedCheckpoint = maxDeletedAtMs`

### 7.3. Идемпотентность (обязательно)

Из-за at-least-once возможны дубли. На стороне потребителя:

- upsert по стабильному ключу (`id`/`databaseId`/`rowId`)
- удаление делать идемпотентным
- не полагаться на strict exactly-once

## 8. Практические замечания

- На `/api/rag/*` не требуются CSRF токены (все методы `GET`).
- Для больших объемов данных рекомендуется включать транспортное сжатие (gzip/br) на reverse proxy или уровне сервера.
- `fileName` в `/rag/attachments/:fileId/:fileName` участвует в URL, но источник данных определяется по `fileId`.
- Для безопасности держите отдельный API key на каждый интеграционный клиент и отдельный key на каждый `space`.

