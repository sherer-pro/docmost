import { atom } from 'jotai';
import { IDatabaseTableExportState } from '@/features/database/utils/database-markdown';

/**
 * The default state of the table view for export.
 *
 * Important: duplicates the UX of the table (all columns are visible, filter is a placeholder, sorting is disabled).
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
 * Stores the UI state of the table by databaseId,
 * so that the header menu can export/copy markdown in the same form,
 * which the user sees on the screen right now.
 */
export const databaseTableExportStateAtom = atom<Record<string, IDatabaseTableExportState>>({});
