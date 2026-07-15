import { Group, Menu } from '@mantine/core';
import {
  IconArrowsHorizontal,
  IconFileExport,
  IconHistory,
  IconLink,
  IconMarkdown,
  IconMessage,
  IconPrinter,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { PageWidthToggle } from '@/features/user/components/page-width-pref.tsx';
import { HeadingNumberingMenuItems } from '@/features/common/header/heading-numbering-menu-items';
import { Editor } from '@tiptap/core';
import { PageSettings } from '@/features/page/types/page.types';
import { ISpaceSettings } from '@/features/space/types/space.types';

interface DocumentCommonActionItemsProps {
  onCopyLink: () => void;
  copyLinkLabel?: string;
  onCopyAsMarkdown?: () => void;
  onCopyMarkdownWithComments?: () => void;
  onOpenHistory?: () => void;
  onOpenExport?: () => void;
  onOpenAccess?: () => void;
  accessLabel?: string;
  onPrint?: () => void;
  disableExport?: boolean;
  pageId?: string;
  databasePageId?: string;
  fullPageWidth: boolean;
  headingNumbering?: {
    pageId: string;
    spaceId: string;
    pageSettings?: PageSettings;
    spaceSettings?: ISpaceSettings;
    editor: Editor | null;
    canWrite: boolean;
  };
}

/**
 * Common document menu items use the page-scope switch,
 * so that the width can be overridden at the level of a specific page.
 */
export function DocumentCommonActionItems({
  onCopyLink,
  copyLinkLabel,
  onCopyAsMarkdown,
  onCopyMarkdownWithComments,
  onOpenHistory,
  onOpenExport,
  onOpenAccess,
  accessLabel,
  onPrint,
  disableExport,
  pageId,
  databasePageId,
  fullPageWidth,
  headingNumbering,
}: DocumentCommonActionItemsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Menu.Item leftSection={<IconLink size={16} />} onClick={onCopyLink}>
        {copyLinkLabel ?? t('Copy link')}
      </Menu.Item>

      {onCopyAsMarkdown && (
        <Menu.Item leftSection={<IconMarkdown size={16} />} onClick={onCopyAsMarkdown}>
          {t('Copy as Markdown')}
        </Menu.Item>
      )}

      {onCopyMarkdownWithComments && (
        <Menu.Item
          leftSection={<IconMessage size={16} />}
          onClick={onCopyMarkdownWithComments}
        >
          {t('Copy Markdown with comments')}
        </Menu.Item>
      )}

      <Menu.Divider />

      {onOpenAccess && (
        <Menu.Item leftSection={<IconUsersGroup size={16} />} onClick={onOpenAccess}>
          {accessLabel ?? t('page.access.menu', { keySeparator: false })}
        </Menu.Item>
      )}

      {onOpenAccess && <Menu.Divider />}

      <Menu.Item leftSection={<IconArrowsHorizontal size={16} />}>
        <Group wrap="nowrap">
          <PageWidthToggle
            label={t('Full width')}
            scope="page"
            pageId={pageId ?? databasePageId}
            checked={fullPageWidth}
          />
        </Group>
      </Menu.Item>

      {headingNumbering && (
        <HeadingNumberingMenuItems {...headingNumbering} />
      )}

      {onOpenHistory && (
        <Menu.Item leftSection={<IconHistory size={16} />} onClick={onOpenHistory}>
          {t('Page history')}
        </Menu.Item>
      )}

      <Menu.Divider />

      {onOpenExport && (
        <Menu.Item
          leftSection={<IconFileExport size={16} />}
          onClick={onOpenExport}
          disabled={disableExport}
        >
          {t('Export')}
        </Menu.Item>
      )}

      {onPrint && (
        <Menu.Item leftSection={<IconPrinter size={16} />} onClick={onPrint}>
          {t('Print PDF')}
        </Menu.Item>
      )}
    </>
  );
}
