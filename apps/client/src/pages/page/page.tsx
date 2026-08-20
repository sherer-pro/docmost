import { useLocation, useNavigate, useParams } from "react-router-dom";
import { usePageQuery } from "@/features/page/queries/page-query";
import { FullEditor } from "@/features/editor/full-editor";
import HistoryModal from "@/features/page-history/components/history-modal";
import { Helmet } from "react-helmet-async";
import PageHeader from "@/features/page/components/header/page-header.tsx";
import { extractPageSlugId } from "@/lib";
import { useTranslation } from "react-i18next";
import React, { lazy, Suspense, useEffect } from "react";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { IconAlertTriangle, IconFileOff } from "@tabler/icons-react";
import { Button, Container, Skeleton, Stack } from "@mantine/core";
import { Link } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import DocumentFieldsPanel from "@/features/page/components/document-fields/document-fields-panel.tsx";
import { TemplateEditingAlert } from "@/features/page/components/template-editing-alert.tsx";
import { TemplateInstanceAlert } from "@/features/page/components/template-instance-alert.tsx";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useSpaceQuery } from "@/features/space/queries/space-query";
import { resolveHeadingNumberingEnabled } from "@/features/page/utils/heading-numbering";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { DeferredAiDocumentContextSync } from "@/features/ai/components/deferred-ai-document-context-sync";
import { usePageTemplateCapabilitiesQuery } from "@/features/page-template/queries/page-template-query";

const MemoizedFullEditor = React.memo(FullEditor);
const MemoizedPageHeader = React.memo(PageHeader);
const MemoizedHistoryModal = React.memo(HistoryModal);
const LazyPageCommentSection = lazy(
  () => import("@/features/comment/components/page-comment-section"),
);

function PageSkeleton() {
  return (
    <Container size={900} py="xl" aria-busy="true">
      <Stack gap="lg">
        <Skeleton height={42} width="58%" radius="sm" />
        <Skeleton height={18} width="32%" radius="sm" />
        <Skeleton height={18} radius="sm" />
        <Skeleton height={18} radius="sm" />
        <Skeleton height={18} width="88%" radius="sm" />
        <Skeleton height={180} radius="md" />
      </Stack>
    </Container>
  );
}

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
            <Button
              variant="default"
              size="sm"
              mt="xs"
              onClick={resetErrorBoundary}
            >
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
  const [asideState, setAsideState] = useAtom(asideStateAtom);
  const [user] = useAtom(userAtom);

  const {
    data: page,
    isLoading,
    isError,
    error,
    refetch,
  } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const templateCapabilitiesQuery = usePageTemplateCapabilitiesQuery(
    page?.spaceId,
  );
  const templateCapabilities = templateCapabilitiesQuery.data;
  const { data: currentSpace } = useSpaceQuery(page?.spaceId ?? "");
  const pageCapabilities = page?.access?.capabilities;
  const canWritePage = pageCapabilities?.canWrite === true;
  const canEditPage =
    canWritePage &&
    (!page?.templateKind ||
      (templateCapabilitiesQuery.isSuccess &&
        !templateCapabilitiesQuery.isError &&
        templateCapabilities?.manageTemplate === true));
  const canMoveDeleteSharePage = pageCapabilities?.canMoveDeleteShare === true;
  const resolvedSpaceSlug = page?.space?.slug ?? routeSpaceSlug;
  const resolvedSpaceSettings = currentSpace?.settings ?? page?.space?.settings;
  const headingNumberingEnabled = resolveHeadingNumberingEnabled({
    pageId: page?.id,
    preferences: user?.settings?.preferences,
    spaceSettings: resolvedSpaceSettings,
  });
  const isCommentsAsideOpen =
    asideState.tab === "comments" && asideState.isAsideOpen;

  useEffect(() => {
    const shouldOpenCommentsAside = Boolean(
      (location.state as { openCommentsAside?: boolean } | null)
        ?.openCommentsAside,
    );

    if (!page?.id || !shouldOpenCommentsAside) {
      return;
    }

    setAsideState({ tab: "comments", isAsideOpen: true });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, page?.id, setAsideState]);

  if (isLoading) {
    return <PageSkeleton />;
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
            <Button
              component={Link}
              to="/home"
              variant="default"
              size="sm"
              mt="xs"
            >
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
        action={
          <Button
            variant="default"
            size="sm"
            mt="xs"
            onClick={() => void refetch()}
          >
            {t("Try again")}
          </Button>
        }
      />
    );
  }

  return (
    page && (
      <div>
        <DeferredAiDocumentContextSync
          pageId={page.id}
          spaceId={page.spaceId}
          spaceSlug={resolvedSpaceSlug}
          title={page.title}
          canWrite={canEditPage}
        />
        <Helmet>
          <title>{`${page?.icon || ""}  ${page?.title || t("untitled")}`}</title>
        </Helmet>

        <MemoizedPageHeader
          readOnly={!canEditPage}
          canMoveDeleteShare={canMoveDeleteSharePage}
        />

        <MemoizedFullEditor
          key={page.id}
          notice={
            page.templateKind ? (
              <TemplateEditingAlert
                pageId={page.id}
                kind={page.templateKind}
                editable={canEditPage}
              />
            ) : (
              <TemplateInstanceAlert pageId={page.id} editable={canWritePage} />
            )
          }
          metaPanel={
            <DocumentFieldsPanel page={page} readOnly={!canEditPage} />
          }
          footer={
            isCommentsAsideOpen ? undefined : (
              <Suspense fallback={null}>
                <LazyPageCommentSection pageId={page.id} />
              </Suspense>
            )
          }
          pageId={page.id}
          title={page.title}
          content={page.content}
          slugId={page.slugId}
          spaceSlug={resolvedSpaceSlug}
          spaceId={page.spaceId}
          dictionaryEnabled={
            resolvedSpaceSettings?.dictionary?.enabled === true
          }
          tagSettings={resolvedSpaceSettings?.tags}
          headingNumberingEnabled={headingNumberingEnabled}
          spaceHeadingNumberingEnabled={
            resolvedSpaceSettings?.headingNumbering?.enabled === true
          }
          readingTimeEnabled={
            resolvedSpaceSettings?.documentFields?.readingTime === true
          }
          templateKind={page.templateKind}
          editable={canEditPage}
        />
        <MemoizedHistoryModal pageId={page.id} />
      </div>
    )
  );
}
