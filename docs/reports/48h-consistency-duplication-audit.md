# Аудит репозитория за последние 48 часов: согласованность и дублирование

## 1) Методика

Анализ выполнен в двух плоскостях:

1. **Git-история за 48 часов**: частота правок, повторяемость патчей, характер коммитов.
2. **Текущее состояние `HEAD`** в наиболее «горячих» местах: page/database routing, меню действий, API normalization, cache invalidation.

Команды:

```bash
git log --since='48 hours ago' --pretty=format:'%H %ad %s' --date=iso
git log --since='48 hours ago' --no-merges --name-only --pretty=format:
python: подсчёт частоты изменений по файлам
python: поиск дубликатов patch-id через git patch-id --stable
rg: поиск дублирующихся handler-ов и route-строителей
```

---

## 2) Что улучшилось по согласованности

### 2.1 Единая нормализация API-ответа для page

На сервере добавлен mapper `mapPageResponse`, который централизует нормализацию `settings` и формирование `customFields`.
Это снижает вероятность расхождения контрактов между endpoint-ами page.

### 2.2 Централизация cache invalidation на клиенте

Вынесенные helper-ы `invalidateSidebarTree`, `invalidateDatabaseEntity`, `invalidatePageEntity`, `invalidateDatabaseRowContext`
используются и в `page-query`, и в `database-query`, что заметно уменьшает риск «забытых» invalidate после мутаций.

### 2.3 Унификация URL helper-ов

В проекте активно используются `buildPageUrl`, `buildDatabaseUrl`, `buildDatabaseNodeUrl`, что в целом уменьшает
ручную сборку ссылок и повышает предсказуемость роутинга.

---

## 3) Найденные несогласованности и дублирование

### 3.1 Локальная несогласованность route-building в похожих conversion-flow

- В `page-header-menu` после conversion используется helper (`buildPageUrl`).
- В `database-header-menu` в аналогичном сценарии остаётся ручной шаблон: `navigate(`/s/${spaceSlug}/p/${result.slugId}`)`.

**Риск:** при изменении канонического формата page URL поведение в двух меню может разъехаться.

### 3.2 Лишняя прокси-обёртка в copy-link

В `database-header-menu` есть пара:
- `handleCopyDatabaseLink`
- `handleCopyLink` (только проксирует вызов первой без добавления логики)

**Риск:** техдолг небольшого масштаба, но увеличивает шум и когнитивную нагрузку при чтении.

### 3.3 Дублирование conversion-confirmation текста и flow в двух меню

Подтверждение и сценарий `Convert database to page?` реализованы и в page menu, и в database menu отдельно.

**Риск:** высока вероятность расхождения текстов, i18n-ключей и post-action side effects при будущих изменениях.

### 3.4 Повторяющийся patch в истории коммитов

Выявлен одинаковый `patch-id` у двух разных коммитов:

- `77b233fad940c0e6f98d83a7eec5f71da94c63e2`
- `a49e25113f77041bb6863159e5838de27b4a10be`

Это означает фактическое дублирование одного и того же изменения в истории.

---

## 4) «Горячие» файлы (по числу изменений за 48 часов, без merge-коммитов)

1. `apps/client/src/features/database/components/database-table-view.tsx` — 22
2. `apps/client/src/features/page/tree/components/space-tree.tsx` — 22
3. `apps/client/src/pages/database/database-page.tsx` — 22
4. `apps/server/src/core/page/services/page.service.ts` — 19
5. `apps/client/src/features/database/components/header/database-header-menu.tsx` — 16
6. `apps/server/src/core/database/services/database.service.ts` — 16
7. `apps/client/src/features/page/queries/page-query.ts` — 15

**Вывод:** зона page/database/tree остаётся наиболее регрессионно-опасной; архитектурная стабилизация идёт,
но всё ещё сопровождается высокой турбулентностью изменений.

---

## 5) Оценка по запросу

### 5.1 Согласованность функций/компонентов/модулей/API

- **Положительно:**
  - усилилась согласованность API-контрактов page за счёт mapper-подхода;
  - усилилась согласованность клиентского state-sync через общий invalidate-модуль;
  - общий тренд последних коммитов — на унификацию id/slug contract и route helper-ы.
- **Остаточные проблемы:**
  - частичная ручная сборка URL в conversion-flow;
  - дублирование доменных сценариев conversion в двух меню-компонентах.

### 5.2 Избыточность и дублирующая логика/API

- **Подтверждённая избыточность в коде:** proxy-handler для copy-link без самостоятельной логики.
- **Подтверждённое дублирование в истории:** одинаковый patch в двух коммитах (по `patch-id`).
- **Частично дублируемая бизнес-логика:** conversion-confirmation flow в двух menu-компонентах.

---

## 6) Приоритетные рекомендации

1. **Убрать ручные page-route шаблоны** из feature-компонентов, оставить только helper-ы (`buildPageUrl`).
2. **Свести conversion-flow в единый переиспользуемый слой** (например, `useDocumentConversionActions`).
3. **Удалить proxy-handler без логики** (`handleCopyLink -> handleCopyDatabaseLink`) либо добавить в него отдельную ответственность.
4. **Добавить lightweight-проверку на duplicate patch в PR-процессе** (patch-id/commit-range check).
5. Для «горячих» файлов (`database-page`, `space-tree`, `database-table-view`) расширить тесты на
   route consistency + cache invalidation side effects.

---

## 7) Итог

За последние 48 часов наблюдается выраженный тренд на унификацию и стабилизацию page/database подсистемы.
Критичных архитектурных конфликтов не обнаружено, но остаются локальные источники расхождения (ручной route-building,
дублирующиеся conversion-flow и повтор патча в истории). Устранение этих точек даст наиболее быстрый прирост консистентности.
