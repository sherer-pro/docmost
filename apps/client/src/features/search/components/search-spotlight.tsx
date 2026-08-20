import { Spotlight, useSpotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { Button, Group, Text } from "@mantine/core";
import React, { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  searchSpotlightIntentAtom,
  searchSpotlightStore,
} from "../constants.ts";
import { SearchSpotlightFilters } from "./search-spotlight-filters.tsx";
import {
  SearchContentType,
  UnifiedSearchResult,
  useAllSearch,
  useUnifiedSearch,
} from "../hooks/use-unified-search.ts";
import type { UseUnifiedSearchParams } from "../hooks/use-unified-search.ts";
import { SearchResultItem } from "./search-result-item.tsx";
import { DictionarySearchResultItem } from "./dictionary-search-result-item.tsx";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert.ts";
import { useAtom } from "jotai";
import type { SearchFilterPayload } from "./search-filter-state.ts";
import type {
  IAttachmentSearch,
  IDictionarySearch,
  IPageSearch,
} from "../types/search.types.ts";
import classes from "./search-result-item.module.css";

interface SearchSpotlightProps {
  spaceId?: string;
}

export function SearchSpotlight({ spaceId }: SearchSpotlightProps) {
  const { t } = useTranslation();
  const { opened } = useSpotlight(searchSpotlightStore);
  const [intentState, setIntentState] = useAtom(searchSpotlightIntentAtom);
  const [query, setQuery] = useState("");
  const [debouncedSearchQuery] = useDebouncedValue(query, 300);
  const [filters, setFilters] = useState<SearchFilterPayload>({
    contentType: "all",
    tags: [],
  });
  const [clearTagsRequest, setClearTagsRequest] = useState(0);
  const [contentTypeRequest, setContentTypeRequest] = useState<{
    value: string;
    sequence: number;
  }>();
  const contentType = (filters.contentType || "all") as SearchContentType;
  const searchParams = useMemo(() => {
    const params: UseUnifiedSearchParams = {
      query: debouncedSearchQuery,
      contentType,
    };
    if (filters.spaceId) params.spaceId = filters.spaceId;
    if (filters.labelId && contentType === "page") {
      params.labelId = filters.labelId;
    }
    if (filters.tags?.length && contentType === "page") {
      params.tags = filters.tags;
    }
    return params;
  }, [contentType, debouncedSearchQuery, filters]);

  const singleSearch = useUnifiedSearch(searchParams, contentType !== "all");
  const allSearch = useAllSearch(searchParams, contentType === "all");
  const searchResults =
    (singleSearch.data?.pages.flat() as UnifiedSearchResult[] | undefined) ??
    [];
  const hasLabelSearch = Boolean(filters.labelId) && contentType === "page";
  const hasTagSearch = Boolean(filters.tags?.length) && contentType === "page";
  const hasSearchInput =
    query.trim().length > 0 || hasLabelSearch || hasTagSearch;
  const allHasResults = allSearch.some((section) => section.data?.length);
  const allSettled = allSearch.every(
    (section) => !section.isLoading && !section.isFetching,
  );
  useModalBackgroundInert(opened);

  const renderResult = (
    result: UnifiedSearchResult,
    resultType: Exclude<SearchContentType, "all"> = contentType as Exclude<
      SearchContentType,
      "all"
    >,
  ) =>
    resultType === "dictionary" ? (
      <DictionarySearchResultItem
        key={result.id}
        result={result as IDictionarySearch}
        showSpace={!filters.spaceId}
      />
    ) : (
      <SearchResultItem
        key={result.id}
        result={result as IPageSearch | IAttachmentSearch}
        isAttachmentResult={resultType === "attachment"}
        showSpace={!filters.spaceId}
      />
    );

  const showAllOfType = (value: Exclude<SearchContentType, "all">) => {
    setContentTypeRequest((current) => ({
      value,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };

  const renderSection = (
    title: string,
    type: Exclude<SearchContentType, "all">,
    section: (typeof allSearch)[number],
  ) => (
    <section className={classes.searchSection} aria-label={title}>
      <Group justify="space-between" px="sm" py={6}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {title}
        </Text>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => showAllOfType(type)}
        >
          {t("Show all")}
        </Button>
      </Group>
      {section.isLoading && (
        <Text size="xs" c="dimmed" px="sm" pb="xs">
          {t("Loading...")}
        </Text>
      )}
      {section.isError && (
        <Text size="xs" c="red" px="sm" pb="xs">
          {t("This search section is temporarily unavailable.")}
        </Text>
      )}
      {section.data?.map((result) =>
        renderResult(result as UnifiedSearchResult, type),
      )}
    </section>
  );

  const handleFiltersChange = useCallback((newFilters: SearchFilterPayload) => {
    setFilters(newFilters);
  }, []);
  const handleIntentApplied = useCallback(
    () => setIntentState({ intent: null }),
    [setIntentState],
  );

  return (
    <Spotlight.Root
      role="dialog"
      aria-label={t("Search")}
      size="xl"
      maxHeight={600}
      store={searchSpotlightStore}
      query={query}
      onQueryChange={setQuery}
      scrollable
      overlayProps={{ backgroundOpacity: 0.55 }}
    >
      <Group gap="xs" px="sm" pt="sm" pb="xs">
        <Spotlight.Search
          placeholder={t("Search...")}
          leftSection={<IconSearch size={20} stroke={1.5} />}
          style={{ flex: 1 }}
        />
      </Group>

      <div style={{ padding: "4px 16px" }}>
        <SearchSpotlightFilters
          onFiltersChange={handleFiltersChange}
          onIntentApplied={handleIntentApplied}
          spaceId={spaceId}
          opened={opened}
          intent={intentState.intent}
          clearTagsRequest={clearTagsRequest}
          contentTypeRequest={contentTypeRequest}
        />
      </div>

      <Spotlight.ActionsList>
        {!hasSearchInput && (
          <Spotlight.Empty>{t("Start typing to search...")}</Spotlight.Empty>
        )}

        {hasSearchInput && contentType === "all" && (
          <>
            {renderSection(t("Documents"), "page", allSearch[0])}
            {renderSection(t("Attachments"), "attachment", allSearch[1])}
            {renderSection(t("Dictionary"), "dictionary", allSearch[2])}
            {allSettled && !allHasResults && (
              <Spotlight.Empty>{t("No results found...")}</Spotlight.Empty>
            )}
          </>
        )}

        {hasSearchInput && contentType !== "all" && singleSearch.isLoading && (
          <Spotlight.Empty>{t("Loading...")}</Spotlight.Empty>
        )}

        {hasSearchInput && contentType !== "all" && singleSearch.isError && (
          <Spotlight.Empty>
            {t("Search is temporarily unavailable.")}
          </Spotlight.Empty>
        )}

        {hasSearchInput &&
          contentType !== "all" &&
          !singleSearch.isLoading &&
          !singleSearch.isError &&
          searchResults.length === 0 && (
            <Spotlight.Empty>
              {hasTagSearch ? (
                <div>
                  <div>
                    {t("No documents match the selected tags and filters.")}
                  </div>
                  <Button
                    mt="xs"
                    size="xs"
                    variant="subtle"
                    onClick={() => setClearTagsRequest((value) => value + 1)}
                  >
                    {t("Clear tags")}
                  </Button>
                </div>
              ) : (
                t("No results found...")
              )}
            </Spotlight.Empty>
          )}

        {contentType !== "all" &&
          searchResults.map((result) => renderResult(result))}
        {contentType !== "all" && singleSearch.hasNextPage && (
          <Button
            variant="subtle"
            fullWidth
            loading={singleSearch.isFetchingNextPage}
            onClick={() => void singleSearch.fetchNextPage()}
          >
            {t("Load more")}
          </Button>
        )}
      </Spotlight.ActionsList>
    </Spotlight.Root>
  );
}
