import React from "react";
import { Badge, Box, Group, Text } from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { IconBook2 } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { IDictionarySearch } from "../types/search.types";
import { searchSpotlight } from "../constants";
import classes from "./search-result-item.module.css";

interface DictionarySearchResultItemProps {
  result: IDictionarySearch;
  showSpace?: boolean;
}

function HighlightedSnippet({
  snippet,
}: {
  snippet: IDictionarySearch["snippet"];
}) {
  const nodes: React.ReactNode[] = [];
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
        nodes.push(snippet.text.slice(cursor, match.start));
      }
      nodes.push(
        <mark key={`${match.start}-${match.end}-${index}`}>
          {snippet.text.slice(match.start, match.end)}
        </mark>,
      );
      cursor = match.end;
    });
  if (cursor < snippet.text.length) {
    nodes.push(snippet.text.slice(cursor));
  }
  return <>{nodes}</>;
}

export function DictionarySearchResultItem({
  result,
  showSpace,
}: DictionarySearchResultItemProps) {
  const { t } = useTranslation();
  const dictionaryUrl = `/s/${result.space.slug}/dictionary?term=${result.id}`;

  return (
    <div className={classes.resultItem}>
      <Spotlight.Action
        component={Link}
        //@ts-ignore
        to={dictionaryUrl}
        onClick={() => searchSpotlight.close()}
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
            {result.matchedField !== "definition" && result.snippet.text && (
              <Text size="xs" c="dimmed" mt={2}>
                <HighlightedSnippet snippet={result.snippet} />
              </Text>
            )}
            {result.definitionSnippet.text && (
              <Text size="xs" c="dimmed" mt={4} lineClamp={2}>
                <HighlightedSnippet snippet={result.definitionSnippet} />
              </Text>
            )}
          </Box>
        </Group>
      </Spotlight.Action>
    </div>
  );
}
