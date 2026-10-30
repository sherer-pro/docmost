import { Checkbox, Group, Select, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchSuggestionsQuery } from "../queries/search-query";

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
  const [debounced] = useDebouncedValue(query, 250);
  const names = useRef(new Map<string, string>());
  const users = useSearchSuggestionsQuery({
    query: debounced,
    includeUsers: true,
    spaceId,
    limit: 20,
    preload: true,
  });
  const data = (users.data?.users ?? [])
    .filter((user) => Boolean(user?.id))
    .map((user) => {
      names.current.set(user.id, user.name);
      return { value: user.id, label: user.name };
    });
  if (value.creatorId && !data.some((user) => user.value === value.creatorId))
    data.push({
      value: value.creatorId,
      label: names.current.get(value.creatorId) ?? t("Unknown"),
    });
  return (
    <Group gap="sm" wrap="wrap">
      <Select
        label={t("searchEnhancements.author")}
        searchable
        clearable
        w={220}
        value={value.creatorId ?? null}
        searchValue={query}
        onSearchChange={setQuery}
        data={data}
        onChange={(creatorId) => onChange({ ...value, creatorId })}
        nothingFoundMessage={t("No results")}
      />
      <Checkbox
        label={t("searchEnhancements.titleOnly")}
        checked={value.titleOnly ?? false}
        onChange={(event) =>
          onChange({ ...value, titleOnly: event.currentTarget.checked })
        }
      />
      {users.isError && (
        <Text size="xs" c="red" role="status">
          {t("An error occurred")}
        </Text>
      )}
    </Group>
  );
}
