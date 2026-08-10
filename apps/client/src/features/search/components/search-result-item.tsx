import React from "react";
import {
  Group,
  Center,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  getDefaultZIndex,
} from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { Link } from "react-router-dom";
import { IconFile, IconDownload } from "@tabler/icons-react";
import { buildDatabaseUrl, buildPageUrl } from "@/features/page/page.utils";
import { getPageIcon } from "@/lib";
import {
  IAttachmentSearch,
  IPageSearch,
} from "@/features/search/types/search.types";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { buildAttachmentFileUrl } from "@docmost/editor-ext";

interface SearchResultItemProps {
  result: IPageSearch | IAttachmentSearch;
  isAttachmentResult: boolean;
  showSpace?: boolean;
}

export function SearchResultItem({
  result,
  isAttachmentResult,
  showSpace,
}: SearchResultItemProps) {
  const { t } = useTranslation();

  if (isAttachmentResult) {
    const attachmentResult = result as IAttachmentSearch;

    const handleDownload = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const downloadUrl = buildAttachmentFileUrl(
        attachmentResult.id,
        attachmentResult.fileName,
      );
      window.open(downloadUrl, "_blank");
    };

    return (
      <Group wrap="nowrap" w="100%" gap={4} style={{ userSelect: "none" }}>
        <Spotlight.Action
          component={Link}
          //@ts-ignore
          to={buildPageUrl(
            attachmentResult.space.slug,
            attachmentResult.page.slugId,
            attachmentResult.page.title,
          )}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group wrap="nowrap" w="100%">
            <Center aria-hidden>
              <IconFile size={16} />
            </Center>

            <div style={{ flex: 1, minWidth: 0 }}>
              <Text>{attachmentResult.fileName}</Text>
              <Text size="xs" opacity={0.6}>
                {attachmentResult.space.name} • {attachmentResult.page.title}
              </Text>

              {attachmentResult?.highlight && (
                <Text
                  opacity={0.6}
                  size="xs"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(attachmentResult.highlight, {
                      ALLOWED_TAGS: ["mark", "em", "strong", "b"],
                      ALLOWED_ATTR: [],
                    }),
                  }}
                />
              )}
            </div>
          </Group>
        </Spotlight.Action>

        <Tooltip
          label={t("Download attachment")}
          zIndex={getDefaultZIndex("max")}
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size={32}
            aria-label={t("Download attachment")}
            onClick={handleDownload}
          >
            <IconDownload size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  } else {
    const pageResult = result as IPageSearch;
    const spaceSlug = pageResult.space.slug;
    const pageUrl =
      pageResult.databaseId != null && spaceSlug
        ? buildDatabaseUrl(
            spaceSlug,
            pageResult.slugId,
            pageResult.title,
          )
        : buildPageUrl(
            spaceSlug as unknown as string,
            pageResult.slugId,
            pageResult.title,
          );
    const breadcrumbsText =
      pageResult.breadcrumbs && pageResult.breadcrumbs.length > 0
        ? pageResult.breadcrumbs.map((crumb) => crumb.title).join(" / ")
        : null;
    const labels = pageResult.labels ?? [];
    const hasBadges = Boolean(showSpace && pageResult.space) || labels.length > 0;

    return (
      <Spotlight.Action
        component={Link}
        //@ts-ignore
        to={pageUrl}
        style={{ userSelect: "none" }}
      >
        <Group wrap="nowrap" w="100%">
          <Center aria-hidden>{getPageIcon(pageResult?.icon)}</Center>

          <div style={{ flex: 1 }}>
            <Text>{pageResult.title}</Text>

            {hasBadges && (
              <Group gap={4} mt={2}>
                {showSpace && pageResult.space && (
                  <Badge variant="light" size="xs" color="gray">
                    {pageResult.space.name}
                  </Badge>
                )}
                {labels.map((label) => (
                  <Badge key={label.id} variant="light" size="xs" color="blue">
                    {label.name}
                  </Badge>
                ))}
              </Group>
            )}

            {breadcrumbsText && (
              <Text
                size="xs"
                opacity={0.6}
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {breadcrumbsText}
              </Text>
            )}

            {pageResult?.highlight && (
              <Text
                opacity={0.6}
                size="xs"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(pageResult.highlight, {
                    ALLOWED_TAGS: ["mark", "em", "strong", "b"],
                    ALLOWED_ATTR: [],
                  }),
                }}
              />
            )}
          </div>
        </Group>
      </Spotlight.Action>
    );
  }
}
