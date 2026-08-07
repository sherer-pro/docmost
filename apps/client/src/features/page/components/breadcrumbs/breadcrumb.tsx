import { useAtomValue } from "jotai";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import React, { useCallback, useEffect, useState } from "react";
import {
  buildTree,
  findBreadcrumbPath,
  findTreeNodesByIds,
  mergeTreeNodeMetadata,
  orderBreadcrumbNodes,
} from "@/features/page/tree/utils";
import {
  Button,
  Anchor,
  Popover,
  Breadcrumbs,
  ActionIcon,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCornerDownRightDouble, IconDots } from "@tabler/icons-react";
import { Link, useParams } from "react-router-dom";
import classes from "./breadcrumb.module.css";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { buildDatabaseUrl, buildPageUrl } from "@/features/page/page.utils.ts";
import {
  usePageBreadcrumbsQuery,
  usePageQuery,
} from "@/features/page/queries/page-query.ts";
import { extractPageSlugId } from "@/lib";
import { useMediaQuery } from "@mantine/hooks";
import { useTranslation } from "react-i18next";

function getTitle(name: string, icon: string) {
  if (icon) {
    return `${icon} ${name}`;
  }
  return name;
}

function buildNodeUrl(
  spaceSlug: string | undefined,
  node: SpaceTreeNode,
) {
  if (node.nodeType === "database") {
    return buildDatabaseUrl(spaceSlug, node.slugId, node.name);
  }

  return buildPageUrl(spaceSlug, node.slugId, node.name);
}

export default function Breadcrumb() {
  const { t } = useTranslation();
  const treeData = useAtomValue(treeDataAtom);
  const [breadcrumbNodes, setBreadcrumbNodes] = useState<
    SpaceTreeNode[] | null
  >(null);
  const { pageSlug, databaseSlug, spaceSlug } = useParams();
  const routeSlug = pageSlug ?? databaseSlug;
  const { data: currentPage } = usePageQuery({
    pageId: extractPageSlugId(routeSlug),
  });
  const { data: serverBreadcrumbs } = usePageBreadcrumbsQuery(
    currentPage?.id ?? "",
  );
  const isMobile = useMediaQuery("(max-width: 48em)");

  useEffect(() => {
    if (!currentPage) {
      setBreadcrumbNodes(null);
      return;
    }

    if (Array.isArray(serverBreadcrumbs) && serverBreadcrumbs.length > 0) {
      const breadcrumbTreeNodes = buildTree(serverBreadcrumbs);
      const breadcrumbNodeIds = new Set(
        breadcrumbTreeNodes.map((node) => node.id),
      );
      setBreadcrumbNodes(
        orderBreadcrumbNodes(
          mergeTreeNodeMetadata(
          breadcrumbTreeNodes,
          findTreeNodesByIds(treeData ?? [], breadcrumbNodeIds),
          ),
        ),
      );
      return;
    }

    const localBreadcrumb = findBreadcrumbPath(treeData ?? [], currentPage.id);
    setBreadcrumbNodes(localBreadcrumb || null);
  }, [currentPage, serverBreadcrumbs, treeData]);

  const HiddenNodesTooltipContent = () =>
    breadcrumbNodes?.slice(1, -1).map((node) => (
      <Button.Group orientation="vertical" key={node.id}>
        <Button
          justify="start"
          component={Link}
          to={buildNodeUrl(spaceSlug, node)}
          variant="default"
          style={{ border: "none" }}
        >
          <Text fz={"sm"} className={classes.truncatedText}>
            {getTitle(node.name, node.icon)}
          </Text>
        </Button>
      </Button.Group>
    ));

  const MobileHiddenNodesTooltipContent = () =>
    breadcrumbNodes?.map((node) => (
      <Button.Group orientation="vertical" key={node.id}>
        <Button
          justify="start"
          component={Link}
          to={buildNodeUrl(spaceSlug, node)}
          variant="default"
          style={{ border: "none" }}
        >
          <Text fz={"sm"} className={classes.truncatedText}>
            {getTitle(node.name, node.icon)}
          </Text>
        </Button>
      </Button.Group>
    ));

  const renderAnchor = useCallback(
    (node: SpaceTreeNode) => (
      <Tooltip label={node.name} key={node.id}>
        <Anchor
          component={Link}
          to={buildNodeUrl(spaceSlug, node)}
          underline="never"
          fz="sm"
          key={node.id}
          className={classes.truncatedText}
        >
          {getTitle(node.name, node.icon)}
        </Anchor>
      </Tooltip>
    ),
    [spaceSlug],
  );

  const getBreadcrumbItems = () => {
    if (!breadcrumbNodes) return [];

    if (breadcrumbNodes.length > 3) {
      const firstNode = breadcrumbNodes[0];
      //const secondLastNode = breadcrumbNodes[breadcrumbNodes.length - 2];
      const lastNode = breadcrumbNodes[breadcrumbNodes.length - 1];

      return [
        renderAnchor(firstNode),
        <Popover
          width={250}
          position="bottom"
          withArrow
          shadow="xl"
          key="hidden-nodes"
        >
          <Popover.Target>
            <ActionIcon
              aria-label={t("Breadcrumbs")}
              color="gray"
              variant="transparent"
              size={32}
            >
              <IconDots size={20} stroke={2} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <HiddenNodesTooltipContent />
          </Popover.Dropdown>
        </Popover>,
        //renderAnchor(secondLastNode),
        renderAnchor(lastNode),
      ];
    }

    return breadcrumbNodes.map(renderAnchor);
  };

  const getMobileBreadcrumbItems = () => {
    if (!breadcrumbNodes) return [];

    if (breadcrumbNodes.length > 0) {
      return [
        <Popover
          width={250}
          position="bottom"
          withArrow
          shadow="xl"
          key="mobile-hidden-nodes"
        >
          <Popover.Target>
            <Tooltip label={t("Breadcrumbs")}>
              <ActionIcon
                aria-label={t("Breadcrumbs")}
                color="gray"
                variant="transparent"
                size={32}
              >
                <IconCornerDownRightDouble size={20} stroke={2} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown>
            <MobileHiddenNodesTooltipContent />
          </Popover.Dropdown>
        </Popover>,
      ];
    }

    return breadcrumbNodes.map(renderAnchor);
  };

  return (
    <div className={classes.breadcrumbDiv}>
      {breadcrumbNodes && (
        <Breadcrumbs className={classes.breadcrumbs}>
          {isMobile ? getMobileBreadcrumbItems() : getBreadcrumbItems()}
        </Breadcrumbs>
      )}
    </div>
  );
}
