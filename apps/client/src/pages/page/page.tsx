import { useLocation, useNavigate, useParams } from "react-router-dom";
import { usePageQuery } from "@/features/page/queries/page-query";
import { FullEditor } from "@/features/editor/full-editor";
import HistoryModal from "@/features/page-history/components/history-modal";
import { Helmet } from "react-helmet-async";
import PageHeader from "@/features/page/components/header/page-header.tsx";
import { extractPageSlugId } from "@/lib";
import { useTranslation } from "react-i18next";
import React from "react";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { IconAlertTriangle, IconFileOff } from "@tabler/icons-react";
import { Button } from "@mantine/core";
import { Link } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import DocumentFieldsPanel from "@/features/page/components/document-fields/document-fields-panel.tsx";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import PageCommentSection from "@/features/comment/components/page-comment-section";

const MemoizedFullEditor = React.memo(FullEditor);
const MemoizedPageHeader = React.memo(PageHeader);
const MemoizedHistoryModal = React.memo(HistoryModal);

export default function Page() {
  const { t } = useTranslation();
  const { pageSlug, spaceSlug } = useParams();

  return (
    <ErrorBoundary
      resetKeys={[pageSlug]}
      fallbackRender={({ resetErrorBoundary }) => (
        <EmptyState
          icon={IconAlertTriangle}
          title={t("Failed to load page. An error occurred.")}
          action={
            <Button variant="default" size="sm" mt="xs" onClick={resetErrorBoundary}>
              {t("Try again")}
            </Button>
          }
        />
      )}
    >
      <PageContent pageSlug={pageSlug} routeSpaceSlug={spaceSlug} />
    </ErrorBoundary>
  );
}

function PageContent({
  pageSlug,
  routeSpaceSlug,
}: {
  pageSlug: string | undefined;
  routeSpaceSlug: string | undefined;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setAsideState] = useAtom(asideStateAtom);

  const {
    data: page,
    isLoading,
    isError,
    error,
  } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const pageCapabilities = page?.access?.capabilities;
  const canWritePage = pageCapabilities?.canWrite === true;
  const canMoveDeleteSharePage =
    pageCapabilities?.canMoveDeleteShare === true;
  const resolvedSpaceSlug = page?.space?.slug ?? routeSpaceSlug;

  useEffect(() => {
    const shouldOpenCommentsAside = Boolean(
      (location.state as { openCommentsAside?: boolean } | null)?.openCommentsAside,
    );

    if (!page?.id || !shouldOpenCommentsAside) {
      return;
    }

    setAsideState({ tab: "comments", isAsideOpen: true });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, page?.id, setAsideState]);

  if (isLoading) {
    return <></>;
  }

  if (isError || !page) {
    if ([401, 403, 404].includes(error?.["status"])) {
      return (
        <EmptyState
          icon={IconFileOff}
          title={t("Page not found")}
          description={t(
            "This page may have been deleted, moved, or you may not have access.",
          )}
          action={
            <Button component={Link} to="/home" variant="default" size="sm" mt="xs">
              {t("Go to homepage")}
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={IconFileOff}
        title={t("Error fetching page data.")}
      />
    );
  }

  return (
    page && (
      <div>
        <Helmet>
          <title>{`${page?.icon || ""}  ${page?.title || t("untitled")}`}</title>
        </Helmet>

        <MemoizedPageHeader
          readOnly={!canWritePage}
          canMoveDeleteShare={canMoveDeleteSharePage}
        />

        <MemoizedFullEditor
          key={page.id}
          metaPanel={
            <DocumentFieldsPanel
              page={page}
              readOnly={!canWritePage}
            />
          }
          footer={<PageCommentSection pageId={page.id} />}
          pageId={page.id}
          title={page.title}
          content={page.content}
          slugId={page.slugId}
          spaceSlug={resolvedSpaceSlug}
          spaceId={page.spaceId}
          dictionaryEnabled={page.space?.settings?.dictionary?.enabled === true}
          editable={canWritePage}
        />
        <MemoizedHistoryModal pageId={page.id} />
      </div>
    )
  );
}
