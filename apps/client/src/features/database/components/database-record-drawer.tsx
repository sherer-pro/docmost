import { lazy, Suspense, useEffect, useRef } from "react";
import {
  Anchor,
  Button,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePageQuery } from "@/features/page/queries/page-query";
import DocumentFieldsPanel from "@/features/page/components/document-fields/document-fields-panel";
import PageEditor from "@/features/editor/page-editor";
import { TitleEditor } from "@/features/editor/title-editor";
import { IsolatedEditorScope } from "@/features/editor/isolated-editor-scope";
import { useAtom, useAtomValue } from "jotai";
import {
  pageEditorAtom,
  titleEditorAtom,
  pageEditorUnsyncedChangesAtom,
  yjsConnectionStatusAtom,
} from "@/features/editor/atoms/editor-atoms";
import { searchAndReplaceStateAtom } from "@/features/editor/components/search-and-replace/atoms/search-and-replace-state-atom";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms";
import { showCommentPopupAtom } from "@/features/comment/atoms/comment-atom";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { PageStateSegmentedControl } from "@/features/user/components/page-state-pref";
import { useSpaceQuery } from "@/features/space/queries/space-query";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { resolveHeadingNumberingEnabled } from "@/features/page/utils/heading-numbering";
import { EmptyState } from "@/components/ui/empty-state";
import HistoryModal from "@/features/page-history/components/history-modal";
import { IconFileOff } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { DatabaseViewState } from "@docmost/api-contract";
import { getDatabaseRows } from "../services/database-service";
import { useDatabaseRowContextQuery } from "../queries/database-table-query";

type RecordScope = {
  databaseId: string;
  viewState: DatabaseViewState;
  viewId?: string;
  groupKey?: string;
};

const Comments = lazy(
  () => import("@/features/comment/components/page-comment-section"),
);

type RecordDrawerProps = {
  pageId: string | null;
  scope: RecordScope;
  spaceSlug: string;
  isEditable: boolean;
  onNavigate: (pageId: string) => void;
  onClose: () => void;
};

export function DatabaseRecordDrawer(props: RecordDrawerProps) {
  return props.pageId ? (
    <IsolatedEditorScope key={props.pageId}>
      <ScopedRecordDrawer {...props} />
    </IsolatedEditorScope>
  ) : null;
}

function ScopedRecordDrawer({
  pageId,
  scope,
  spaceSlug,
  isEditable,
  onNavigate,
  onClose,
}: RecordDrawerProps) {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  const editor = useAtomValue(pageEditorAtom);
  const [find, setFind] = useAtom(searchAndReplaceStateAtom);
  const history = useAtomValue(historyAtoms);
  const commentPopup = useAtomValue(showCommentPopupAtom);
  return (
    <Drawer
      opened={Boolean(pageId)}
      onClose={onClose}
      position="right"
      size="xl"
      title={t("dbBoard.record")}
      closeButtonProps={{ "aria-label": t("Close") }}
      closeOnEscape={false}
      closeOnClickOutside={false}
    >
      <div
        ref={content}
        onKeyDown={(event) => {
          if (!content.current?.contains(event.target as Node)) return;
          if (
            !event.defaultPrevented &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "f" &&
            editor
          ) {
            event.preventDefault();
            event.stopPropagation();
            document.dispatchEvent(
              new CustomEvent("openFindDialogFromEditor", {
                detail: { editor },
              }),
            );
          } else if (event.key === "Escape" && !event.defaultPrevented) {
            if (find.isOpen) {
              event.preventDefault();
              event.stopPropagation();
              setFind({ isOpen: false });
            } else if (
              !history &&
              !commentPopup &&
              !(event.target as Element).closest(
                'input,textarea,[contenteditable="true"]',
              ) &&
              !Array.from(
                document.querySelectorAll(
                  '#slash-command, #emoji-command, [role="menu"]',
                ),
              ).some((element) => element.getClientRects().length > 0)
            )
              onClose();
          }
        }}
      >
        {pageId && (
          <Record
            key={pageId}
            pageId={pageId}
            scope={scope}
            spaceSlug={spaceSlug}
            isEditable={isEditable}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </Drawer>
  );
}

function Record({
  pageId,
  scope,
  spaceSlug,
  isEditable,
  onNavigate,
}: {
  pageId: string;
  scope: RecordScope;
  spaceSlug: string;
  isEditable: boolean;
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: page, isPending, isError, refetch } = usePageQuery({ pageId });
  const { data: space } = useSpaceQuery(page?.spaceId);
  const user = useAtomValue(currentUserAtom);
  const context = useDatabaseRowContextQuery(pageId);
  const state = JSON.stringify(scope.viewState);
  const neighbors = useQuery({
    queryKey: [
      "database",
      scope.databaseId,
      "neighbors",
      pageId,
      state,
      scope.viewId,
      scope.groupKey,
    ],
    queryFn: async () => {
      const params = {
        viewState: state,
        viewId: scope.viewId,
        groupKey: scope.groupKey,
        limit: 1,
        neighborOf: pageId,
      };
      const values = await Promise.all(
        (["previous", "next"] as const).map((neighborDirection) =>
          getDatabaseRows(scope.databaseId, { ...params, neighborDirection }),
        ),
      );
      return values.map(
        (response) =>
          (Array.isArray(response) ? response : response.items)[0]?.pageId,
      );
    },
  });
  const [, setHistory] = useAtom(historyAtoms);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const unsynced = useAtomValue(pageEditorUnsyncedChangesAtom);
  const connection = useAtomValue(yjsConnectionStatusAtom);
  const aside = useAtomValue(asideStateAtom);
  const comments = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aside.isAsideOpen && aside.tab === "comments")
      comments.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [aside]);
  if (isPending || context.isPending)
    return <Loader aria-label={t("Loading...")} />;
  if (
    !page ||
    isError ||
    context.isError ||
    context.data?.database.id !== scope.databaseId
  )
    return (
      <EmptyState
        icon={IconFileOff}
        title={t("Failed to load page. An error occurred.")}
        action={<Button onClick={() => void refetch()}>{t("Retry")}</Button>}
      />
    );
  const canWrite = isEditable && page.access?.capabilities?.canWrite === true;
  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Button
            variant="default"
            disabled={!neighbors.data?.[0]}
            onClick={() => onNavigate(neighbors.data![0]!)}
          >
            {t("Previous")}
          </Button>
          <Button
            variant="default"
            disabled={!neighbors.data?.[1]}
            onClick={() => onNavigate(neighbors.data![1]!)}
          >
            {t("Next")}
          </Button>
        </Group>
        <Anchor component={Link} to={`/s/${spaceSlug}/p/${page.slugId}`}>
          {t("dbBoard.openPage")}
        </Anchor>
        <Button variant="subtle" onClick={() => setHistory(true)}>
          {t("Page history")}
        </Button>
        <Button
          variant="subtle"
          disabled={!editor}
          onClick={() =>
            document.dispatchEvent(
              new CustomEvent("openFindDialogFromEditor", {
                detail: { editor },
              }),
            )
          }
        >
          {t("Find")}
        </Button>
        {canWrite && <PageStateSegmentedControl pageId={page.id} size="xs" />}
      </Group>
      {connection === "disconnected" ? (
        <Text role="status" c="orange" size="sm">
          {t("Real-time editor connection lost. Retrying...")}
        </Text>
      ) : (
        unsynced > 0 && (
          <Text role="status" c="dimmed" size="sm">
            {t("Saving...")}
          </Text>
        )
      )}
      {neighbors.isError && (
        <Button variant="subtle" onClick={() => void neighbors.refetch()}>
          {t("Retry")}
        </Button>
      )}
      <DocumentFieldsPanel page={page} readOnly={!canWrite} />
      <Text size="xs" c="dimmed">
        {t("docBlocks.recordContent")}
      </Text>
      <TitleEditor
        title={page.title ?? ""}
        pageId={page.id}
        slugId={page.slugId}
        spaceSlug={spaceSlug}
        editable={canWrite}
        syncUrl={false}
      />
      <PageEditor
        pageId={page.id}
        content={page.content}
        editable={canWrite}
        cacheSlugId={page.slugId}
        spaceId={page.spaceId}
        showBottomSpacer={false}
        allowTemplateApplication={false}
        dictionaryEnabled={space?.settings?.dictionary?.enabled === true}
        tagSettings={space?.settings?.tags}
        canCreateInlineComments={canWrite}
        canManageDictionary={canWrite}
        headingNumberingEnabled={resolveHeadingNumberingEnabled({
          pageId,
          preferences: user?.user.settings?.preferences,
          spaceSettings: space?.settings,
        })}
        spaceHeadingNumberingEnabled={
          space?.settings?.headingNumbering?.enabled === true
        }
      />
      <div ref={comments}>
        <Suspense fallback={<Loader />}>
          <Comments pageId={page.id} readOnly={!canWrite} />
        </Suspense>
      </div>
      <HistoryModal
        pageId={page.id}
        pageTitle={page.title ?? ""}
        readOnly={!canWrite || !editor || !titleEditor}
      />
    </Stack>
  );
}
