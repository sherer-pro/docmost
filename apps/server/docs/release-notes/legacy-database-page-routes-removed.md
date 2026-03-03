# Release note: legacy database/page routes removed

## Изменение

Legacy-маршруты для database/page URL больше не являются основным способом навигации.

- Основной формат database-ссылок в клиенте: `/s/:spaceSlug/db/:databaseSlug` (по `slugId`).
- Основной формат page-ссылок в клиенте: `/s/:spaceSlug/p/:pageSlug`.

Legacy-ветка `/s/:spaceSlug/databases/:databaseId` оставлена только как **временный fallback** для сценариев, где в tree payload временно отсутствует `slugId` у database-узла.

## Текущее поведение клиента (зафиксированный приоритет)

Построение URL для database-узлов централизовано в `buildDatabaseNodeUrl` (`apps/client/src/features/page/page.utils.ts`) и работает в едином порядке:

1. Канонический URL по `slugId`: `/s/:spaceSlug/db/:databaseSlug`.
2. Временный fallback по `databaseId`: `/s/:spaceSlug/databases/:databaseId`.
3. Если нет данных для маршрута — возврат на `/s/:spaceSlug`.

Для fallback добавлен явный срок жизни в `DATABASE_ROUTE_FALLBACK_CONFIG`:

- `enabled: true`
- `removeBy: '2026-03-31'`
- `ticket: 'DOC-2471'`

После закрытия `DOC-2471` fallback должен быть удален полностью.

## Проверка на отсутствие legacy-форматов в активных шаблонах/экспортах

Был выполнен поиск по кодовой базе для блоков нотификаций и экспорта.

Проверка выполнялась командой:

```bash
rg -n "databases/:databaseId|/s/\$\{.*\}/databases/|/databases/" apps/server/src/core/notification apps/server/src/integrations/export apps/server/src/integrations/transactional
```

Результат: активных генераторов ссылок формата `/s/:spaceSlug/databases/:databaseId` в нотификациях/экспортах не обнаружено.
