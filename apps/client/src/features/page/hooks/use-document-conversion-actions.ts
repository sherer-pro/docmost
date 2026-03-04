import { createElement } from 'react';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconArrowsExchange } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import {
  createConvertDatabaseToPageAction,
  DATABASE_TO_PAGE_TRANSLATION_KEYS,
} from '@/features/page/hooks/document-conversion-actions.shared.ts';

interface OpenConvertDatabaseToPageModalParams {
  isPending: boolean;
  onConfirm: () => Promise<void>;
  t: (key: string) => string;
}

/**
 * Открывает единый confirm modal для конвертации database -> page.
 */
export function openConvertDatabaseToPageModal({
  isPending,
  onConfirm,
  t,
}: OpenConvertDatabaseToPageModalParams) {
  modals.openConfirmModal({
    title: t(DATABASE_TO_PAGE_TRANSLATION_KEYS.confirmTitle),
    centered: true,
    children: t(DATABASE_TO_PAGE_TRANSLATION_KEYS.confirmDescription),
    labels: {
      confirm: t(DATABASE_TO_PAGE_TRANSLATION_KEYS.confirmAction),
      cancel: t(DATABASE_TO_PAGE_TRANSLATION_KEYS.cancelAction),
    },
    confirmProps: {
      loading: isPending,
      leftSection: createElement(IconArrowsExchange, { size: 14 }),
    },
    onConfirm,
  });
}

interface UseDocumentConversionActionsParams {
  spaceSlug?: string;
  pageTitle?: string;
  isConvertingDatabaseToPage: boolean;
  convertDatabaseToPageAsync: () => Promise<{ slugId?: string } | undefined>;
}

/**
 * Общий hook для сценария конвертации database -> page.
 *
 * Вынесенный hook нужен для унификации поведения в двух меню:
 * - database-header-menu;
 * - page-header-menu.
 */
export function useDocumentConversionActions({
  spaceSlug,
  pageTitle,
  isConvertingDatabaseToPage,
  convertDatabaseToPageAsync,
}: UseDocumentConversionActionsParams) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const openConvertDatabaseToPageConfirm = () => {
    const onConfirm = createConvertDatabaseToPageAction({
      convertDatabaseToPageAsync,
      onNotifySuccess: () => {
        notifications.show({ message: t(DATABASE_TO_PAGE_TRANSLATION_KEYS.successMessage) });
      },
      onNavigateAfterSuccess: (result) => {
        if (!spaceSlug || !result.slugId) {
          return;
        }

        navigate(buildPageUrl(spaceSlug, result.slugId, pageTitle ?? ''));
      },
    });

    openConvertDatabaseToPageModal({
      isPending: isConvertingDatabaseToPage,
      onConfirm,
      t,
    });
  };

  return {
    isConvertingDatabaseToPage,
    openConvertDatabaseToPageConfirm,
  };
}
