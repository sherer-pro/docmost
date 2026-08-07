# Матрица «источник × роль × ACL/состояние»

Дата прогона: 2026-08-07. Финальное пространство: `aicontext20260807060054` (`019fdacf-6e69-7996-ad58-c3b0be9325b9`).

`E2E` означает проверку работающего контейнера и фактического запроса к локальной детерминированной модели. `Unit` означает изолированную проверку серверного guard. Во всех строках ожидаемый и фактический результаты совпали.

| Источник | Роль | ACL/состояние | Ожидаемый результат | Фактический результат и evidence |
| --- | --- | --- | --- | --- |
| Текущая страница | space reader | `read`, свежий snapshot | В модель передаётся snapshot текущего документа, источник получает citation | E2E `current-only`: получен `CURRENT_DOCUMENT_SNAPSHOT_MARKER_9A01`, `[C1]` |
| Выделенный текст | page writer / workspace admin | `write`, непустое выделение | Передаётся только выделение; полный snapshot не дублируется | E2E `selected-text`: получен `SELECTED_TEXT_MARKER_2C04`, маркер полного документа отсутствует |
| Действие над выделением | page writer / workspace admin | `write`, страница доступна | Текст изолирован как недоверенные данные; Markdown сохраняется при before/after/replace | E2E: все 7 команд завершены, injection изолирован; 3 режима применения сохранили `<strong>` |
| Действие над выделением | page writer | доступ отозван или страница исключена во время stream | Run завершается `source_access_changed`, частичный ответ очищается | Unit `ai-aux-run-execution.service.spec.ts`; guard вызывается до, во время и после provider stream |
| Выбранная страница | space reader | `read` | Канонический page ID, содержимое и стабильные citation URL попадают в snapshot | E2E `explicit-page`: `SOURCE_PAGE_MARKER_B22D`, document + heading citations |
| Выбранная страница | space reader | deny (`close-user`) до snapshot | Источник не принимается в контекст | E2E: `PUT .../context` → 400, `accepted=false` |
| Выбранная страница | workspace admin / page writer | системный `read`, закрыта только для reader | Источник остаётся доступен админу | E2E `admin-closed-page`: completed, `CLOSED_PAGE_MARKER_C33E` получен |
| Выбранная страница | space reader | permanently deleted до snapshot | Источник не принимается в контекст | E2E: `PUT .../context` → 400, `accepted=false` |
| Источник прошлого ответа | space reader | permanently deleted после генерации | Производные данные больше не выдаются через историю | E2E `delete-after-generation`: возвращён пустой content (`contentChars=0`) |
| Источник активного run | space reader | доступ отозван во время генерации | Run fail-closed; ответ, reasoning и citations очищаются | E2E: `source_access_changed`, status `failed`, `contentChars=0` |
| Источник прошлого ответа | space reader | ACL/exclusion изменились | В следующую provider history не попадает вся user/assistant-пара | Unit `ai-prompt-builder.service.spec.ts`: unreadable page pair omitted |
| Все потомки страницы | space reader | все выбранные потомки читаемы | Корень и точное доступное поддерево передаются без дублей | E2E `all-descendants`: root, два одноимённых child, grandchild, database и row markers |
| Отдельные потомки | space reader | выбран только grandchild | Передаются корень и выбранный grandchild; промежуточный невыбранный child не добавляется как источник | E2E `selected-descendant`: grandchild marker есть, child marker отсутствует |
| Nested page в picker | workspace admin | `read` | Breadcrumbs отражают фактическую иерархию | Runtime GET 200: `Tree root / Duplicate title` |
| Database | space reader | database page `read` | В контекст входят database и доступные rows | E2E `database-root`: `DATABASE_ROW_MARKER_88BD` получен |
| Database row | space reader | row page `read` | Page ID строки нормализуется в канонический database-row ID | E2E `database-row-normalization`: snapshot `sourceId === row.id` |
| PDF page attachment | space reader | parent page `read`, extraction `ready` | Извлечённый текст передаётся как недоверенный attachment reference | E2E: `PDF_CONTEXT_MARKER_8F31`, citation `attachment` |
| DOCX page attachment | space reader | parent page `read`, extraction `ready` | Извлечённый текст передаётся как недоверенный attachment reference | E2E: `DOCX_CONTEXT_MARKER_4D2A`, citation `attachment` |
| Нечитаемый attachment | space reader | parent page `read`, extraction failed | Файл изолируется; валидные соседи и run не падают | E2E: run completed, unreadable source отсутствует, PDF и DOCX присутствуют |
| Page attachment | space reader | parent ACL/identity изменились во время run | Run завершается fail-closed | Unit `ai-run-execution.service.spec.ts`: attachment передаётся в live source guard |
| Private chat file | владелец файла / space reader | `ready`, live, та же conversation/workspace | Файл передаётся и цитируется приватным conversation URL | E2E `private-chat-file`: `PRIVATE_CHAT_FILE_MARKER_1B02`, citation `chat_file` |
| Private chat file | владелец файла | deleted/not-ready/другая conversation | Файл и производная history не передаются | Unit: deleted file rejected by run guard; history pair omitted |
| Space search result | space reader | кандидат разрешён до запроса и после retrieval | Только повторно авторизованные hits передаются модели | E2E `space-search-results`: два deterministic hits; Unit source-access filter |
| Context picker search | space reader | доступные страницы | Кавычки, скобки, `«…»`, дефис и Unicode безопасно ищутся | E2E: все 5 запросов вернули точные ожидаемые заголовки |
| Context picker pagination | space reader | 27 доступных результатов | Cursor продвигается по raw rows, canonical IDs не дублируются | E2E: `count=27`, `uniqueCount=27` |
| Oversized page set | space reader | 4 читаемых источника, окно 4096 tokens | Контекст обрезается по бюджету без переполнения provider request | E2E: передано 2400 reference chars, emitted 2 of requested 4 |
| Переименованный/перемещённый источник | workspace admin / page writer | `read` после rename/move | Citation snapshot использует актуальный title и стабильный canonical URL | E2E `browser-citation`: `Renamed source page`, URL открыл нужную страницу |
| Любой page-backed source | пользователь без `read` | deny / вне scope | Не входит в snapshot, provider request, citations или повторно используемую history | Unit `ai-source-access.service.spec.ts`; закрытая/deleted страницы подтверждены E2E |
