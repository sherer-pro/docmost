import { Container, Stack } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { buildDatabaseUrl } from "@/features/page/page.utils.ts";
import { DatabaseTableView } from "@/features/database/components/database-table-view";
import { DatabaseDescriptionEditor } from "@/features/database/components/editors/database-description-editor.tsx";
import { DatabaseTitleEditor } from "@/features/database/components/editors/database-title-editor.tsx";
import DatabaseHeader from "@/features/database/components/header/database-header.tsx";
import HistoryModal from "@/features/page-history/components/history-modal.tsx";
import DocumentFieldsPanel from "@/features/page/components/document-fields/document-fields-panel.tsx";
import { useUpdateDatabaseMutation } from "@/features/database/queries/database-query.ts";
import { IUpdateDatabasePayload } from "@/features/database/types/database.types.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { normalizePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
import { useDeferredCanonicalTitleUrlSync } from "@/features/editor/utils/canonical-title-url-sync.ts";
import { getAppName } from "@/lib/config.ts";
import { useAtomValue } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useSetAtom } from "jotai";
import classes from "./database-page.module.css";
import { useDatabasePageContext } from "@/features/database/hooks/use-database-page-context.ts";
import PageCommentSection from "@/features/comment/components/page-comment-section";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function DatabasePage() {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const setAsideState = useSetAtom(asideStateAtom);
  const {
    databaseId,
    databasePageId,
    pageByRoute: databasePage,
    database,
  } = useDatabasePageContext();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const { mutateAsync: updateDatabaseMutationAsync } =
    useUpdateDatabaseMutation(space?.id, databaseId);
  const currentUser = useAtomValue(currentUserAtom);
  const [draftName, setDraftName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const lastRequestVersionRef = useRef(0);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const readOnly = spaceAbility.cannot(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );

  const userPageEditMode = normalizePageEditMode(
    currentUser?.user?.settings?.preferences?.pageEditMode,
  );

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
      (location.state as { openCommentsAside?: boolean } | null)
        ?.openCommentsAside,
    );

    if (!databasePageId || !shouldOpenCommentsAside) {
      return;
    }

    setAsideState({ tab: "comments", isAsideOpen: true });
    navigate(location.pathname, { replace: true, state: null });
  }, [
    databasePageId,
    location.pathname,
    location.state,
    navigate,
    setAsideState,
  ]);

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

    setDraftName(database.name ?? "");
    setSaveState("idle");
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
      setSaveState("saving");

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
        /**
         * Sync URL only from server-confirmed data:
         * - slugId is taken strictly from PATCH response;
         * - if pageSlugId is missing, keep current URL to avoid stale canonical path.
         */
        if (
          typeof patch.name === "string" &&
          spaceSlug &&
          updatedDatabase.pageSlugId
        ) {
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
        setSaveState("saved");
      } catch {
        if (requestVersion !== lastRequestVersionRef.current) {
          return;
        }

        setSaveState("error");
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
      if (
        !normalizedTitle ||
        normalizedTitle === (database?.name ?? "").trim()
      ) {
        return;
      }

      await commitMetaChanges({ name: normalizedTitle });
    },
    [commitMetaChanges, database?.name],
  );

  const databaseDisplayName = useMemo(() => {
    const normalizedDraft = draftName.trim();
    if (normalizedDraft) {
      return normalizedDraft;
    }

    return database?.name?.trim() || t("database.editor.untitled");
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
        databasePageId={databasePageId}
        spaceSlug={spaceSlug}
        readOnly={readOnly}
      />

      {database?.pageId && (
        <HistoryModal
          pageId={database.pageId}
          pageTitle={databaseDisplayName}
        />
      )}

      <Container
        fluid={resolvedFullWidth}
        size={!resolvedFullWidth ? "xl" : undefined}
        py="xl"
        pt={60}
      >
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
            <DocumentFieldsPanel page={databasePage} readOnly={readOnly} />
          )}

          {databasePageId && (
            <DatabaseDescriptionEditor
              key={databasePageId}
              pageId={databasePageId}
              content={databasePage?.content}
              editable={isEditable}
              cacheSlugId={databasePage?.slugId}
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

        {databasePageId && <PageCommentSection pageId={databasePageId} />}
      </Container>
    </>
  );
}



