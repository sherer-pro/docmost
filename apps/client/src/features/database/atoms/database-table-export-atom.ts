import { atom } from 'jotai';
import { IDatabaseTableExportState } from '@/features/database/utils/database-markdown';

/**
 * Дефолтное состояние представления таблицы для экспорта.
 *
 * Важно: дублирует UX таблицы (все колонки видимы, фильтр-заглушка, сортировка выключена).
 */
export const defaultDatabaseTableExportState: IDatabaseTableExportState = {
  visibleColumns: {},
  filters: [
    {
      propertyId: '',
      operator: 'contains',
      value: '',
    },
  ],
  sortState: null,
};

/**
 * Хранит UI-состояние таблицы по databaseId,
 * чтобы header-меню могло экспортировать/копировать markdown в том же виде,
 * который пользователь прямо сейчас видит на экране.
 */
export const databaseTableExportStateAtom = atom<Record<string, IDatabaseTableExportState>>({});
