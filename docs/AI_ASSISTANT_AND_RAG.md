# ИИ-помощник и умный поиск (RAG)

Этот документ описывает фактическую архитектуру core-ИИ в Docmost: чат по
страницам, контекст, фоновые запуски, поиск по пространству и интеграцию с
внешними RAG-индексами. Он также отделяет два похожих, но разных контура:

1. **Query-time retrieval** — поиск источников во время ответа ИИ-помощника.
2. **RAG API** (`/api/rag/*`) — read-only API для выгрузки и синхронизации
   данных во внешний индекс. Само оно не отвечает на поисковые запросы.

Все HTTP-пути ниже указаны с глобальным префиксом `/api`.

## 1. Состав и границы системы

Core ИИ расположен в `apps/server/src/core/ai`, клиентская часть — в
`apps/client/src/features/ai`, а общие TypeScript-контракты — в
`packages/api-contract/src/ai.ts`.

На уровне пространства (`space`) хранится отдельная запись `ai_space_configs`:
она не использует `spaces.settings`. В ней находятся параметры OpenAI-compatible
провайдера, зашифрованные ключи, политика хранения, лимиты, включённые функции и
настройка внешнего retrieval. Источники правды для истории и выполнения —
таблицы разговоров, сообщений, запусков, файлов и снимков источников; очередь
не является источником состояния.

Основные компоненты:

| Компонент | Назначение |
| --- | --- |
| `AiConversationService` | личные разговоры пользователя в контексте страницы, сообщения и черновики |
| `AiContextService` | версионируемый состав контекста разговора и проверка доступа к источникам |
| `AiRunService` / `AiRunExecutionService` | создание попыток, лимиты, идемпотентность, выполнение и потоковая запись ответа |
| `AiPromptBuilderService` | сборка ограниченного по бюджету prompt из истории, контекста, файлов и результатов поиска |
| `OpenAiCompatibleProviderService` | запросы и streaming к совместимому с OpenAI API провайдеру |
| `AiRetrievalService` | безопасный query-time retrieval и повторная авторизация найденных источников |
| `AiFileService` | загрузка, извлечение текста, изображения, tombstone-удаление и очистка файлов чата |
| `AiAuxRunService` | отдельные фоновые задачи: автоматический заголовок беседы и преобразование выделения в редакторе |

Выполнение обслуживает `AI_CHAT_QUEUE`. В BullMQ доставка как минимум один раз,
поэтому worker атомарно переводит конкретный `ai_runs` из `queued` в `running`;
терминальная попытка не открывается повторно. Детерминированные job id,
compare-and-set переходы, порядковая последовательность событий и reconciler
закрывают границу PostgreSQL/Redis без автоматического повтора зависшего вызова
провайдера.

## 2. Как работает ИИ-помощник

### Обычный ответ в чате

1. Клиент создаёт или открывает личный разговор, привязанный к `pageId`.
2. При отправке создаются пользовательское сообщение, ожидаемое сообщение
   ассистента и неизменяемая попытка `ai_run`. Ключ `clientRequestId` связывает
   идемпотентный запрос с его содержимым; одинаковый ключ с иным payload
   отклоняется.
3. Проверяются доступность ИИ, текущий пользователь, принадлежность странице и
   право записи в неё, лимиты и конкуренция. Одновременно разрешены максимум
   1 запуск на разговор, 6 на пользователя и 30 на пространство.
4. Worker фиксирует запуск как `running`, разрешает снимок контекста, файлы и,
   если включён `useSpaceSearch`, внешние результаты retrieval.
5. `AiPromptBuilderService` строит сообщения провайдеру из system instructions,
   истории, текущего документа, явно выбранных источников, файлов/изображений и
   безопасных фрагментов поиска. Бюджеты рассчитываются от `contextWindow` и
   `maxOutputTokens`, поэтому большие источники усекаются.
6. Провайдер отдаёт текстовый поток. Дельты и, если разрешено, reasoning
   буферизуются, периодически сохраняются в БД и передаются через Socket.IO.
   В `ai_runs.sequence` сохраняется монотонная последовательность для
   упорядочивания событий на клиенте.
7. При успехе сохраняются расход токенов, снимок ответа/reasoning и citations.
   Для первой успешной реплики может быть запланирована отдельная задача
   заголовка: до четырёх Unicode-слов; ручное переименование всегда имеет
   приоритет. При ошибке или отмене сообщения и попытка получают терминальный
   статус.

Повтор (`retry`) и регенерация (`regenerate`) создают связанные новые попытки,
а не перезаписывают исходную. `retry` относится к запуску, `regenerate` — к
сообщению ассистента. Отмена выставляет запрос на отмену; worker проверяет его
во время streaming и завершает текущую попытку как `cancelled`.

### Контекст, файлы и действия в редакторе

Контекст беседы имеет revision. В него входят флаг текущего документа, до 10
явных источников (`page`, `database`, `database_row`), до 10 файлов чата и до
20 вложений страницы. При `PUT` клиент указывает `expectedRevision`; конфликт
возвращается как `ai_context_revision_conflict`. На каждый запуск сохраняется
снимок разрешённого контекста, поэтому повтор воспроизводим, а утрата доступа
не позволяет использовать или показать производные данные.

Личные multipart-файлы требуют заголовок `Idempotency-Key`. Допустимы PDF,
DOCX, TXT, Markdown, JPEG, PNG и WebP; ограничения: до 10 файлов, 25 MiB на
файл и 100 MiB на разговор. Извлечение текста идёт асинхронно, а изображения
передаются провайдеру только при `visionEnabled`. Удаление сначала фиксирует
tombstone в БД, затем повторяемо очищает storage.

Преобразование выделения в редакторе (`editor_transform`) — это `ai_aux_run`.
Оно использует выделение и hash снимка страницы, транслирует результат в
реальном времени, но не создаёт сообщений чата и не меняет его историю.

## 3. Умный поиск во время ответа

### Включение и поток данных

Для конкретной отправки флаг `useSpaceSearch` запрашивает поиск, но поиск
возможен только когда в конфигурации пространства настроен adapter. Состояния
в `AiRun.retrievalOutcome`: `not_requested`, `disabled`, `used`, `empty`,
`failed`. Сбой поиска не прерывает генерацию: модель получает доступный
документный/файловый контекст без внешних результатов.

Перед внешним вызовом сервер получает текущий `getSidebarAccessSnapshot` для
пользователя. Список разрешённых страниц попадает в запрос только для
`http-json-v1`; независимо от ответа сервера каждый найденный кандидат снова
сверяется с БД, workspace, space, состоянием удаления и текущими page ACL.
Только после этого его excerpt добавляется в prompt и становится citation.
Следовательно, внешний индекс не является источником авторизации и не может
сам расширить доступ пользователя.

Внешний запрос ограничен: до 40 кандидатов, до 8 итоговых результатов по
умолчанию, 16 KiB текста на hit, 1 MiB serialized request и 256 KiB response.
Некорректные, слишком большие или не-UUID кандидаты отбрасываются по одному;
дубликаты одной идентичности оставляют лучший score.

### Поддерживаемые адаптеры

| Adapter | Настройка | Вызов и ожидания |
| --- | --- | --- |
| `none` | дополнительных полей нет | retrieval отключён |
| `http-json-v1` | `url`, опциональный API key, timeout, maxResults | `POST` на указанный URL с версионированным JSON-запросом; ожидается `{ items }` |
| `open-webui-knowledge-v1` | base URL, API key Open WebUI, `knowledgeId`, timeout, maxResults | проверяет Knowledge Base и вызывает `POST /api/v1/retrieval/query/collection` Open WebUI |

Для `open-webui-knowledge-v1` поддерживаются лишь документы с метаданными
`docmost` schemaVersion 1, теми же `workspaceId` и `spaceId`. Разрешённые типы
внешних результатов: `page`, `database_row`, `attachment`; внутренний
`database` допустим как явно выбранный контекст, но не в контракте внешнего
поиска. Адаптер передаёт `hybrid: false`, чтобы неисправный внешний reranker не
делал недоступным обычный vector search. Если ответ коллекции содержит только
`file_id`, адаптер запрашивает `GET /api/v1/files/:fileId` и получает
канонические метаданные из `file.meta.data.docmost`. Distance Open WebUI
преобразуется в score `1 / (1 + max(0, distance))`.

## 4. Настройка и эксплуатация

### Параметры пространства

Единственный поддерживаемый provider — `openai-compatible`. Значения по
умолчанию: `temperature` 0.2, `maxOutputTokens` 8192, `contextWindow` 131072,
`requestTimeoutMs` 300000, 100 запросов/день на пользователя, 2 000 000
токенов/день на пространство и 90 дней хранения. `maxOutputTokens` обязан
оставлять минимум 1024 токена для входного контекста.

Для retrieval по умолчанию используются `http-json-v1`, timeout 8000 ms и
`maxResults` 8. API принимает timeout 1000–60000 ms и 1–20 результатов.
Настройки также включают `systemInstructions`, `visionEnabled`,
`reasoningEnabled` и до 50 быстрых команд. Секреты модели, retrieval и
Open WebUI шифруются application secret; публичные ответы возвращают только
флаги `apiKeyConfigured`.

Администратор пространства с полным доступом может получить/изменить
конфигурацию и проверить соединение модели или retrieval. Проверка модели
пытается получить список моделей, выполняет короткий completion и, когда
запрошено, проверяет vision. Проверка Open WebUI дополнительно проверяет
доступность collection и может вернуть версию удалённого сервиса.

### Сетевые и защитные ограничения

`AI_PROVIDER_ALLOWED_ORIGINS` и `AI_RETRIEVAL_ALLOWED_ORIGINS` — разные
production allowlist точных HTTP(S)-origin для model endpoint и retrieval.
URL с credentials, query или fragment отклоняются; для Open WebUI base URL
также требуется чистый origin. Общая outbound-политика проверяет URL/DNS,
запрещает redirects и ограничивает транспорт. В development разрешены loopback
адреса; в Docker `127.0.0.1` означает контейнер Docmost, а не хост.

`AI_STREAM_IDLE_TIMEOUT_MS` ограничивает паузу между SSE-частями (включая
первую) в пределах 5000–600000 ms, по умолчанию 120000 ms. Он обновляется на
каждой части и дополнительно ограничен полным `requestTimeoutMs` пространства.

Все обычные изменяющие endpoints ИИ требуют JWT и проходят глобальную CSRF
проверку. У чата сохраняются только собственные разговоры пользователя; доступ
к странице и источникам проверяется повторно. Cтатистика retrieval хранится
как безопасные агрегаты (результаты, задержки и счётчики), без содержимого.

## 5. Внешняя синхронизация с Open WebUI

`apps/rag-sync` — отдельный optional-процесс, не часть backend runtime. Он
читает только `/api/rag/*`, не импортирует server repositories, не имеет доступа
к БД Docmost и не использует `AI_QUEUE`/`AI_CHAT_QUEUE`. Одна предварительно
созданная Knowledge Base Open WebUI сопоставляется одному пространству Docmost.

Процесс хранит checkpoint, source-to-file mapping и распределённые lock в
отдельном Redis namespace (по умолчанию `docmost:rag-sync`). Он обрабатывает
полную и delta-синхронизацию, сохраняет inclusive checkpoint только после
успешной обработки, восстанавливает утраченные mappings из
`meta.data.docmost`, игнорирует чужие workspace/space, удаляет дубликаты и
заменяет файл лишь после его обработки Open WebUI. Поддерживаются страницы,
строки БД и PDF, DOCX, TXT, MD, JPEG, PNG, WebP-вложения. Логи содержат IDs,
состояния, счётчики, lag и длительности, но не документный текст и секреты.

Конфигурация задаётся через `RAG_SYNC_CONFIG_PATH`; пример —
`rag-sync.config.example.json`. В JSON указываются URLs, Redis, интервалы,
максимальный размер вложения и bindings. Секреты задаются только путями к
смонтированным файлам (`docmostApiKeyFile`, `openWebUiApiKeyFile`), а не
inline-значениями. `knowledgeId`, `workspaceId` и `spaceId` проверяются при
загрузке. API-ключ для чтения Docmost и ключ, которым основной сервер ищет в
Open WebUI, — независимые секреты.

## 6. API

### Аутентифицированный API ИИ

Все эти endpoints требуют пользовательский JWT; mutating routes также требуют
стандартный CSRF контракт.

| Метод и путь | Назначение |
| --- | --- |
| `GET/PATCH /api/spaces/:spaceId/ai/config` | получить/изменить конфигурацию ИИ пространства |
| `POST /api/spaces/:spaceId/ai/config/actions/test-model` | проверить provider и опционально vision |
| `POST /api/spaces/:spaceId/ai/config/actions/test-retrieval` | проверить внешний retrieval |
| `GET /api/spaces/:spaceId/ai/status?pageId=` | доступность, права, usage и быстрые команды |
| `GET/POST /api/ai/conversations` | список по обязательному `pageId` / создание разговора |
| `GET/PATCH/DELETE /api/ai/conversations/:id` | чтение, изменение, soft delete своего разговора |
| `POST /api/ai/conversations/:id/actions/open` | обновить момент открытия |
| `GET /api/ai/conversations/:id/messages` | сообщения с `before`, `limit` |
| `GET/PUT /api/ai/conversations/:id/context` | получить/версионированно заменить контекст |
| `GET /api/ai/conversations/:id/context-sources` | поиск доступных кандидатов для явного контекста |
| `POST /api/ai/conversations/:id/messages` | отправить сообщение, создаёт run, ответ `202` |
| `GET /api/ai/runs/:id` | состояние отдельной попытки |
| `POST /api/ai/runs/:id/actions/cancel` | запросить отмену |
| `POST /api/ai/runs/:id/actions/retry` | создать новую попытку, ответ `202` |
| `POST /api/ai/messages/:id/actions/regenerate` | заново сгенерировать ответ, `202` |
| `GET/POST /api/ai/conversations/:conversationId/files` | список/идемпотентная multipart-загрузка файлов |
| `GET/DELETE /api/ai/conversations/:conversationId/files/:fileId` | скачать/удалить личный файл |
| `GET /api/ai/pages/:pageId/attachments` | доступные для контекста вложения страницы |
| `POST /api/ai/editor-actions` | создать трансформацию выделения, `202` |
| `GET /api/ai/editor-actions/:id` | состояние editor action |
| `POST /api/ai/editor-actions/:id/actions/cancel` | отменить editor action |

### RAG API синхронизации

Все `/api/rag/*` routes read-only (`GET`), не используют CSRF и принимают
только API key: `Authorization: Bearer <token>`. Пользовательский JWT/cookie
на них отвергается; API key вне `/api/rag/*` также отвергается. Ключ несёт
`workspaceId`, `spaceId`, `apiKeyId`, `sub`; scope, текущая membership создателя
и page ACL ограничивают данные. Cursor feeds имеют at-least-once семантику:
потребитель обязан делать idempotent upsert/delete.

| Путь | Данные |
| --- | --- |
| `GET /api/rag/pages?includeContent=` | полный список активных pages/databases |
| `GET /api/rag/updates?updatedSince=&limit=&cursor=` | изменившиеся pages/databases |
| `GET /api/rag/deleted?deletedSince=&limit=&cursor=` | tombstones page/database/databaseRow |
| `GET /api/rag/attachments/updates?updatedSince=&limit=&cursor=` | изменения вложений |
| `GET /api/rag/attachments/deleted?deletedSince=&limit=&cursor=` | tombstones вложений |
| `GET /api/rag/pages/:pageIdOrSlug?includeContent=` | детали страницы или контейнера БД |
| `GET /api/rag/databases/:databaseIdOrPageSlug` | структурированная БД и `knowledgeMarkdown` |
| `GET /api/rag/databases/:databaseIdOrPageSlug/rows?pageIds=` | строки, ячейки и Markdown строк |
| `GET /api/rag/pages/:pageIdOrSlug/attachments` | метаданные вложений и download URL |
| `GET /api/rag/attachments/:fileId/:fileName` | бинарный поток вложения с повторной ACL-проверкой |
| `GET /api/rag/pages/:pageIdOrSlug/comments` | комментарии, включая resolved |
| `GET /api/rag/pages/:pageIdOrSlug/export` | ZIP экспорта страницы (`format`, `includeAttachments`, `includeChildren`) |
| `GET /api/rag/space/export` | ZIP экспорта scope-пространства (`format`, `includeAttachments`) |

Полная спецификация полей и примеры запросов для этого контура находятся в
[`RAG_API.md`](RAG_API.md).

## 7. Контракты

Канонические TypeScript-контракты находятся в
`packages/api-contract/src/ai.ts`. Ключевые перечисления: provider
`openai-compatible`; adapters `none`, `http-json-v1`,
`open-webui-knowledge-v1`; статусы run `queued`, `running`, `completed`,
`failed`, `cancelled`; статусы message `pending`, `streaming`, `completed`,
`failed`, `cancelled`; source types `page`, `database`, `database_row`,
`attachment`, `chat_file`.

Главные публичные модели: `AiSpaceConfig`, `AiAvailability`,
`AiConversation`, `AiConversationContext`, `AiMessage`, `AiRun`, `AiCitation`,
`AiChatFile`, `AiEditorActionRun`. В ответе assistant-сообщения присутствуют
`reasoning`, `runStatus`, `retrievalOutcome`, `retrievalErrorCode`,
`applyContext` и citations, когда они применимы. Парольные/ключевые поля в
публичные модели не входят.

Контракт `http-json-v1`:

```ts
type AiRetrievalQueryRequest = {
  schemaVersion: 1;
  requestId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  query: string;
  allowedPageIds: string[];
  sourceTypes: Array<'page' | 'database_row' | 'attachment'>;
  limit: number;
  candidateLimit: number;
};

type AiRetrievalQueryResponse = {
  items: Array<{
    sourceType: 'page' | 'database_row' | 'attachment';
    sourceId: string;
    pageId: string;
    text: string;
    score?: number;
  }>;
};
```

Realtime Socket.IO-события также описаны контрактами: `ai:run.delta`,
`ai:run.status`, `ai:conversation.updated`, `ai:editor-action.delta` и
`ai:editor-action.status`. Дельта run содержит `runId`, `conversationId`,
`messageId`, `pageId`, `sequence`, `delta` и необязательный `reasoningDelta`;
статус может добавлять retrieval outcome/error и ошибку выполнения.

Ошибки ИИ передаются стабильными кодами из `AiErrorCode`, включая квоты,
идемпотентность, права страницы, provider, очередь, retrieval, контекст,
файлы и editor action. В частности, retrieval использует
`retrieval_request_too_large`, `retrieval_timeout`, `retrieval_unavailable`,
`retrieval_url_rejected`, `retrieval_invalid_response` и
`retrieval_collection_unavailable`.
