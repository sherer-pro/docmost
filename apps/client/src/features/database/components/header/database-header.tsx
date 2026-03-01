import { Group } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classes from '@/features/page/components/header/page-header.module.css';
import { getSpaceUrl } from '@/lib/config.ts';
import DatabaseHeaderMenu from '@/features/database/components/header/database-header-menu.tsx';

interface DatabaseHeaderProps {
  databaseId: string;
  databasePageId?: string;
  spaceSlug: string;
  spaceName?: string;
  databaseName?: string;
  readOnly?: boolean;
}

export default function DatabaseHeader({
  databaseId,
  databasePageId,
  spaceSlug,
  spaceName,
  databaseName,
  readOnly,
}: DatabaseHeaderProps) {
  const { t } = useTranslation();
  const displayName = databaseName?.trim() || t('database.editor.untitled');

  return (
    <div className={classes.header}>
      <Group justify="space-between" h="100%" px="md" wrap="nowrap" className={classes.group}>
        <Group gap="xs" wrap="nowrap">
          <Link to={getSpaceUrl(spaceSlug)}>{spaceName || spaceSlug}</Link>
          <span>/</span>
          <span>{displayName}</span>
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
