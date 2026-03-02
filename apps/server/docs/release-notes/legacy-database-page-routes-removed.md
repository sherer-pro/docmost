# Release note: legacy database/page routes removed

## Изменение

Legacy-маршруты для database/page URL больше не являются основным способом навигации.

- Удалена прямая legacy-ветка для database-экрана в формате:
  - `/s/:spaceSlug/databases/:databaseId`
- Canonical формат:
  - database: `/s/:spaceSlug/db/:databaseSlug`
  - page: `/s/:spaceSlug/p/:pageSlug`

Для оставшихся legacy-переходов включен временный диагностический слой:

- аудит обращений (лог + продуктовая метрика `legacy_route_hit`);
- клиентский redirect в canonical URL, если данные можно разрешить;
- явный 410-подобный экран, если legacy URL уже не может быть сопоставлен.

## Проверка на отсутствие legacy-форматов в активных шаблонах/экспортах

Был выполнен поиск по кодовой базе для блоков нотификаций и экспорта.

Проверка выполнялась командой:

```bash
rg -n "databases/:databaseId|/s/\$\{.*\}/databases/|/databases/" apps/server/src/core/notification apps/server/src/integrations/export apps/server/src/integrations/transactional
```

Результат: активных генераторов ссылок формата `/s/:spaceSlug/databases/:databaseId` в нотификациях/экспортах не обнаружено.
