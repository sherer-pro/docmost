/**
 * Набор ключей локализации для конвертации database -> page.
 *
 * Ключи вынесены в одно место, чтобы оба меню (database и page)
 * использовали одинаковые тексты без дублирования.
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
 * Создаёт action для confirm-кнопки в modal.
 *
 * Функция нужна для единообразной последовательности:
 * 1) mutation;
 * 2) success-notification;
 * 3) navigation после успешной конвертации.
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
