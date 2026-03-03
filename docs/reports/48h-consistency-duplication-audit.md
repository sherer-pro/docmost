# Аудит репозитория за последние 48 часов: согласованность и дублирование

## 1) Как проводился анализ

Проверка выполнялась по двум слоям:

1. **История изменений за 48 часов** (коммиты + файлы, частота правок).
2. **Текущее состояние кода на `HEAD`** в самых изменяемых местах (роутинг, кэш, меню действий, удаление/конвертация page/database).

### Команды, использованные для анализа

```bash
git log --since='48 hours ago' --pretty=format:'%h %ad %an %s' --date=iso
git log --since='48 hours ago' --oneline --decorate --graph --max-count=80
git log --since='48 hours ago' --name-only --pretty=format:'--- %h %ad %s' --date=iso > /tmp/log48.txt
awk '/^apps\//{print}' /tmp/log48.txt | sort | uniq -c | sort -nr | head -n 30
git show --stat --oneline 77b233fa
git show --stat --oneline a49e2511
rg -n "invalidateOnDeletePage|dropTreeNode|handleCopyLink|Convert database to page\?|/s/\$\{spaceSlug\}/p/\$\{result.slugId\}" \
  apps/client/src/features/page/queries/page-query.ts \
  apps/client/src/features/database/components/header/database-header-menu.tsx \
  apps/client/src/features/page/components/header/page-header-menu.tsx
```

## 2) Что по согласованности

### Позитивная динамика (согласованность повышается)

1. **Централизация инвалидации кэша** появилась в отдельном модуле (`invalidateSidebarTree`, `invalidateDatabaseEntity`, `invalidatePageEntity`, `invalidateDatabaseRowContext`). Это снижает вероятность рассинхронизации между page/database флоу.
2. **Унификация контракта идентификаторов** (id/slug/databaseId) выделена в адаптер, что уменьшает количество ad-hoc преобразований в UI.
3. **URL-строитель для database-роутов** вынесен в `buildDatabaseUrl`/`buildDatabaseNodeUrl`, что в целом уменьшает ручную сборку ссылок.

## 3) Найденные несогласованности

### 3.1. Разные подходы к сборке route в похожем сценарии

- В `database-header-menu` после `database -> page` используется **ручной шаблон** `navigate(`/s/${spaceSlug}/p/${result.slugId}`)`.
- В `page-header-menu` аналогичные переходы строятся через helper (`buildPageUrl`).

**Риск:** повторение логики роутинга в строках увеличивает шанс будущего расхождения (особенно при изменении формата URL).

### 3.2. Дублирующая «обертка» для copy-link

- В `database-header-menu` есть `handleCopyDatabaseLink`, а `handleCopyLink` просто проксирует вызов без дополнительной логики.

**Риск:** лишний уровень абстракции без ценности, повышает шум и усложняет поддержку.

### 3.3. Повтор модального текста/сценариев конвертации в двух меню

- Подтверждение `Convert database to page?` и близкая бизнес-логика присутствуют одновременно в page- и database-меню.

**Риск:** при последующих правках текст/поведение легко разъедутся (переводы, side effects, invalidate policy).

## 4) Дублирование и избыточность в истории коммитов

### 4.1. Явно повторённый commit (идентичный патч)

Коммиты:
- `77b233fa feat(client): add page-scoped full width toggle`
- `a49e2511 feat(client): add page-scoped full width toggle`

Оба имеют одинаковый набор файлов и одинаковую статистику изменений (7 файлов, +103/-8).

**Вывод:** в историю попал дублирующийся patch (вероятно из-за параллельных PR-веток и merge-последовательности).

### 4.2. Высокая концентрация правок в «горячих» файлах

Топ по частоте изменений за 48 часов:
- `database-table-view.tsx` — 22
- `database-page.tsx` — 21
- `space-tree.tsx` — 21
- `page.service.ts` — 18
- `database.service.ts` — 15
- `database-header-menu.tsx` — 15
- `page-query.ts` — 14

**Вывод:** архитектурная область page/database/tree активно стабилизируется, но пока остаётся зоной повышенного риска регрессий и повторов логики.

## 5) Оценка по API/модулям

1. **API/контракты id/slug:** общий тренд положительный (идёт унификация), но в UI ещё местами есть ручные route-сборки.
2. **Кэш и state-sync:** после введения общего invalidate-модуля консистентность улучшилась, но часть операций удаления/синхронизации всё ещё размазана между mutation-layer и UI-layer.
3. **Компонентная архитектура меню:** есть шаг к общим action item (`DocumentCommonActionItems`), однако доменные действия конвертации/удаления пока продублированы в двух крупных меню.

## 6) Практические рекомендации

1. **Дожать единый routing adapter**: запретить ручные route-string в feature-компонентах, оставить только helper-функции.
2. **Вынести conversion flows в общий hook/service** (например, `useDocumentTypeConversion`) и переиспользовать в page/database меню.
3. **Упростить слой action handlers**: удалить proxy-обертки без добавочной логики (`handleCopyLink -> handleCopyDatabaseLink`).
4. **Добавить guard в review-процесс на duplicate patch** (например, проверка patch-id в PR-template/checklist).
5. **Для горячих файлов ввести локальные контрактные тесты** на роутинг/инвалидацию (особенно `space-tree`, `page-query`, `database-page`).

## 7) Краткий итог

- За последние 48 часов команда проделала заметную работу по **унификации** page/database сценариев.
- Основные риски сейчас не в отсутствии функционала, а в **остаточной дубликации UI-логики** и **повторяемости патчей в истории**.
- При доведении routing+conversion до единого центра и укреплении проверок на дубли веток консистентность заметно вырастет.
