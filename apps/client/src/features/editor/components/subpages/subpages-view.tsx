import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  Anchor,
  Badge,
  Group,
  Paper,
  Skeleton,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronRight,
  IconFileDescription,
  IconSitemap,
} from "@tabler/icons-react";
import { useGetSidebarPagesQuery } from "@/features/page/queries/page-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import classes from "./subpages.module.css";
import {
  buildPageUrl,
  buildSharedPageUrl,
} from "@/features/page/page.utils.ts";
import { useTranslation } from "react-i18next";
import { sortPositionKeys } from "@/features/page/tree/utils/utils";
import { useSharedPageSubpages } from "@/features/share/hooks/use-shared-page-subpages";

export default function SubpagesView(props: NodeViewProps) {
  const { editor } = props;
  const { spaceSlug, shareId } = useParams();
  const { t } = useTranslation();

  //@ts-ignore
  const currentPageId = editor.storage.pageId;

  // Get subpages from shared tree if we're in a shared context
  const sharedSubpages = useSharedPageSubpages(currentPageId);

  const { data, isLoading, error } = useGetSidebarPagesQuery({
    pageId: currentPageId,
  });

  const subpages = useMemo(() => {
    // If we're in a shared context, use the shared subpages
    if (shareId && sharedSubpages) {
      return sharedSubpages.map((node) => ({
        id: node.value,
        slugId: node.slugId,
        title: node.name,
        icon: node.icon,
        position: node.position,
      }));
    }

    // Otherwise use the API data
    if (!data?.pages) return [];
    const allPages = data.pages
      .flatMap((page) => page.items)
      // In the Subpages block we display only regular pages.
      .filter((node) => node.nodeType === "page");

    return sortPositionKeys(allPages);
  }, [data, shareId, sharedSubpages]);

  const isSubpagesLoading = isLoading && !shareId;
  const hasSubpagesError = Boolean(error && !shareId);

  return (
    <NodeViewWrapper data-drag-handle className={classes.nodeView}>
      <Paper
        withBorder
        radius="md"
        className={classes.container}
        role="navigation"
        aria-label={t("Subpages")}
        aria-busy={isSubpagesLoading}
        data-state={
          isSubpagesLoading
            ? "loading"
            : hasSubpagesError
              ? "error"
              : subpages.length === 0
                ? "empty"
                : "ready"
        }
      >
        <div className={classes.header}>
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon
              className={classes.headerIcon}
              variant="light"
              size="md"
              radius="md"
            >
              <IconSitemap size={17} aria-hidden />
            </ThemeIcon>
            <Text className={classes.heading} role="heading" aria-level={3}>
              {t("Subpages")}
            </Text>
          </Group>

          {isSubpagesLoading ? (
            <Skeleton width={28} height={20} radius="xl" />
          ) : (
            <Badge
              className={classes.count}
              variant="light"
              size="sm"
              aria-label={`${t("Subpages")}: ${subpages.length}`}
            >
              {subpages.length}
            </Badge>
          )}
        </div>

        {isSubpagesLoading ? (
          <div className={classes.loadingList} aria-hidden>
            {[0, 1, 2].map((item) => (
              <div className={classes.loadingRow} key={item}>
                <Skeleton circle height={28} />
                <Skeleton height={12} radius="xl" width={`${72 - item * 9}%`} />
              </div>
            ))}
          </div>
        ) : hasSubpagesError ? (
          <div className={`${classes.state} ${classes.errorState}`} role="status">
            <IconAlertCircle size={20} aria-hidden />
            <Text size="sm">{t("Failed to load subpages")}</Text>
          </div>
        ) : subpages.length === 0 ? (
          <div className={classes.state}>
            <IconFileDescription size={20} aria-hidden />
            <Text size="sm">{t("No subpages")}</Text>
          </div>
        ) : (
          <ul className={classes.list}>
            {subpages.map((page) => (
              <li className={classes.item} key={page.id}>
                <Anchor
                  component={Link}
                  to={
                    shareId
                      ? buildSharedPageUrl({
                          shareId,
                          pageSlugId: page.slugId,
                          pageTitle: page.title,
                        })
                      : buildPageUrl(spaceSlug, page.slugId, page.title)
                  }
                  underline="never"
                  className={classes.pageLink}
                  draggable={false}
                >
                  <span className={classes.pageIcon} aria-hidden>
                    {page.icon || <IconFileDescription size={17} />}
                  </span>
                  <span className={classes.pageTitle}>
                    {page.title || t("untitled")}
                  </span>
                  <IconChevronRight
                    className={classes.chevron}
                    size={17}
                    aria-hidden
                  />
                </Anchor>
              </li>
            ))}
          </ul>
        )}
      </Paper>
    </NodeViewWrapper>
  );
}
