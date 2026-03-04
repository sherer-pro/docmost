import { Container, Stack } from '@mantine/core';
import { JSONContent } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { buildDatabaseUrl } from '@/features/page/page.utils.ts';
import { resolvePageDatabaseIds } from '@/features/page/page-id-adapter.ts';
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
import { useDeferredCanonicalTitleUrlSync } from '@/features/editor/utils/canonical-title-url-sync.ts';
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
 * Converts a plain-text description to Tiptap JSON if there is no rich content.
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
  const routeIds = resolvePageDatabaseIds({ routeSlug: databaseSlug });

  // In modern routes the database is opened by the database page slug,
  // so we resolve the page first and read databaseId from it.
  const { data: databasePageBySlug } = usePageQuery({ pageId: routeIds.pageId });

  const resolvedIds = resolvePageDatabaseIds({
    pageId: databasePageBySlug?.id,
    slugId: databasePageBySlug?.slugId,
    databaseId: databasePageBySlug?.databaseId,
  });
  const databaseId = resolvedIds.databaseId;

  const { data: database } = useGetDatabaseQuery(databaseId);
  const databasePage = databasePageBySlug;
  const databasePageId = databasePage?.id ?? database?.pageId;
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
   * Width mode precedence for a database page mirrors a regular page:
   * 1) database-page local setting;
   * 2) user default preference;
   * 3) safe fallback to `false`.
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


  const { onTitleFocusChange, syncCanonicalUrl } = useDeferredCanonicalTitleUrlSync(
    useCallback(
      (nextUrl: string) => {
        navigate(nextUrl, { replace: true });
      },
      [navigate],
    ),
  );

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
  }, [database?.id]);

  /**
   * Unified autosave of database metadata (title/description).
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
         * After rename, the backend can return a new slug for the linked database page.
         * The canonical URL synchronization helper applies the same focus/blur/deferred
         * algorithm as page title editor, so URL updates are consistent across editors.
         */
        if (typeof patch.name === 'string' && updatedDatabase.pageSlugId && spaceSlug) {
          const currentUrl = `${location.pathname}${location.search}${location.hash}`;
          const canonicalPath = buildDatabaseUrl(
            spaceSlug,
            updatedDatabase.pageSlugId,
            updatedDatabase.name ?? patch.name,
          );

          syncCanonicalUrl({
            currentUrl,
            nextUrl: `${canonicalPath}${location.search}${location.hash}`,
          });
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
      draftName,
      location.hash,
      location.pathname,
      location.search,
      space?.id,
      spaceSlug,
      syncCanonicalUrl,
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
      /**
       * Сравниваем с локальным черновиком, а не только с последним ответом API:
       * это защищает от лишних PATCH, когда autosave срабатывает повторно
       * до прихода свежего состояния с сервера.
       */
      const currentSerialized = JSON.stringify(draftDescription.json);
      const nextSerialized = JSON.stringify(payload.json);
      const nextText = payload.text.trim();
      const currentText = draftDescription.text.trim();

      if (currentSerialized === nextSerialized && currentText === nextText) {
        return;
      }

      await commitMetaChanges({
        description: payload.text,
        descriptionContent: payload.json,
      });
    },
    [commitMetaChanges, draftDescription.json, draftDescription.text],
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
              databaseId={databaseId}
              value={draftName}
              editable={isEditable}
              onValueChange={setDraftName}
              onAutoSave={onTitleAutoSave}
              onFocusChange={onTitleFocusChange}
            />
          </div>


          {databasePage && (
            <DocumentFieldsPanel
              page={databasePage}
              readOnly={readOnly}
            />
          )}

          {databasePageId && (
            <DatabaseDescriptionEditor
              pageId={databasePageId}
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
