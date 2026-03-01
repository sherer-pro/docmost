import { Group } from '@mantine/core';
import { Link } from 'react-router-dom';
import classes from '@/features/page/components/header/page-header.module.css';
import { getSpaceUrl } from '@/lib/config.ts';
import DatabaseHeaderMenu from '@/features/database/components/header/database-header-menu.tsx';

interface DatabaseHeaderProps {
  databaseId: string;
  databasePageId?: string;
  spaceSlug: string;
  spaceName?: string;
  databaseName?: string;
  description?: string;
  readOnly?: boolean;
}

export default function DatabaseHeader({
  databaseId,
  databasePageId,
  spaceSlug,
  spaceName,
  databaseName,
  description,
  readOnly,
}: DatabaseHeaderProps) {
  return (
    <div className={classes.header}>
      <Group justify="space-between" h="100%" px="md" wrap="nowrap" className={classes.group}>
        <Group gap="xs" wrap="nowrap">
          <Link to={getSpaceUrl(spaceSlug)}>{spaceName || spaceSlug}</Link>
          <span>/</span>
          <span>{databaseName || 'Database'}</span>
        </Group>

        <Group justify="flex-end" h="100%" px="md" wrap="nowrap" gap="var(--mantine-spacing-xs)">
          <DatabaseHeaderMenu
            databaseId={databaseId}
            databasePageId={databasePageId}
            spaceSlug={spaceSlug}
            databaseName={databaseName}
            description={description}
            readOnly={readOnly}
          />
        </Group>
      </Group>
    </div>
  );
}
