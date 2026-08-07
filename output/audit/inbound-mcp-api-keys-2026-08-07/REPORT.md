# Аудит входящего MCP и API-ключей RAG/MCP — 2026-08-07

Статус: аудит завершён, подтверждённые недостатки исправлены. Критерии
безопасности входящего MCP выполнены. В каталоге нет bearer-токенов, cookies,
CSRF-значений, содержимого документов, персональных данных или полных HTTP
payload.

## Итог

- `/mcp` остаётся корневым stateless Streamable HTTP endpoint и публикует семь
  read-only tools. Write tool не публикуется и прямой вызов отклоняется.
- MCP-ключ и RAG-ключ невзаимозаменяемы: обе cross-use проверки вернули `401`.
- Scope закреплён за одним `workspaceId` и `spaceId`; запись ключа, срок,
  soft-revoke, тип, creator, workspace, user, space и текущее membership
  проверяются при каждом вызове.
- База хранит только metadata. Подписанный JWT возвращается только из create и
  не может быть восстановлен из `api_keys`, list/update responses или обычного
  клиентского metadata-типа.
- Capability registry не допускает MCP exposure для tool с
  `writeClass != read_only`; runtime policy заново пересекает deployment,
  workspace, space и key capabilities.
- Redis admission control ограничивает rate и concurrency. Lease имеет случайный
  owner id, renew/release owner-fenced, renewals не перекрываются, потеря lease
  приводит к `503` до headers или уничтожению начатого stream.
- Канонические и compatibility UI routes имеют определённое поведение; выбранные
  удалённые API aliases возвращают `404`.

## Подтверждённые и исправленные недостатки

| ID | Severity | Недостаток | Исправление и доказательство |
| --- | --- | --- | --- |
| F-01 | Medium | `POST /api/api-keys/update` молча принимал over-posted `keyType`, `spaceId`, `creatorId`, `expiresAt`, потому что глобальный whitelist удалял неизвестные поля. Это не меняло scope, но создавало опасный false-success. | Поля объявлены в `UpdateApiKeyDto` как forbidden через `@Equals(undefined)`. Теперь каждый такой запрос получает локальный `400`; valid name/capabilities update сохранён. DTO regression test покрывает все четыре поля. |
| F-02 | Medium | Общий клиентский `IApiKey` разрешал optional `token`, а create mutation удерживала create response после передачи в modal. | Добавлен отдельный обязательный `ICreatedApiKey`; list/update metadata не имеют `token`. Create mutation сбрасывается сразу после передачи секрета в one-time modal, а modal state очищается при закрытии. Type test и client build прошли. |
| F-03 | Medium | После удаления public page-embed flow legacy attachment cookie с `pageEmbedSource` всё ещё шёл через несовместимый lookup и мог деградировать к обычной inherited-share ветке. | Legacy cookie теперь fail-closed получает `404 File not found`; fallback/lookup не выполняется. Профильный attachment test и server build прошли. |
| F-04 | Build/test blocker | Незавершённый page-template refactor оставил старые fixtures без `templateKind: null` и старое constructor wiring. | Обновлены только fixtures/spec wiring; четыре ранее падавших suites, 20 tests, проходят. |

Новых high/critical дефектов внутри входящего MCP/RAG key boundary не найдено.

## Commit map

| Commit | Назначение | Основные paths |
| --- | --- | --- |
| `4726ed4c` | space-scoped API keys и RAG API | `core/api-key`, `core/rag`, `20260310T120000-recreate-api-keys-space-scoped.ts` |
| `aa685338` | bounded agent и read-only inbound MCP | `core/mcp`, token/JWT payload, registry, `20260730T140000-ai-agent-mcp.ts` |
| `2d8c74ce` | admin-only management и key-type filtering | API-key service/DTO/repo/tests |
| `08ba5fe5` | разделение RAG/MCP в UI | client API-key pages/types, routes, locales, docs |
| `e493dd8b` | RAG/MCP traffic и data-flow hardening | traffic guard/service, RAG/MCP security tests |
| `762d58fc` | renewal и containment потери traffic lease | traffic guard/service/tests |
| `8a680af7`, `a6050822` | единая `/settings/keys` и redirects | `App.tsx`, settings page/sidebar, docs |
| `9452e245` | policy-controlled builtin capability registry | builtin policy service, registry, client capability UI, migration |
| `2dc67101` | fail-closed при потере lease | traffic guard/service и pre/post-header tests |
| `d7dd6dd7` | удаление старых API aliases | controllers, route inventory, deprecation matrix |

## Schema, token и display-once

`api_keys` содержит `id`, `name`, `creator_id`, `workspace_id`, `space_id`,
`key_type`, `allowed_capabilities`, `expires_at`, usage timestamps и
`deleted_at`. Foreign keys creator/workspace/space используют cascade delete.
Колонки с token, JWT, hash секрета или encrypted secret нет.

Create генерирует HS256 JWT с `apiKeyId`, creator `sub`, `workspaceId`,
`spaceId`, `keyType`. Явный `expiresAt` ограничивает JWT; отсутствие явного
срока всё равно даёт bounded 365-day JWT. `api_keys.expires_at` остаётся live
authority. Revoke записывает `deleted_at` и начинает давать `401` на следующем
вызове.

Repo projection перечисляет только metadata. List/update/reload не могут
вернуть token. На клиенте create response отделён типом, mutation state
сбрасывается после передачи в one-time modal, modal state очищается при
закрытии. Копирование проверено локально; clipboard после теста перезаписан
нейтральным значением. Одноразовые audit keys отозваны, в списке audit-prefixed
ключей не осталось.

## Authentication, scope и ACL

`validateApiKey` на каждом запросе заново загружает `api_keys` и сверяет:

1. live row, `deletedAt`, DB expiry;
2. JWT `apiKeyId/sub/workspaceId/spaceId/keyType` с DB metadata;
3. ожидаемый endpoint type (`rag` или `mcp`);
4. существование workspace, user и space, а также active user state;
5. текущее space membership для creator, если его текущая workspace role не
   `admin|owner`.

Текущий user object передаётся дальше, поэтому downgrade creator ограничивает
его текущими space/page abilities. Удаление membership немедленно аннулирует
ключ. Удаление space каскадно удаляет row и дополнительно fail-closed ловится
live validation.

Page reads проходят `PageAccessService`. Database roots/rows фильтруются по
читаемому snapshot и target-page access. Transclusion source/reference снова
проверяются на readable same-space state. Attachment MCP tool отдаёт только
metadata/index status: без bytes, extracted text, storage path, download URL или
credential. Legacy public embed-source attachment cookie теперь также
fail-closed.

## Capability registry и MCP transport

`McpController` использует `StreamableHTTPServerTransport` с
`sessionIdGenerator: undefined`; resumable session не создаётся. Stateless
replay действующего bearer допустим, но каждый replay проходит live auth и
перестаёт работать после expiry, revoke или потери доступа.

Registry validation отклоняет любую MCP exposure с `writeClass` не
`read_only`. `tools/list` и `tools/call` используют текущую effective policy;
неизвестный или policy-denied tool не доходит до executor. Live discovery
вернул:

- `getNode`
- `getOutline`
- `getPage`
- `getPageContext`
- `getTree`
- `search`
- `searchInPage`

Все семь имели `readOnlyHint: true`. `editPageText` отсутствовал в discovery и
прямой вызов вернул MCP error без записи.

## Rate limit и lease fail-closed

Live rate probe: 70 запросов, первые допустимые ответы `200`, затем стабильные
`429`. Concurrency probe принимал только ожидаемые `200/429`; отдельный client
также считает безопасным инфраструктурный `503`.

Unit coverage подтверждает:

- случайный lease owner id;
- только owner может renew/release слот;
- sequential renewal без overlapping promise;
- `503 api_key_limit_lease_lost` до headers;
- уничтожение уже начатого stream после headers;
- освобождение lease на completed/aborted/error.

## Route inventory

Route inventory сгенерирован из 310 controller routes и проходит drift check.
`/mcp` отдельно исключён из глобального `/api` prefix через
`API_PREFIX_EXCLUDES`.

| URL | Подтверждённое поведение |
| --- | --- |
| `/mcp` | root stateless Streamable HTTP, только MCP key |
| `/api/rag/*` | только RAG key |
| `/settings/keys` | redirect на `/settings/keys/mcp` |
| `/settings/keys/mcp` | MCP tab |
| `/settings/keys/rag` | RAG tab |
| `/settings/api-keys` | redirect на MCP |
| `/settings/account/api-keys` | admin-guarded redirect на RAG |
| `/settings/ai/mcp` | redirect на MCP |
| `/settings/ai/rag` | redirect на RAG |

Representative удалённые aliases `/api/users/me`, `/api/pages/create`,
`/api/files/upload`, `/api/workspace/info` вернули `404`, без скрытого fallback.

## Live JSON-RPC/API evidence

Полный редактированный результат: `live-mcp-api-results.json`.

| Сценарий | Результат |
| --- | --- |
| initialize | `200`, protocol `2025-06-18`, server `docmost` |
| tools/list | `200`, 7 read-only tools |
| read call | `getTree` — success |
| прямой write call | denied MCP result |
| replay | два независимых `200`, session id не выдаётся |
| invalid bearer | `401` |
| no/wrong content type | `415`, JSON-RPC `-32000` |
| malformed JSON | `400` |
| malformed JSON-RPC | `400`, `-32700` |
| unknown method | `-32601` |
| RAG key -> MCP | `401` |
| MCP key -> RAG | `401` |
| revoke -> immediate replay | `401` |
| rate/concurrency | `429` наблюдается, неожиданных статусов нет |

## Official MCP Inspector

Использован локальный `@modelcontextprotocol/inspector@2.1.0`, версия и npm
integrity закреплены после сверки с
[официальным signed release](https://github.com/modelcontextprotocol/inspector/releases/tag/2.1.0)
и [официальной документацией](https://github.com/modelcontextprotocol/inspector).

Inspector был привязан только к loopback и запущен с proxy authentication.
Bearer не передавался в CLI, URL, файл или SaaS: одноразовый loopback bridge
передал его только в памяти процесса. Inspector negotiated protocol
`2025-11-25`, увидел те же семь tools и успешно вызвал `getTree`. Ключ сразу
переименован, отозван и проверен повторным `401`. Результат:
`official-inspector-2.1.0-results.json`.

## Browser audit

Проверены desktop `1440x900` и mobile `390x844`, `ru-RU` и `en-US`:

- отдельные RAG/MCP tabs и прямые legacy URLs;
- admin/owner доступ и отказ member через settings guard;
- создание каждого типа, one-time modal, copy, rename/update и revoke;
- Universal, Codex, VS Code и Claude Desktop presets;
- capability selection, доступные инструкции и password-masked secret field;
- keyboard focus, accessible names, table/modal scrolling и mobile layout;
- полнота security/admin-guide key во всех 12 locale files автоматическим
  тестом.

На mobile третий шаг stepper переносится, но не перекрывает поля и остаётся
доступным. Блокирующих responsive или accessibility дефектов не найдено.

## Verification

Прошли:

- профильные backend: 8 suites / 74 tests;
- attachment boundary: 1 suite / 11 tests;
- page-template compatibility fixtures: 4 suites / 20 tests;
- frontend API-key/preset/localization: 5 files / 16 tests;
- audit client self-test: 1 test;
- `server:build` и `client:build`;
- `routes:inventory:check` — 310 routes;
- `check:rag-docs`, `check:env`, `check:ai-docs`, `check:comments:en`;
- lint server/client;
- live HTTP/MCP/Inspector/browser matrix.

Первый `verify:quick` run дошёл до 200/204 backend suites и выявил четыре
устаревших page-template specs; после исправления они прошли. Во время
повторного полного backend run параллельные изменения в рабочем дереве добавили
два новых несвязанных blocker: незавершённый `PAGE_TEMPLATE_SYNC` outbox spec и
неэкспортированный `normalizeTemplateDraft`. Итог повторного run: 202/204
suites и 1592/1593 tests passed; все MCP, API-key, RAG, attachment и ACL suites
прошли. `verify:full` не запускался повторно, потому что он детерминированно
останавливается на том же обязательном backend test stage. Эти два blocker не
относятся к входящему MCP и не меняют выводы аудита.

## Остаточный риск

- Stateless bearer по определению replayable до live revoke/expiry/access loss;
  это ожидаемый контракт, а не bearer proof-of-possession.
- Traffic rate/concurrency защищает admission, но не заменяет reverse-proxy
  volumetric protection.
- Full monorepo green status зависит от завершения параллельного page-template
  outbox/export refactor, указанного выше. Профильный security boundary зелёный.

## Evidence index

- `live-mcp-api-results.json` — sanitized protocol/cross-use matrix;
- `live-mcp-rate-results.json` — sanitized rate/concurrency run;
- `official-inspector-2.1.0-results.json` — sanitized Inspector result;
- `03`–`11` screenshots — desktop/mobile, RU/EN, presets и Inspector;
- `scripts/audit-inbound-mcp.mjs` — локальный env-only negative client;
- `scripts/audit-inbound-mcp.test.mjs` — client self-test/redaction check.
