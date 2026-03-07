/**
 * Localization keys for database -> page conversion.
 *
 * Kept in one place so database and page menus
 * use the same messages without duplication.
 */
export const DATABASE_TO_PAGE_TRANSLATION_KEYS = {
  confirmTitle: 'Convert database to page?',
  confirmDescription:
    'The database view, properties and row bindings will be deactivated. Child pages will stay in the tree as regular pages.',
  confirmAction: 'Convert to page',
  cancelAction: 'Cancel',
  successMessage: 'Database converted to page',
} as const;

interface ConvertDatabaseToPageActionParams {
  convertDatabaseToPageAsync: () => Promise<{ slugId?: string } | undefined>;
  onNotifySuccess: () => void;
  onNavigateAfterSuccess: (result: { slugId?: string }) => void;
}

/**
 * Creates confirm-button action for the modal.
 *
 * Keeps a consistent flow:
 * 1) mutation;
 * 2) success notification;
 * 3) navigation after successful conversion.
 */
export function createConvertDatabaseToPageAction({
  convertDatabaseToPageAsync,
  onNotifySuccess,
  onNavigateAfterSuccess,
}: ConvertDatabaseToPageActionParams) {
  return async () => {
    const result = await convertDatabaseToPageAsync();
    onNotifySuccess();

    if (result?.slugId) {
      onNavigateAfterSuccess(result);
    }
  };
}
