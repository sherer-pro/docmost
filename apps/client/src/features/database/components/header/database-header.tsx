import { Group, Text, Tooltip } from '@mantine/core';
import { IconDatabase } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import classes from '@/features/page/components/header/page-header.module.css';
import DatabaseHeaderMenu from '@/features/database/components/header/database-header-menu.tsx';

interface DatabaseHeaderProps {
  databaseId: string;
  databasePageId?: string;
  spaceSlug: string;
  databaseName?: string;
  readOnly?: boolean;
}

export default function DatabaseHeader({
  databaseId,
  databasePageId,
  spaceSlug,
  databaseName,
  readOnly,
}: DatabaseHeaderProps) {
  const { t } = useTranslation();
  const displayName = databaseName?.trim() || t('database.editor.untitled');

  return (
    <div className={classes.header}>
      <Group justify="space-between" h="100%" px="md" wrap="nowrap" className={classes.group}>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={t('Database')} openDelay={250} withArrow>
            <IconDatabase size={18} stroke={2} color="var(--mantine-color-dimmed)" />
          </Tooltip>
          <Text fz="sm" truncate="end" maw={420} fw={500}>
            {displayName}
          </Text>
        </Group>

        <Group justify="flex-end" h="100%" px="md" wrap="nowrap" gap="var(--mantine-spacing-xs)">
          <DatabaseHeaderMenu
            databaseId={databaseId}
            databasePageId={databasePageId}
            spaceSlug={spaceSlug}
            readOnly={readOnly}
          />
        </Group>
      </Group>
    </div>
  );
}
