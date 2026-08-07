# AI-контекст, источники и цитаты — итог аудита

Финальный прогон от 2026-08-07 прошёл полностью. Изолированная модель получила ожидаемые source markers во всех 14 generation-сценариях; всего зафиксировано 25 provider requests. Финальное пространство сохранено для ручной проверки: `aicontext20260807060054` (`019fdacf-6e69-7996-ad58-c3b0be9325b9`). 29 промежуточных пространств удалены через штатный API.

## Исправленные недостатки

1. История беседы повторно использовала пары, производные от источника, проверяя только AI exclusion, но не текущий page ACL/deletion и состояние private chat file. Теперь каждая зависимость переавторизуется, а вся user/assistant-пара исключается при потере доступа.
2. Live source guard обычного и agent run учитывал retrieval/page dependencies, но не page attachments и private chat files. Теперь они проверяются до provider use, во время flush и в финальной транзакции; partial output очищается.
3. Editor selection action передавала документный текст без строгого untrusted envelope и проверяла write access только до provider call. Теперь selection сериализуется в `UNTRUSTED_SELECTED_TEXT_JSON`, instruction идёт после него, а ACL/exclusion recheck выполняется до, во время и после stream.
4. PostgreSQL `f_unaccent` превращал `«…»` в `<<…>>`, после чего enclosed word исчезал из `tsvector`. Миграция `20260807T140000-search-guillemet-indexing.ts` удаляет guillemet delimiters до `f_unaccent` и перестраивает page/attachment vectors.

Нечитаемый PDF среди валидных файлов был изолирован, а DOCX/PDF продолжили участвовать в контексте. Исправление attachment extraction уже находилось в незакоммиченных изменениях пользователя до этой задачи; аудит его проверил, но не включает этот чужой source diff в коммиты задачи.

## Что доказано финальным прогоном

- Текущая страница, выбранная страница, selection, database, database row, все и отдельные descendants, page attachments, private chat file и space search дошли до локальной deterministic model в ожидаемом составе.
- Database-row page ID нормализован в canonical row ID.
- All-descendants включил root и точное поддерево; selected-descendant не включил невыбранного промежуточного child как отдельный source.
- Reader получил 400 при попытке добавить закрытую и удалённую страницу. Admin смог использовать страницу, закрытую только для reader.
- Отзыв доступа во время stream завершил run как `source_access_changed`, `contentChars=0`; удалённый после ответа source оставил history content пустым.
- PDF и DOCX markers дошли до модели; corrupt PDF отсутствовал в citations и не сломал соседние файлы.
- Безопасная prompt-injection фраза осталась только внутри untrusted references. Editor selection показал `selectionInjectionIsolated=true` для 7 команд.
- Search вернул точные заголовки для `"quoted"`, `(brackets)`, `«guillemets»`, `Search-hyphen` и `Поиск Юникод 東京`.
- Pagination прошла 27 результатов: 27 canonical identities, 0 дублей.
- При окне 4096 tokens из четырёх oversized sources фактически emitted два; reference payload ограничен 2400 символами.
- После rename/move citation использовала `Renamed source page` и стабильный canonical URL; переход открыл нужную страницу.
- Runtime breadcrumbs для `Tree grandchild`: `Tree root / Duplicate title`.
- Selection apply modes `before`, `after`, `replace` сохранили strong Markdown formatting.
- Reload, параллельная вкладка, optimistic context revision conflict (409) и mobile context picker прошли.

## Evidence

- Полная матрица source × role × ACL: [`source-acl-matrix.md`](source-acl-matrix.md).
- Фактически отправленные reference envelopes без секретов: [`actual-context.json`](actual-context.json).
- Результаты 14 generation-сценариев: [`scenario-results.json`](scenario-results.json).
- Runtime/API/browser assertions: [`audit-state.json`](audit-state.json).
- Санитизированный Playwright trace: [`traces/browser-context-sources.zip`](traces/browser-context-sources.zip).
- Скриншоты: [`desktop-assistant.png`](screenshots/desktop-assistant.png), [`selection-actions-formatting.png`](screenshots/selection-actions-formatting.png), [`mobile-context-picker.png`](screenshots/mobile-context-picker.png).
- Safe PDF/DOCX fixtures и PDF render: [`fixtures/fixture-manifest.json`](fixtures/fixture-manifest.json), [`fixtures/pdf-render/page-1.png`](fixtures/pdf-render/page-1.png).
- Восстановленный commit inventory: [`commit-inventory.md`](commit-inventory.md).

Trace содержит 626 entries. Повторное применение sanitizer не изменило ни один entry (`residual_sensitive_entries=0`); отдельный scan JSON/Markdown не нашёл JWT, Authorization, CSRF, test API keys или passwords.

## Метод и ограничения

Среда: Dockerized Docmost/PostgreSQL/Redis, отдельный collaboration container, Playwright `1.62.1`, Chromium, локальная `deterministic-context-model-v1`. Fixtures синтетические и не содержат реальных секретов.

Не проверены Firefox/WebKit и физическое мобильное устройство. Write-path покрыт workspace admin с page-writer access, но отдельная обычная writer-учётная запись не создавалась. DOCX прошёл structure/style/extracted-text QA, но визуальный render не выполнен из-за отсутствия LibreOffice. Production provider и внешний retrieval намеренно не использовались. Для rollout остаётся измерить длительность полного page/attachment reindex на production-sized базе.
