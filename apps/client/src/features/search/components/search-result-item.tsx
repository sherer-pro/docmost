import React from "react";
import {
  ActionIcon,
  Badge,
  Center,
  Group,
  Text,
  Tooltip,
  getDefaultZIndex,
} from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { IconDownload, IconFile } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { buildAttachmentFileUrl, getTagColor } from "@docmost/editor-ext";
import { buildDatabaseUrl, buildPageUrl } from "@/features/page/page.utils";
import type {
  IAttachmentSearch,
  IPageSearch,
  ITagSearchSnippet,
} from "@/features/search/types/search.types";
import { searchSpotlight } from "@/features/search/constants";
import { getPageIcon } from "@/lib";
import classes from "./search-result-item.module.css";
import { isDuplicateTextHighlight } from "./search-result-utils";
import tagColorClasses from "@/components/ui/tag-colors.module.css";

interface SearchResultItemProps {
  result: IPageSearch | IAttachmentSearch;
  isAttachmentResult: boolean;
  showSpace?: boolean;
}

const CONTENT_KIND_LABELS: Record<IPageSearch["contentKind"], string> = {
  page: "Page",
  database: "Database",
  databaseRow: "Database row",
};

function buildResultUrl(result: IPageSearch, anchorId?: string) {
  const spaceSlug = result.space.slug as string;
  return result.contentKind === "database" || result.databaseId != null
    ? buildDatabaseUrl(spaceSlug, result.slugId, result.title, anchorId)
    : buildPageUrl(spaceSlug, result.slugId, result.title, anchorId);
}

function TagSnippet({
  snippet,
  href,
  label,
}: {
  snippet: ITagSearchSnippet;
  href: string;
  label: string;
}) {
  const segments: React.ReactNode[] = [];
  let cursor = 0;

  [...snippet.matches]
    .sort((left, right) => left.start - right.start)
    .forEach((match, index) => {
      if (
        match.start < cursor ||
        match.start < 0 ||
        match.end <= match.start ||
        match.end > snippet.text.length
      ) {
        return;
      }

      if (match.start > cursor) {
        segments.push(snippet.text.slice(cursor, match.start));
      }
      segments.push(
        <span
          key={`${match.start}-${match.end}-${index}`}
          className={`${classes.tagMatch} ${tagColorClasses[getTagColor(match.value)]}`}
        >
          {snippet.text.slice(match.start, match.end)}
        </span>,
      );
      cursor = match.end;
    });

  if (cursor < snippet.text.length) {
    segments.push(snippet.text.slice(cursor));
  }

  return (
    <Link
      to={href}
      className={classes.tagSnippet}
      aria-label={label}
      onClick={() => searchSpotlight.close()}
    >
      {segments}
    </Link>
  );
}

export function SearchResultItem({
  result,
  isAttachmentResult,
  showSpace,
}: SearchResultItemProps) {
  const { t } = useTranslation();

  if (isAttachmentResult) {
    const attachmentResult = result as IAttachmentSearch;
    const handleDownload = (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(
        buildAttachmentFileUrl(attachmentResult.id, attachmentResult.fileName),
        "_blank",
      );
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
                {attachmentResult.space.name} · {attachmentResult.page.title}
              </Text>
              {attachmentResult.highlight && (
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
  }

  const pageResult = result as IPageSearch;
  const pageUrl = buildResultUrl(pageResult);
  const breadcrumbsText = pageResult.breadcrumbs?.length
    ? pageResult.breadcrumbs.map((crumb) => crumb.title).join(" / ")
    : null;
  const labels = pageResult.labels ?? [];
  const snippets = pageResult.tagSnippets ?? [];
  const shownMatchCount = snippets.reduce(
    (count, snippet) => count + snippet.matches.length,
    0,
  );
  const remainingMatchCount = Math.max(
    0,
    (pageResult.tagMatchCount ?? 0) - shownMatchCount,
  );
  const showTextHighlight =
    Boolean(pageResult.highlight) &&
    !isDuplicateTextHighlight(pageResult.highlight, snippets);

  return (
    <div className={classes.resultItem}>
      <Spotlight.Action
        component={Link}
        //@ts-ignore
        to={pageUrl}
        style={{ userSelect: "none" }}
      >
        <Group wrap="nowrap" w="100%">
          <Center aria-hidden>{getPageIcon(pageResult.icon)}</Center>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text>{pageResult.title}</Text>
            <Group gap={4} mt={2}>
              <Badge variant="light" size="xs" color="gray">
                {t(CONTENT_KIND_LABELS[pageResult.contentKind ?? "page"])}
              </Badge>
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
            {breadcrumbsText && (
              <Text size="xs" opacity={0.6} truncate>
                {breadcrumbsText}
              </Text>
            )}
            {showTextHighlight && (
              <Text
                opacity={0.6}
                size="xs"
                mt={2}
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
      {snippets.length > 0 && (
        <div className={classes.tagSnippets}>
          {snippets.map((snippet, index) => (
            <TagSnippet
              key={`${snippet.anchorId ?? "top"}-${index}`}
              snippet={snippet}
              href={buildResultUrl(pageResult, snippet.anchorId)}
              label={t("Open tag match {{index}} in {{title}}", {
                index: index + 1,
                title: pageResult.title,
              })}
            />
          ))}
          {remainingMatchCount > 0 && (
            <Text size="xs" c="dimmed" px="sm">
              {t("+{{count}} more tag matches", {
                count: remainingMatchCount,
              })}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
