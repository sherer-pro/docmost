# API routing conventions

## Цель

Этот документ фиксирует единые правила роутинга для backend API и служит планом миграции со старых RPC-like маршрутов на ресурсный стиль.

## Базовая policy

### 1) CRUD endpoints

Используем resource-oriented маршруты:

- коллекции: `/pages`, `/spaces`, `/users`;
- элементы: `/pages/:id`, `/spaces/:id`, `/users/:id`;
- вложенные ресурсы: `/spaces/:spaceId/pages`.

### 2) Командные действия

Команды (операции, которые не являются классическим CRUD) выносятся в namespace `actions`:

- на уровне ресурса: `/pages/actions/export`;
- на уровне элемента: `/pages/:id/actions/archive`;
- для технических/системных действий допускается отдельный префикс `/actions/*`.

### 3) Вычислительные / сервисные операции

Операции, возвращающие вычисления/агрегации/поиск, но не изменяющие ресурс напрямую, оформляются как специализированные read-endpoints с явным доменным namespace:

- `/search`;
- `/version`;
- `/health`.

## Инвентаризация контроллеров (`apps/server/src`)

Ниже группы endpoint-ов по текущему коду:

### CRUD

- `core/page/page.controller.ts` (`@Controller('pages')`)
- `core/space/space.controller.ts` (`@Controller('spaces')`)
- `core/user/user.controller.ts` (`@Controller('users')`)
- `core/group/group.controller.ts` (`@Controller('groups')`)
- `core/comment/comment.controller.ts` (`@Controller('comments')`)
- `core/notification/notification.controller.ts` (`@Controller('notifications')`)
- `core/share/share.controller.ts` (`@Controller('shares')`)

### Команды

- `integrations/import/import.controller.ts` (`@Controller('pages')`, `POST /pages/actions/import`, `POST /pages/actions/import-zip`)
- `integrations/export/export.controller.ts`
  - `@Controller('pages')`, `POST /pages/actions/export`
  - `@Controller('spaces')`, `POST /spaces/actions/export`
- `core/attachment/attachment.controller.ts` (`@Controller('attachments')`, команды под `/attachments/actions/*`)
- `core/auth/auth.controller.ts` (`@Controller('auth')`, доменные команды аутентификации)
- `core/mfa/mfa.controller.ts` (`@Controller('mfa')`, команды MFA)

### Вычислительные/сервисные операции

- `core/search/search.controller.ts` (`@Controller('search')`)
- `integrations/health/health.controller.ts` (`@Controller('health')`)
- `integrations/security/version.controller.ts` (`@Controller('version')`)
- `collaboration/server/collaboration.controller.ts` (`@Controller('collab')`)
- `core/push/push.controller.ts` (`@Controller('push')`)
- `integrations/security/robots.txt.controller.ts` (`@Controller('robots.txt')`)
- `app.controller.ts` (`@Controller('system')`)

## Миграционный план для RPC-маршрутов

### Фаза 0 — подготовка

1. Зафиксировать новые маршруты с `actions` в OpenAPI/внутренней документации.
2. Обновить frontend API-клиент на новые URL.
3. Добавить метрики использования старых alias-роутов.

### Фаза 1 — dual routing (backward compatibility)

Для каждого старого RPC endpoint оставить deprecated alias:

- `POST /pages/import` → **deprecated**, новый `POST /pages/actions/import`.
- `POST /pages/import-zip` → **deprecated**, новый `POST /pages/actions/import-zip`.
- `POST /pages/export` → **deprecated**, новый `POST /pages/actions/export`.
- `POST /spaces/export` → **deprecated**, новый `POST /spaces/actions/export`.

Требования к alias:

- одинаковая авторизация/валидация;
- в логах и метриках проставлять тег `deprecated_route=true`;
- добавлять заголовок ответа `Deprecation: true` и дату sunset в `Sunset`.

### Фаза 2 — soft deprecation

1. После обновления клиентов включить предупреждения в API changelog.
2. Сообщить sunset дату (например, +2 минорных релиза).
3. Контролировать долю трафика на alias до порога <5%.

### Фаза 3 — removal

1. Удалить deprecated aliases.
2. Обновить e2e и контрактные тесты, чтобы покрывали только `actions`-маршруты.
3. Пересобрать и опубликовать окончательную карту API без legacy RPC путей.


## Решение по database API (DOC-DB-MVP)

Принято решение **(B) — ввести REST-роуты для `databases`** и применять их последовательно ко всем подресурсам.

### Единый формат маршрутов для databases

- База данных (CRUD):
  - `POST /databases`
  - `GET /databases?spaceId=:spaceId`
  - `GET /databases/:databaseId`
  - `PATCH /databases/:databaseId`
  - `DELETE /databases/:databaseId`
- Свойства (properties CRUD):
  - `GET /databases/:databaseId/properties`
  - `POST /databases/:databaseId/properties`
  - `PATCH /databases/:databaseId/properties/:propertyId`
  - `DELETE /databases/:databaseId/properties/:propertyId`
- Строки (rows list/create):
  - `GET /databases/:databaseId/rows`
  - `POST /databases/:databaseId/rows`
- Ячейки (batch update):
  - `PATCH /databases/:databaseId/rows/:pageId/cells`
- Представления (views CRUD):
  - `GET /databases/:databaseId/views`
  - `POST /databases/:databaseId/views`
  - `PATCH /databases/:databaseId/views/:viewId`
  - `DELETE /databases/:databaseId/views/:viewId`

### Явно зафиксированное исключение

Для `cells` допускается командный semantically-операционный endpoint `PATCH /databases/:databaseId/rows/:pageId/cells` (batch update),
так как это массовая операция по набору ячеек, а не изменение одной конкретной сущности `cell`.
Это разрешённое исключение из строгого "one-resource-per-route" и соответствует правилу для командных действий над ресурсом.

## Практические правила для новых endpoint-ов

- Новый endpoint не должен добавляться в root namespace без префикса контроллера.
- Если действие не CRUD, сначала проверяем вариант `/resource/actions/*`.
- Для обратной совместимости используем alias не дольше переходного окна, затем удаляем.
