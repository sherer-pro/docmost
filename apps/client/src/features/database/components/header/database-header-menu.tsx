import { ActionIcon, Menu } from '@mantine/core';
import { IconDots, IconLink } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PageStateSegmentedControl } from '@/features/user/components/page-state-pref.tsx';
import { useClipboard } from '@/hooks/use-clipboard';
import { getAppUrl } from '@/lib/config.ts';

interface DatabaseHeaderMenuProps {
  readOnly?: boolean;
}

export default function DatabaseHeaderMenu({ readOnly }: DatabaseHeaderMenuProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: 500 });
  const { spaceSlug, databaseId } = useParams();

  const handleCopyLink = () => {
    if (!spaceSlug || !databaseId) {
      return;
    }

    const databaseUrl = `${getAppUrl()}/s/${spaceSlug}/databases/${databaseId}`;
    clipboard.copy(databaseUrl);
    notifications.show({ message: t('Link copied') });
  };

  return (
    <>
      {!readOnly && <PageStateSegmentedControl size="xs" />}

      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={220}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <ActionIcon variant="subtle" color="dark" aria-label={t('Copy link')}>
            <IconDots size={20} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item leftSection={<IconLink size={16} />} onClick={handleCopyLink}>
            {t('Copy link')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
