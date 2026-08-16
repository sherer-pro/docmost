import { Spotlight, useSpotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { Button, Group } from "@mantine/core";
import React, { useCallback, useState, useMemo } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  searchSpotlightIntentAtom,
  searchSpotlightStore,
} from "../constants.ts";
import { SearchSpotlightFilters } from "./search-spotlight-filters.tsx";
import { useUnifiedSearch } from "../hooks/use-unified-search.ts";
import type { UseUnifiedSearchParams } from "../hooks/use-unified-search.ts";
import { SearchResultItem } from "./search-result-item.tsx";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert.ts";
import { useAtom } from "jotai";
import type { SearchFilterPayload } from "./search-filter-state.ts";

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
    contentType: "page",
    tags: [],
  });
  const [clearTagsRequest, setClearTagsRequest] = useState(0);
  // Build unified search params
  const searchParams = useMemo(() => {
    const params: UseUnifiedSearchParams = {
      query: debouncedSearchQuery,
      contentType: filters.contentType || "page", // Only used for frontend routing
    };

    // Handle space filtering - only pass spaceId if a specific space is selected
    if (filters.spaceId) {
      params.spaceId = filters.spaceId;
    }

    if (filters.labelId && filters.contentType !== "attachment") {
      params.labelId = filters.labelId;
    }

    if (filters.tags?.length && filters.contentType !== "attachment") {
      params.tags = filters.tags;
    }

    return params;
  }, [debouncedSearchQuery, filters]);

  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useUnifiedSearch(searchParams);
  const searchResults = data?.pages.flat() ?? [];

  // Determine result type for rendering
  const isAttachmentSearch = filters.contentType === "attachment";
  const hasLabelSearch =
    Boolean(filters.labelId) && filters.contentType !== "attachment";
  const hasTagSearch =
    Boolean(filters.tags?.length) && filters.contentType !== "attachment";
  const hasSearchInput =
    query.trim().length > 0 || hasLabelSearch || hasTagSearch;
  useModalBackgroundInert(opened);

  const resultItems = searchResults.map((result) => (
    <SearchResultItem
      key={result.id}
      result={result}
      isAttachmentResult={isAttachmentSearch}
      showSpace={!filters.spaceId}
    />
  ));

  const handleFiltersChange = useCallback((newFilters: SearchFilterPayload) => {
    setFilters(newFilters);
  }, []);
  const handleIntentApplied = useCallback(
    () => setIntentState({ intent: null }),
    [setIntentState],
  );

  return (
    <>
      <Spotlight.Root
        role="dialog"
        aria-label={t("Search")}
        size="xl"
        maxHeight={600}
        store={searchSpotlightStore}
        query={query}
        onQueryChange={setQuery}
        scrollable
        overlayProps={{
          backgroundOpacity: 0.55,
        }}
      >
        <Group gap="xs" px="sm" pt="sm" pb="xs">
          <Spotlight.Search
            placeholder={t("Search...")}
            leftSection={<IconSearch size={20} stroke={1.5} />}
            style={{ flex: 1 }}
          />
        </Group>

        <div
          style={{
            padding: "4px 16px",
          }}
        >
          <SearchSpotlightFilters
            onFiltersChange={handleFiltersChange}
            onIntentApplied={handleIntentApplied}
            spaceId={spaceId}
            opened={opened}
            intent={intentState.intent}
            clearTagsRequest={clearTagsRequest}
          />
        </div>

        <Spotlight.ActionsList>
          {!hasSearchInput && resultItems.length === 0 && (
            <Spotlight.Empty>{t("Start typing to search...")}</Spotlight.Empty>
          )}

          {hasSearchInput && isLoading && (
            <Spotlight.Empty>{t("Loading...")}</Spotlight.Empty>
          )}

          {hasSearchInput && isError && (
            <Spotlight.Empty>
              {t("Search is temporarily unavailable.")}
            </Spotlight.Empty>
          )}

          {hasSearchInput &&
            !isLoading &&
            !isError &&
            resultItems.length === 0 && (
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

          {resultItems.length > 0 && <>{resultItems}</>}
          {hasNextPage && (
            <Button
              variant="subtle"
              fullWidth
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {t("Load more")}
            </Button>
          )}
        </Spotlight.ActionsList>
      </Spotlight.Root>
    </>
  );
}
