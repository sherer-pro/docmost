import { Container } from '@mantine/core';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
import DatabaseHeader from '@/features/database/components/header/database-header.tsx';
import { useGetDatabaseQuery } from '@/features/database/queries/database-query.ts';
import { useGetSpaceBySlugQuery } from '@/features/space/queries/space-query.ts';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '@/features/space/permissions/permissions.type.ts';
import { useSpaceAbility } from '@/features/space/permissions/use-space-ability.ts';
import { PageEditMode } from '@/features/user/types/user.types.ts';
import { userAtom } from '@/features/user/atoms/current-user-atom.ts';
import { getAppName } from '@/lib/config.ts';
import { useAtomValue } from 'jotai';

export default function DatabasePage() {
  const { t } = useTranslation();
  const { databaseId, spaceSlug } = useParams();
  const { data: database } = useGetDatabaseQuery(databaseId);
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const currentUser = useAtomValue(userAtom);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const readOnly = spaceAbility.cannot(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );

  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;

  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

  if (!databaseId || !spaceSlug) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {database?.name || t('Database')} - {getAppName()}
        </title>
      </Helmet>

      <DatabaseHeader
        spaceSlug={spaceSlug}
        spaceName={space?.name}
        databaseName={database?.name}
        readOnly={readOnly}
      />

      <Container size="xl" py="xl" pt={60}>
        {database?.spaceId && (
          <DatabaseTableView
            databaseId={databaseId}
            spaceId={database.spaceId}
            spaceSlug={spaceSlug}
            isEditable={isEditable}
          />
        )}
      </Container>
    </>
  );
}
