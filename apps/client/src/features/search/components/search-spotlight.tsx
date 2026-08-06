import { Spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { Group } from "@mantine/core";
import React, { useState, useMemo } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { searchSpotlightStore } from "../constants.ts";
import { SearchSpotlightFilters } from "./search-spotlight-filters.tsx";
import { useUnifiedSearch } from "../hooks/use-unified-search.ts";
import { SearchResultItem } from "./search-result-item.tsx";
import type { TagValue } from "@docmost/editor-ext";

interface SearchSpotlightProps {
  spaceId?: string;
}

interface SearchFilters {
  spaceId?: string | null;
  contentType?: string;
  labelId?: string | null;
  tag?: TagValue | null;
}

export function SearchSpotlight({ spaceId }: SearchSpotlightProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedSearchQuery] = useDebouncedValue(query, 300);
  const [filters, setFilters] = useState<SearchFilters>({
    contentType: "page",
  });
  // Build unified search params
  const searchParams = useMemo(() => {
    const params: any = {
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

    if (filters.tag && filters.contentType !== "attachment") {
      params.tag = filters.tag;
    }

    return params;
  }, [debouncedSearchQuery, filters]);

  const { data: searchResults, isLoading } = useUnifiedSearch(searchParams);

  // Determine result type for rendering
  const isAttachmentSearch = filters.contentType === "attachment";
  const hasLabelSearch =
    Boolean(filters.labelId) && filters.contentType !== "attachment";
  const hasTagSearch =
    Boolean(filters.tag) && filters.contentType !== "attachment";
  const hasSearchInput =
    query.trim().length > 0 || hasLabelSearch || hasTagSearch;

  const resultItems = (searchResults || []).map((result) => (
    <SearchResultItem
      key={result.id}
      result={result}
      isAttachmentResult={isAttachmentSearch}
      showSpace={!filters.spaceId}
    />
  ));

  const handleFiltersChange = (newFilters: SearchFilters) => {
    setFilters(newFilters);
  };

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
            spaceId={spaceId}
          />
        </div>

        <Spotlight.ActionsList>
          {!hasSearchInput && resultItems.length === 0 && (
            <Spotlight.Empty>{t("Start typing to search...")}</Spotlight.Empty>
          )}

          {hasSearchInput && !isLoading && resultItems.length === 0 && (
            <Spotlight.Empty>{t("No results found...")}</Spotlight.Empty>
          )}

          {resultItems.length > 0 && <>{resultItems}</>}
        </Spotlight.ActionsList>
      </Spotlight.Root>
    </>
  );
}
