import { lazy, Suspense, useState } from "react";
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
import ReadonlyPageEditor from "@/features/editor/readonly-page-editor";
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

export function DatabaseRecordDrawer({
  pageId,
  scope,
  spaceSlug,
  isEditable,
  onNavigate,
  onClose,
}: {
  pageId: string | null;
  scope: RecordScope;
  spaceSlug: string;
  isEditable: boolean;
  onNavigate: (pageId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Drawer
      opened={Boolean(pageId)}
      onClose={onClose}
      position="right"
      size="xl"
      title={t("dbBoard.record")}
      closeButtonProps={{ "aria-label": t("Close") }}
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
  const [history, setHistory] = useState(false);
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
      </Group>
      {neighbors.isError && (
        <Button variant="subtle" onClick={() => void neighbors.refetch()}>
          {t("Retry")}
        </Button>
      )}
      <DocumentFieldsPanel
        page={page}
        readOnly={!isEditable || page.access?.capabilities?.canWrite !== true}
      />
      <Text size="xs" c="dimmed">
        {t("dbBoard.contentPreview")}
      </Text>
      <ReadonlyPageEditor
        title={page.title ?? ""}
        content={page.content}
        pageId={page.id}
      />
      <Suspense fallback={<Loader />}>
        <Comments
          pageId={page.id}
          readOnly={!isEditable || page.access?.capabilities?.canWrite !== true}
        />
      </Suspense>
      <HistoryModal
        pageId={page.id}
        pageTitle={page.title ?? ""}
        opened={history}
        onClose={() => setHistory(false)}
        readOnly
      />
    </Stack>
  );
}
