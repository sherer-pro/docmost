import { Group } from '@mantine/core';
import classes from '@/features/page/components/header/page-header.module.css';
import DatabaseHeaderMenu from '@/features/database/components/header/database-header-menu.tsx';
import Breadcrumb from '@/features/page/components/breadcrumbs/breadcrumb.tsx';

interface DatabaseHeaderProps {
  databaseId: string;
  databasePageId?: string;
  spaceSlug: string;
  readOnly?: boolean;
}

export default function DatabaseHeader({
  databaseId,
  databasePageId,
  spaceSlug,
  readOnly,
}: DatabaseHeaderProps) {
  return (
    <div className={classes.header}>
      <Group justify="space-between" h="100%" px="md" wrap="nowrap" className={classes.group}>
        <Breadcrumb />

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
