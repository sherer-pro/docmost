import React, { useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
  Group,
  Loader,
  Text,
  Tooltip,
} from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import {
  IconBook2,
  IconChevronDown,
  IconExternalLink,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { IDictionarySearch } from "../types/search.types";
import { useDictionaryTermQuery } from "@/features/dictionary/queries/dictionary-query";
import { DictionaryMarkdown } from "@/features/dictionary/components/dictionary-markdown";
import { searchSpotlight } from "../constants";
import classes from "./search-result-item.module.css";

interface DictionarySearchResultItemProps {
  result: IDictionarySearch;
  showSpace?: boolean;
}

function HighlightedSnippet({ result }: { result: IDictionarySearch }) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  [...result.snippet.matches]
    .sort((left, right) => left.start - right.start)
    .forEach((match, index) => {
      if (
        match.start < cursor ||
        match.start < 0 ||
        match.end <= match.start ||
        match.end > result.snippet.text.length
      ) {
        return;
      }
      if (match.start > cursor) {
        nodes.push(result.snippet.text.slice(cursor, match.start));
      }
      nodes.push(
        <mark key={`${match.start}-${match.end}-${index}`}>
          {result.snippet.text.slice(match.start, match.end)}
        </mark>,
      );
      cursor = match.end;
    });
  if (cursor < result.snippet.text.length) {
    nodes.push(result.snippet.text.slice(cursor));
  }
  return <>{nodes}</>;
}

export function DictionarySearchResultItem({
  result,
  showSpace,
}: DictionarySearchResultItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const termQuery = useDictionaryTermQuery(result.id, expanded);
  const dictionaryUrl = `/s/${result.space.slug}/dictionary?term=${result.id}`;

  return (
    <div className={classes.resultItem}>
      <Group wrap="nowrap" gap={4} align="stretch">
        <Spotlight.Action
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={`dictionary-search-term-${result.id}`}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group wrap="nowrap" align="flex-start">
            <IconBook2 size={17} aria-hidden />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group gap={6} wrap="wrap">
                <Text fw={500}>{result.term}</Text>
                <Badge variant="light" size="xs" color="gray">
                  {t(
                    result.matchedField === "term"
                      ? "Term"
                      : result.matchedField === "form"
                        ? "Word form"
                        : "Definition",
                  )}
                </Badge>
                {showSpace && (
                  <Badge variant="light" size="xs" color="gray">
                    {result.space.name}
                  </Badge>
                )}
              </Group>
              {result.matchedForm && (
                <Text size="xs" c="dimmed">
                  {t("Matched form")}: {result.matchedForm}
                </Text>
              )}
              <Text size="xs" c="dimmed" mt={2}>
                <HighlightedSnippet result={result} />
              </Text>
            </Box>
            <IconChevronDown
              size={16}
              aria-hidden
              className={expanded ? classes.disclosureOpen : undefined}
            />
          </Group>
        </Spotlight.Action>
        <Tooltip label={t("Open in Dictionary")} withArrow>
          <ActionIcon
            component={Link}
            to={dictionaryUrl}
            variant="subtle"
            color="gray"
            size={32}
            aria-label={t("Open in Dictionary")}
            onClick={() => searchSpotlight.close()}
          >
            <IconExternalLink size={17} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Collapse in={expanded}>
        <Box
          id={`dictionary-search-term-${result.id}`}
          className={classes.dictionaryPreview}
        >
          {termQuery.isLoading && <Loader size="xs" />}
          {termQuery.isError && (
            <Text size="xs" c="red">
              {t("Unable to load dictionary term.")}
            </Text>
          )}
          {termQuery.data && (
            <>
              {termQuery.data.forms.length > 0 && (
                <Group gap={4} mb="xs">
                  {termQuery.data.forms.map((form) => (
                    <Badge key={form} variant="light" size="xs">
                      {form}
                    </Badge>
                  ))}
                </Group>
              )}
              <DictionaryMarkdown
                markdown={termQuery.data.definitionMarkdown}
                compact
              />
            </>
          )}
        </Box>
      </Collapse>
    </div>
  );
}
