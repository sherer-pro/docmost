import React, { useState, useMemo, useEffect } from "react";
import {
  Button,
  Menu,
  Text,
  TextInput,
  Divider,
  ScrollArea,
  Avatar,
  Group,
  Switch,
  getDefaultZIndex,
} from "@mantine/core";
import {
  IconChevronDown,
  IconBuilding,
  IconFileDescription,
  IconSearch,
  IconCheck,
  IconTag,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@mantine/hooks";
import { useGetSpacesQuery } from "@/features/space/queries/space-query";
import classes from "./search-spotlight-filters.module.css";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { getSearchContentTypeOptions } from "./search-content-type-options";
import { useSearchLabelsQuery } from "../queries/search-query";
import { IPageSearchLabel } from "../types/search.types";
import {
  getSearchFilterPayload,
  SearchFilterPayload,
  SelectedSearchLabel,
} from "./search-filter-state";

interface SearchSpotlightFiltersProps {
  onFiltersChange?: (filters: SearchFilterPayload) => void;
  onAskClick?: () => void;
  spaceId?: string;
  isAiMode?: boolean;
}

export function SearchSpotlightFilters({
  onFiltersChange,
  onAskClick,
  spaceId,
  isAiMode = false,
}: SearchSpotlightFiltersProps) {
  const { t } = useTranslation();
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
    spaceId || null,
  );
  const [spaceSearchQuery, setSpaceSearchQuery] = useState("");
  const [debouncedSpaceQuery] = useDebouncedValue(spaceSearchQuery, 300);
  const [contentType, setContentType] = useState<string | null>("page");
  const [selectedLabel, setSelectedLabel] =
    useState<SelectedSearchLabel | null>(null);
  const [selectedTag, setSelectedTag] = useState<"tbd" | "todo" | null>(null);
  const [labelSearchQuery, setLabelSearchQuery] = useState("");
  const [debouncedLabelQuery] = useDebouncedValue(labelSearchQuery, 300);
  const [workspace] = useAtom(workspaceAtom);
  const arePageFiltersDisabled = isAiMode || contentType === "attachment";
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
    !isLabelFilterDisabled,
  );

  const selectedSpaceData = useMemo(() => {
    if (!spacesData?.items || !selectedSpaceId) return null;
    return spacesData.items.find((space) => space.id === selectedSpaceId);
  }, [spacesData?.items, selectedSpaceId]);

  const availableSpaces = useMemo(() => {
    const spaces = spacesData?.items || [];
    if (!selectedSpaceId) return spaces;

    // Sort to put selected space first
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

    if (!selectedSpaceId) {
      return labels;
    }

    return [
      { ...selectedLabel, type: "page", spaceId: selectedSpaceId },
      ...labels,
    ];
  }, [labels, selectedLabel, selectedSpaceId]);

  const emitFilters = (
    nextSpaceId: string | null,
    nextContentType: string | null,
    nextLabel: SelectedSearchLabel | null,
    nextTag: "tbd" | "todo" | null,
  ) => {
    onFiltersChange?.(
      getSearchFilterPayload({
        spaceId: nextSpaceId,
        contentType: nextContentType,
        label: nextLabel,
        tag: nextTag,
        isAiMode,
      }),
    );
  };

  useEffect(() => {
    emitFilters(selectedSpaceId, contentType, selectedLabel, selectedTag);
  }, []);

  useEffect(() => {
    const nextLabel =
      isLabelFilterDisabled && selectedLabel ? null : selectedLabel;
    const nextTag = arePageFiltersDisabled && selectedTag ? null : selectedTag;

    if (nextLabel === selectedLabel && nextTag === selectedTag) {
      return;
    }

    setSelectedLabel(nextLabel);
    setSelectedTag(nextTag);
    emitFilters(selectedSpaceId, contentType, nextLabel, nextTag);
  }, [
    arePageFiltersDisabled,
    contentType,
    isLabelFilterDisabled,
    selectedLabel,
    selectedTag,
    selectedSpaceId,
  ]);

  const contentTypeOptions = getSearchContentTypeOptions(t);

  const handleSpaceSelect = (spaceId: string | null) => {
    setSelectedSpaceId(spaceId);
    setSelectedLabel(null);
    emitFilters(spaceId, contentType, null, selectedTag);
  };

  const handleFilterChange = (filterType: string, value: any) => {
    let newSelectedSpaceId = selectedSpaceId;
    let newContentType = contentType;
    let newSelectedLabel = selectedLabel;
    let newSelectedTag = selectedTag;

    switch (filterType) {
      case "spaceId":
        newSelectedSpaceId = value;
        newSelectedLabel = null;
        setSelectedSpaceId(value);
        setSelectedLabel(null);
        break;
      case "contentType":
        newContentType = value;
        setContentType(value);
        if (value === "attachment") {
          newSelectedLabel = null;
          newSelectedTag = null;
          setSelectedLabel(null);
          setSelectedTag(null);
        }
        break;
    }

    emitFilters(
      newSelectedSpaceId,
      newContentType,
      newSelectedLabel,
      newSelectedTag,
    );
  };

  const handleLabelSelect = (label: SelectedSearchLabel | null) => {
    setSelectedLabel(label);
    emitFilters(selectedSpaceId, contentType, label, selectedTag);
  };

  const handleTagSelect = (tag: "tbd" | "todo" | null) => {
    setSelectedTag(tag);
    emitFilters(selectedSpaceId, contentType, selectedLabel, tag);
  };

  return (
    <div className={classes.filtersContainer}>
      {workspace?.settings?.ai?.search === true && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "32px",
            paddingLeft: "8px",
            paddingRight: "8px",
          }}
        >
          <Switch
            checked={isAiMode}
            onChange={(event) => onAskClick()}
            label={t("AI Answers")}
            size="sm"
            color="blue"
            labelPosition="left"
            styles={{
              root: { display: "flex", alignItems: "center" },
              label: { paddingRight: "8px", fontSize: "13px", fontWeight: 500 },
            }}
          />
        </div>
      )}

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
            autoFocus
            leftSection={<IconSearch size={16} />}
            value={spaceSearchQuery}
            onChange={(e) => setSpaceSearchQuery(e.target.value)}
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
            autoFocus
            leftSection={<IconSearch size={16} />}
            value={labelSearchQuery}
            onChange={(e) => setLabelSearchQuery(e.target.value)}
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

      <Menu
        shadow="md"
        width={190}
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
            disabled={arePageFiltersDisabled}
          >
            {selectedTag
              ? `${t("Tag")}: ${selectedTag.toUpperCase()}`
              : `${t("Tag")}: ${t("Not selected")}`}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => handleTagSelect(null)}>
            <Group flex="1" gap="xs">
              <Text size="sm" style={{ flex: 1 }}>
                {t("Not selected")}
              </Text>
              {!selectedTag && <IconCheck size={20} />}
            </Group>
          </Menu.Item>
          <Divider my="xs" />
          {(["tbd", "todo"] as const).map((tag) => (
            <Menu.Item key={tag} onClick={() => handleTagSelect(tag)}>
              <Group flex="1" gap="xs">
                <Text size="sm" fw={500} style={{ flex: 1 }}>
                  {tag.toUpperCase()}
                </Text>
                {selectedTag === tag && <IconCheck size={20} />}
              </Group>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>

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
              ? `${t("Type")}: ${contentTypeOptions.find((opt) => opt.value === contentType)?.label || t(contentType === "page" ? "Pages" : "Attachments")}`
              : t("Type")}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {contentTypeOptions.map((option) => (
            <Menu.Item
              key={option.value}
              onClick={() =>
                !(isAiMode && option.value === "attachment") &&
                contentType !== option.value &&
                handleFilterChange("contentType", option.value)
              }
              disabled={isAiMode && option.value === "attachment"}
            >
              <Group flex="1" gap="xs">
                <div>
                  <Text size="sm">{option.label}</Text>
                  {isAiMode && option.value === "attachment" && (
                    <Text size="xs" mt={4}>
                      {t("AI Answers not available for attachments")}
                    </Text>
                  )}
                </div>
                {contentType === option.value && <IconCheck size={20} />}
              </Group>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
