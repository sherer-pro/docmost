import { Container, Stack } from '@mantine/core';
import { JSONContent } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { extractPageSlugId } from '@/lib';
import { buildDatabaseUrl } from '@/features/page/page.utils.ts';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
import {
  DatabaseDescriptionEditor,
  DatabaseDescriptionPayload,
} from '@/features/database/components/editors/database-description-editor.tsx';
import { DatabaseTitleEditor } from '@/features/database/components/editors/database-title-editor.tsx';
import DatabaseHeader from '@/features/database/components/header/database-header.tsx';
import HistoryModal from '@/features/page-history/components/history-modal.tsx';
import DocumentFieldsPanel from '@/features/page/components/document-fields/document-fields-panel.tsx';
import {
  useGetDatabaseQuery,
  useUpdateDatabaseMutation,
} from '@/features/database/queries/database-query.ts';
import { usePageQuery } from '@/features/page/queries/page-query';
import { IUpdateDatabasePayload } from '@/features/database/types/database.types.ts';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '@/features/space/permissions/permissions.type.ts';
import { useSpaceAbility } from '@/features/space/permissions/use-space-ability.ts';
import { useGetSpaceBySlugQuery } from '@/features/space/queries/space-query.ts';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom.ts';
import { PageEditMode } from '@/features/user/types/user.types.ts';
import { getAppName } from '@/lib/config.ts';
import { useAtomValue } from 'jotai';
import { asideStateAtom } from '@/components/layouts/global/hooks/atoms/sidebar-atom.ts';
import { useSetAtom } from 'jotai';
import classes from './database-page.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const EMPTY_DESCRIPTION_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Преобразует plain-text описание в Tiptap JSON, если rich-контент отсутствует.
 */
function getDescriptionDoc(
  richDescription?: unknown,
  plainDescription?: string | null,
): JSONContent {
  if (richDescription && typeof richDescription === 'object') {
    return richDescription as JSONContent;
  }

  const text = plainDescription?.trim();

  if (!text) {
    return EMPTY_DESCRIPTION_DOC;
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

export default function DatabasePage() {
  const { t } = useTranslation();
  const { databaseSlug, spaceSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const setAsideState = useSetAtom(asideStateAtom);
  const databasePageSlugId = extractPageSlugId(databaseSlug);

  // In modern routes the database is opened by the database page slug,
  // so we resolve the page first and read databaseId from it.
  const { data: databasePageBySlug } = usePageQuery({ pageId: databasePageSlugId });
  const databaseId = databasePageBySlug?.databaseId;

  const { data: database } = useGetDatabaseQuery(databaseId);
  const databasePage = databasePageBySlug;
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const { mutateAsync: updateDatabaseMutationAsync } = useUpdateDatabaseMutation(
    space?.id,
    databaseId,
  );
  const currentUser = useAtomValue(currentUserAtom);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState<DatabaseDescriptionPayload>({
    json: EMPTY_DESCRIPTION_DOC,
    text: '',
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const lastRequestVersionRef = useRef(0);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const readOnly = spaceAbility.cannot(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );

  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;

  /**
   * Приоритет режима ширины для database-page синхронизирован с обычной Page:
   * 1) локальная настройка database-page;
   * 2) пользовательская настройка по умолчанию;
   * 3) fallback в `false`.
   */
  const resolvedFullWidth =
    databasePage?.settings?.fullPageWidth ??
    currentUser?.user?.settings?.preferences?.fullPageWidth ??
    false;

  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

  useEffect(() => {
    const shouldOpenCommentsAside = Boolean(
      (location.state as { openCommentsAside?: boolean } | null)?.openCommentsAside,
    );

    if (!database?.pageId || !shouldOpenCommentsAside) {
      return;
    }

    setAsideState({ tab: 'comments', isAsideOpen: true });
    navigate(location.pathname, { replace: true, state: null });
  }, [database?.pageId, location.pathname, location.state, navigate, setAsideState]);

  useEffect(() => {
    if (!database) {
      return;
    }

    setDraftName(database.name ?? '');
    setDraftDescription({
      json: getDescriptionDoc(database.descriptionContent, database.description),
      text: database.description ?? '',
    });
    setSaveState('idle');
  }, [database?.id, database?.updatedAt]);

  /**
   * Унифицированный автосейв метаданных базы (заголовок/описание).
   */
  const commitMetaChanges = useCallback(
    async (patch: IUpdateDatabasePayload) => {
      if (!databaseId || !space?.id || Object.keys(patch).length === 0) {
        return;
      }

      const requestVersion = lastRequestVersionRef.current + 1;
      lastRequestVersionRef.current = requestVersion;
      setSaveState('saving');

      try {
        const updatedDatabase = await updateDatabaseMutationAsync(patch);

        if (requestVersion !== lastRequestVersionRef.current) {
          return;
        }

        /**
         * После rename backend может вернуть новый slug связанной страницы базы.
         * Сразу переключаем URL на canonical маршрут, чтобы клиент/адресная строка
         * оставались синхронизированы без перезагрузки.
         */
        if (
          typeof patch.name === 'string' &&
          spaceSlug &&
          updatedDatabase.pageSlugId &&
          updatedDatabase.pageSlugId !== databasePageSlugId
        ) {
          navigate(
            buildDatabaseUrl(
              spaceSlug,
              updatedDatabase.pageSlugId,
              updatedDatabase.name,
            ),
          );
        }

        setDraftName(updatedDatabase.name ?? draftName);
        setDraftDescription({
          json: getDescriptionDoc(
            updatedDatabase.descriptionContent,
            updatedDatabase.description,
          ),
          text: updatedDatabase.description ?? '',
        });
        setSaveState('saved');
      } catch {
        if (requestVersion !== lastRequestVersionRef.current) {
          return;
        }

        setSaveState('error');
      }
    },
    [
      databaseId,
      databasePageSlugId,
      draftName,
      navigate,
      space?.id,
      spaceSlug,
      updateDatabaseMutationAsync,
    ],
  );

  const onTitleAutoSave = useCallback(
    async (nextTitle: string) => {
      const normalizedTitle = nextTitle.trim();
      if (!normalizedTitle || normalizedTitle === (database?.name ?? '').trim()) {
        return;
      }

      await commitMetaChanges({ name: normalizedTitle });
    },
    [commitMetaChanges, database?.name],
  );

  const onDescriptionAutoSave = useCallback(
    async (payload: DatabaseDescriptionPayload) => {
      const currentSerialized = JSON.stringify(
        getDescriptionDoc(database?.descriptionContent, database?.description),
      );
      const nextSerialized = JSON.stringify(payload.json);
      const nextText = payload.text.trim();
      const currentText = (database?.description ?? '').trim();

      if (currentSerialized === nextSerialized && nextText === currentText) {
        return;
      }

      await commitMetaChanges({
        description: payload.text,
        descriptionContent: payload.json,
      });
    },
    [commitMetaChanges, database?.description, database?.descriptionContent],
  );

  const databaseDisplayName = useMemo(() => {
    const normalizedDraft = draftName.trim();
    if (normalizedDraft) {
      return normalizedDraft;
    }

    return database?.name?.trim() || t('database.editor.untitled');
  }, [database?.name, draftName, t]);

  if (!databaseId || !spaceSlug) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {databaseDisplayName} - {getAppName()}
        </title>
      </Helmet>

      <DatabaseHeader
        databaseId={databaseId}
        databasePageId={databasePage?.id}
        spaceSlug={spaceSlug}
        databaseName={databaseDisplayName}
        readOnly={readOnly}
      />

      {database?.pageId && <HistoryModal pageId={database.pageId} pageTitle={databaseDisplayName} />}

      <Container fluid={resolvedFullWidth} size={!resolvedFullWidth ? 'xl' : undefined} py="xl" pt={60}>
        <Stack gap="xs" mb="md">
          <div className={classes.titleEditorContainer}>
            <DatabaseTitleEditor
              value={draftName}
              editable={isEditable}
              onValueChange={setDraftName}
              onAutoSave={onTitleAutoSave}
            />
          </div>


          {databasePage && (
            <DocumentFieldsPanel
              page={databasePage}
              readOnly={readOnly}
            />
          )}

          {database?.pageId && (
            <DatabaseDescriptionEditor
              pageId={database.pageId}
              value={draftDescription.json}
              editable={isEditable}
              onValueChange={setDraftDescription}
              onAutoSave={onDescriptionAutoSave}
            />
          )}
        </Stack>

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
