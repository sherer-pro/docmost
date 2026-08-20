import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Divider,
  Group,
  Menu,
  ScrollArea,
  Text,
  TextInput,
  getDefaultZIndex,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconFileDescription,
  IconSearch,
  IconTag,
} from "@tabler/icons-react";
import { useDebouncedValue } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  builtInTagDefinitions,
  builtInTagValues,
  getTagLabel,
} from "@docmost/editor-ext";
import type { BuiltInTagValue } from "@docmost/editor-ext";
import { useGetSpacesQuery } from "@/features/space/queries/space-query";
import type { SearchSpotlightIntent } from "../constants";
import {
  useSearchLabelsQuery,
  useSearchTagFacetsQuery,
} from "../queries/search-query";
import type { IPageSearchLabel } from "../types/search.types";
import {
  getSearchFilterPayload,
  OPEN_TAGS,
  sameSearchTags,
  shouldClearUnavailableSearchTags,
  shouldShowSearchTagFilter,
  type SearchFilterPayload,
  type SelectedSearchLabel,
} from "./search-filter-state";
import { getSearchContentTypeOptions } from "./search-content-type-options";
import classes from "./search-spotlight-filters.module.css";

interface SearchSpotlightFiltersProps {
  onFiltersChange?: (filters: SearchFilterPayload) => void;
  onIntentApplied?: () => void;
  spaceId?: string;
  opened: boolean;
  intent?: SearchSpotlightIntent | null;
  clearTagsRequest?: number;
  contentTypeRequest?: { value: string; sequence: number };
}

export function SearchSpotlightFilters({
  onFiltersChange,
  onIntentApplied,
  spaceId,
  opened,
  intent,
  clearTagsRequest = 0,
  contentTypeRequest,
}: SearchSpotlightFiltersProps) {
  const { t } = useTranslation();
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
    spaceId || null,
  );
  const [spaceSearchQuery, setSpaceSearchQuery] = useState("");
  const [debouncedSpaceQuery] = useDebouncedValue(spaceSearchQuery, 300);
  const [contentType, setContentType] = useState<string | null>("all");
  const [selectedLabel, setSelectedLabel] =
    useState<SelectedSearchLabel | null>(null);
  const [selectedTags, setSelectedTags] = useState<BuiltInTagValue[]>([]);
  const [labelSearchQuery, setLabelSearchQuery] = useState("");
  const [debouncedLabelQuery] = useDebouncedValue(labelSearchQuery, 300);
  const lastClearTagsRequest = useRef(clearTagsRequest);
  const arePageFiltersDisabled = contentType !== "page";
  const isLabelFilterDisabled = arePageFiltersDisabled || !selectedSpaceId;

  const { data: spacesData } = useGetSpacesQuery({
    limit: 100,
    query: debouncedSpaceQuery,
  });
  const { data: labels = [] } = useSearchLabelsQuery(
    {
      limit: 25,
      query: debouncedLabelQuery,
      spaceId: selectedSpaceId ?? undefined,
    },
    opened && !isLabelFilterDisabled,
  );
  const tagFacetsQuery = useSearchTagFacetsQuery(
    { spaceId: selectedSpaceId ?? undefined },
    opened && !arePageFiltersDisabled,
  );
  const tagFacets = tagFacetsQuery.data ?? [];

  const selectedSpaceData = useMemo(() => {
    if (!spacesData?.items || !selectedSpaceId) return null;
    return spacesData.items.find((space) => space.id === selectedSpaceId);
  }, [spacesData?.items, selectedSpaceId]);

  const availableSpaces = useMemo(() => {
    const spaces = spacesData?.items || [];
    if (!selectedSpaceId) return spaces;

    return [...spaces].sort((a, b) => {
      if (a.id === selectedSpaceId) return -1;
      if (b.id === selectedSpaceId) return 1;
      return 0;
    });
  }, [spacesData?.items, selectedSpaceId]);

  const availableLabels = useMemo<IPageSearchLabel[]>(() => {
    if (
      !selectedLabel ||
      labels.some((label) => label.id === selectedLabel.id)
    ) {
      return labels;
    }

    if (!selectedSpaceId) return labels;
    return [
      { ...selectedLabel, type: "page", spaceId: selectedSpaceId },
      ...labels,
    ];
  }, [labels, selectedLabel, selectedSpaceId]);

  const facetCounts = useMemo(
    () => new Map(tagFacets.map((facet) => [facet.value, facet.documentCount])),
    [tagFacets],
  );
  const visibleTagDefinitions = builtInTagDefinitions.filter(
    (tag) => facetCounts.has(tag.value) || selectedTags.includes(tag.value),
  );
  const showTagFilter = shouldShowSearchTagFilter({
    disabled: arePageFiltersDisabled,
    selectedTags,
    availableTags: visibleTagDefinitions.map((tag) => tag.value),
  });

  const emitFilters = (
    nextSpaceId: string | null,
    nextContentType: string | null,
    nextLabel: SelectedSearchLabel | null,
    nextTags: BuiltInTagValue[],
  ) => {
    onFiltersChange?.(
      getSearchFilterPayload({
        spaceId: nextSpaceId,
        contentType: nextContentType,
        label: nextLabel,
        tags: nextTags,
      }),
    );
  };

  const notifyTagReset = () => {
    notifications.show({
      id: "search-tag-filter-reset",
      color: "gray",
      message: t("Tag filter was cleared because this scope has no tags."),
    });
  };

  useEffect(() => {
    emitFilters(selectedSpaceId, contentType, selectedLabel, selectedTags);
  }, []);

  useEffect(() => {
    if (!intent) return;

    setSelectedSpaceId(intent.spaceId);
    setContentType("page");
    setSelectedLabel(null);
    setSelectedTags(intent.tags);
    emitFilters(intent.spaceId, "page", null, intent.tags);
    onIntentApplied?.();
  }, [intent, onIntentApplied]);

  useEffect(() => {
    if (lastClearTagsRequest.current === clearTagsRequest) return;
    lastClearTagsRequest.current = clearTagsRequest;
    if (selectedTags.length === 0) return;

    setSelectedTags([]);
    emitFilters(selectedSpaceId, contentType, selectedLabel, []);
  }, [
    clearTagsRequest,
    contentType,
    selectedLabel,
    selectedSpaceId,
    selectedTags,
  ]);

  useEffect(() => {
    const nextLabel =
      isLabelFilterDisabled && selectedLabel ? null : selectedLabel;
    const shouldClearTags = arePageFiltersDisabled && selectedTags.length > 0;
    if (nextLabel === selectedLabel && !shouldClearTags) return;

    if (nextLabel !== selectedLabel) setSelectedLabel(nextLabel);
    if (shouldClearTags) {
      setSelectedTags([]);
      notifyTagReset();
    }
    emitFilters(
      selectedSpaceId,
      contentType,
      nextLabel,
      shouldClearTags ? [] : selectedTags,
    );
  }, [
    arePageFiltersDisabled,
    contentType,
    isLabelFilterDisabled,
    selectedLabel,
    selectedSpaceId,
    selectedTags,
  ]);

  useEffect(() => {
    if (
      !shouldClearUnavailableSearchTags({
        disabled: arePageFiltersDisabled,
        facetsLoaded: tagFacetsQuery.isSuccess,
        selectedTags,
        availableTags: tagFacets.map((facet) => facet.value),
      })
    ) {
      return;
    }

    setSelectedTags([]);
    emitFilters(selectedSpaceId, contentType, selectedLabel, []);
    notifyTagReset();
  }, [
    arePageFiltersDisabled,
    contentType,
    selectedLabel,
    selectedSpaceId,
    selectedTags,
    tagFacets,
    tagFacetsQuery.isSuccess,
  ]);

  const contentTypeOptions = getSearchContentTypeOptions(t);

  const handleSpaceSelect = (nextSpaceId: string | null) => {
    setSelectedSpaceId(nextSpaceId);
    setSelectedLabel(null);
    emitFilters(nextSpaceId, contentType, null, selectedTags);
  };

  const handleContentTypeSelect = (nextContentType: string) => {
    if (contentType === nextContentType) return;

    const supportsPageFilters = nextContentType === "page";
    const nextLabel = supportsPageFilters ? selectedLabel : null;
    const nextTags = supportsPageFilters ? selectedTags : [];
    setContentType(nextContentType);
    setSelectedLabel(nextLabel);
    setSelectedTags(nextTags);
    if (selectedTags.length > 0 && !supportsPageFilters) {
      notifyTagReset();
    }
    emitFilters(selectedSpaceId, nextContentType, nextLabel, nextTags);
  };

  const handleLabelSelect = (label: SelectedSearchLabel | null) => {
    const nextContentType =
      label && contentType !== "page" ? "page" : contentType;
    if (nextContentType !== contentType) setContentType(nextContentType);
    setSelectedLabel(label);
    emitFilters(selectedSpaceId, nextContentType, label, selectedTags);
  };

  const handleTagsSelect = (tags: BuiltInTagValue[]) => {
    const nextContentType =
      tags.length > 0 && contentType !== "page" ? "page" : contentType;
    if (nextContentType !== contentType) setContentType(nextContentType);
    setSelectedTags(tags);
    emitFilters(selectedSpaceId, nextContentType, selectedLabel, tags);
  };

  useEffect(() => {
    if (!contentTypeRequest) return;
    handleContentTypeSelect(contentTypeRequest.value);
  }, [contentTypeRequest?.sequence]);

  const toggleTag = (tag: BuiltInTagValue) => {
    handleTagsSelect(
      selectedTags.includes(tag)
        ? selectedTags.filter((value) => value !== tag)
        : [...selectedTags, tag],
    );
  };

  const tagButtonLabel = sameSearchTags(selectedTags, builtInTagValues)
    ? `${t("Tags")}: ${t("All")}`
    : sameSearchTags(selectedTags, OPEN_TAGS)
      ? `${t("Tags")}: ${t("Open")}`
      : selectedTags.length === 1
        ? `${t("Tag")}: ${getTagLabel(selectedTags[0])}`
        : selectedTags.length > 1
          ? `${t("Tags")}: ${selectedTags.length}`
          : t("Tags");

  return (
    <div className={classes.filtersContainer}>
      <Menu
        shadow="md"
        width={250}
        position="bottom-start"
        zIndex={getDefaultZIndex("max")}
      >
        <Menu.Target>
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            rightSection={<IconChevronDown size={14} />}
            leftSection={<IconBuilding size={16} />}
            className={classes.filterButton}
            fw={500}
          >
            {selectedSpaceId
              ? `${t("Space")}: ${selectedSpaceData?.name || t("Unknown")}`
              : `${t("Space")}: ${t("All spaces")}`}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <TextInput
            placeholder={t("Find a space")}
            data-autofocus
            leftSection={<IconSearch size={16} />}
            value={spaceSearchQuery}
            onChange={(event) => setSpaceSearchQuery(event.target.value)}
            size="sm"
            variant="filled"
            radius="sm"
            styles={{ input: { marginBottom: 8 } }}
          />
          <ScrollArea.Autosize mah={280}>
            <Menu.Item onClick={() => handleSpaceSelect(null)}>
              <Group flex="1" gap="xs">
                <Avatar
                  color="initials"
                  variant="filled"
                  name={t("All spaces")}
                  size={20}
                />
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    {t("All spaces")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("Search in all your spaces")}
                  </Text>
                </div>
                {!selectedSpaceId && <IconCheck size={20} />}
              </Group>
            </Menu.Item>
            <Divider my="xs" />
            {availableSpaces.map((space) => (
              <Menu.Item
                key={space.id}
                onClick={() => handleSpaceSelect(space.id)}
              >
                <Group flex="1" gap="xs">
                  <Avatar
                    color="initials"
                    variant="filled"
                    name={space.name}
                    size={20}
                  />
                  <Text size="sm" fw={500} style={{ flex: 1 }} truncate>
                    {space.name}
                  </Text>
                  {selectedSpaceId === space.id && <IconCheck size={20} />}
                </Group>
              </Menu.Item>
            ))}
          </ScrollArea.Autosize>
        </Menu.Dropdown>
      </Menu>

      <Menu
        shadow="md"
        width={250}
        position="bottom-start"
        zIndex={getDefaultZIndex("max")}
      >
        <Menu.Target>
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            rightSection={<IconChevronDown size={14} />}
            leftSection={<IconTag size={16} />}
            className={classes.filterButton}
            fw={500}
            disabled={isLabelFilterDisabled}
          >
            {selectedLabel
              ? `${t("Label")}: ${selectedLabel.name}`
              : t("Label")}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <TextInput
            placeholder={t("Search...")}
            data-autofocus
            leftSection={<IconSearch size={16} />}
            value={labelSearchQuery}
            onChange={(event) => setLabelSearchQuery(event.target.value)}
            size="sm"
            variant="filled"
            radius="sm"
            styles={{ input: { marginBottom: 8 } }}
          />
          <ScrollArea.Autosize mah={280}>
            {selectedLabel && (
              <>
                <Menu.Item onClick={() => handleLabelSelect(null)}>
                  <Text size="sm" fw={500}>
                    {t("No labels")}
                  </Text>
                </Menu.Item>
                <Divider my="xs" />
              </>
            )}
            {availableLabels.length === 0 ? (
              <Text size="sm" c="dimmed" px="sm" py="xs">
                {t("No labels")}
              </Text>
            ) : (
              availableLabels.map((label) => (
                <Menu.Item
                  key={label.id}
                  onClick={() =>
                    handleLabelSelect({ id: label.id, name: label.name })
                  }
                >
                  <Group flex="1" gap="xs">
                    <Text size="sm" fw={500} style={{ flex: 1 }} truncate>
                      {label.name}
                    </Text>
                    {selectedLabel?.id === label.id && <IconCheck size={20} />}
                  </Group>
                </Menu.Item>
              ))
            )}
          </ScrollArea.Autosize>
        </Menu.Dropdown>
      </Menu>

      {showTagFilter && (
        <Menu
          shadow="md"
          width={220}
          position="bottom-start"
          zIndex={getDefaultZIndex("max")}
          closeOnItemClick={false}
        >
          <Menu.Target>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              rightSection={<IconChevronDown size={14} />}
              leftSection={<IconTag size={16} />}
              className={classes.filterButton}
              fw={500}
            >
              {tagButtonLabel}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => handleTagsSelect([])}>
              <Group flex="1" gap="xs">
                <Text size="sm" style={{ flex: 1 }}>
                  {t("Clear tags")}
                </Text>
                {selectedTags.length === 0 && <IconCheck size={20} />}
              </Group>
            </Menu.Item>
            <Divider my="xs" />
            <Menu.Item onClick={() => handleTagsSelect([...builtInTagValues])}>
              <Group flex="1" gap="xs">
                <Text size="sm" style={{ flex: 1 }}>
                  {t("All")}
                </Text>
                {sameSearchTags(selectedTags, builtInTagValues) && (
                  <IconCheck size={20} />
                )}
              </Group>
            </Menu.Item>
            <Menu.Item onClick={() => handleTagsSelect(OPEN_TAGS)}>
              <Group flex="1" gap="xs">
                <Text size="sm" style={{ flex: 1 }}>
                  {t("Open")}
                </Text>
                {sameSearchTags(selectedTags, OPEN_TAGS) && (
                  <IconCheck size={20} />
                )}
              </Group>
            </Menu.Item>
            <Divider my="xs" />
            {visibleTagDefinitions.map((tag) => (
              <Menu.Item key={tag.value} onClick={() => toggleTag(tag.value)}>
                <Group flex="1" gap="xs">
                  <Text size="sm" fw={500} style={{ flex: 1 }}>
                    {tag.label}
                  </Text>
                  {facetCounts.has(tag.value) && (
                    <Text size="xs" c="dimmed">
                      {facetCounts.get(tag.value)}
                    </Text>
                  )}
                  {selectedTags.includes(tag.value) && <IconCheck size={20} />}
                </Group>
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}

      <Menu
        shadow="md"
        width={220}
        position="bottom-start"
        zIndex={getDefaultZIndex("max")}
      >
        <Menu.Target>
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            rightSection={<IconChevronDown size={14} />}
            leftSection={<IconFileDescription size={16} />}
            className={classes.filterButton}
            fw={500}
          >
            {contentType
              ? `${t("Type")}: ${contentTypeOptions.find((option) => option.value === contentType)?.label || t("All")}`
              : t("Type")}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {contentTypeOptions.map((option) => (
            <Menu.Item
              key={option.value}
              onClick={() => handleContentTypeSelect(option.value)}
            >
              <Group flex="1" gap="xs">
                <Text size="sm">{option.label}</Text>
                {contentType === option.value && <IconCheck size={20} />}
              </Group>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
