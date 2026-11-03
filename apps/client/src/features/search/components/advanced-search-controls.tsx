import {
  Button,
  Checkbox,
  Group,
  Select,
  Text,
  getDefaultZIndex,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchSuggestionsQuery } from "../queries/search-query";
import classes from "./search-spotlight-filters.module.css";

export interface AdvancedSearchOptions {
  creatorId?: string | null;
  titleOnly?: boolean;
}

export function AdvancedSearchControls({
  spaceId,
  value,
  onChange,
}: {
  spaceId?: string;
  value: AdvancedSearchOptions;
  onChange: (value: AdvancedSearchOptions) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const searchTerm = query.trim().slice(0, 512);
  const [debounced] = useDebouncedValue(searchTerm, 250);
  const names = useRef(new Map<string, string>());
  const nameKey = (id: string) => `${spaceId ?? ""}:${id}`;
  const users = useSearchSuggestionsQuery({
    query: debounced,
    includeUsers: true,
    spaceId,
    limit: 20,
  });
  const isCurrentQuery = Boolean(searchTerm && debounced === searchTerm);
  const data = (isCurrentQuery ? (users.data?.users ?? []) : [])
    .filter((user) => Boolean(user?.id))
    .map((user) => {
      names.current.set(nameKey(user.id), user.name);
      return { value: user.id, label: user.name };
    });
  if (value.creatorId && !data.some((user) => user.value === value.creatorId))
    data.push({
      value: value.creatorId,
      label: names.current.get(nameKey(value.creatorId)) ?? t("Unknown"),
    });
  return (
    <Group gap="sm" wrap="wrap" className={classes.advancedControls}>
      <Select
        label={t("searchEnhancements.author")}
        searchable
        clearable
        comboboxProps={{ zIndex: getDefaultZIndex("max") + 1 }}
        className={classes.authorSelect}
        value={value.creatorId ?? null}
        searchValue={query}
        onSearchChange={setQuery}
        onBlur={() => {
          // Preserve the failed lookup while focus moves to its retry action.
          if (isCurrentQuery && users.isError) setQuery(query);
        }}
        data={data}
        onChange={(creatorId) => onChange({ ...value, creatorId })}
        nothingFoundMessage={
          !searchTerm
            ? t("searchEnhancements.searchAuthorsPrompt")
            : !isCurrentQuery || users.isFetching
              ? t("Loading...")
              : users.isError
                ? t("An error occurred")
                : t("No results")
        }
      />
      <Checkbox
        label={t("searchEnhancements.titleOnly")}
        checked={value.titleOnly ?? false}
        onChange={(event) =>
          onChange({ ...value, titleOnly: event.currentTarget.checked })
        }
      />
      {isCurrentQuery && users.isError && (
        <>
          <Text size="xs" c="red" role="status">
            {t("An error occurred")}
          </Text>
          <Button
            variant="subtle"
            size="compact-xs"
            mih={32}
            loading={users.isFetching}
            onClick={() => void users.refetch()}
          >
            {t("Retry")}
          </Button>
        </>
      )}
    </Group>
  );
}
