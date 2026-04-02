import React from "react";
import { ComboboxParsedItem, Group, MultiSelectProps, SelectProps, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ComboboxItem } from "@mantine/core";
import { getSpaceMemberUsers } from "@/features/space/services/space-service.ts";
import { resolvePageAccessUsers } from "@/features/page/services/page-service.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";

export interface SpaceMemberSelectOption extends ComboboxItem {
  avatarUrl?: string;
  email?: string;
}

function isSpaceMemberSelectOption(option: ComboboxParsedItem): option is SpaceMemberSelectOption {
  return "value" in option && "label" in option;
}

interface SpaceMemberSearchConfig {
  placeholder: string;
  loadingMessage: string;
  nothingFoundMessage: string;
}

interface SpaceMemberSelectOptionsConfig {
  pageId?: string;
}

type SpaceMemberSearchProps = Pick<
  SelectProps,
  | "placeholder"
  | "searchable"
  | "clearable"
  | "filter"
  | "searchValue"
  | "onSearchChange"
  | "renderOption"
  | "nothingFoundMessage"
>;

/**
 * Normalizes member field values to a plain id string.
 *
 * Contract: the caller may pass a direct string id or an object in the `{ id: string }`
 * format used by database user cells. The object fallback keeps compatibility with older
 * payload shapes and mixed form states where the value is already partially normalized.
 */
export function normalizeSpaceMemberValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "id" in value) {
    const candidate = (value as { id?: unknown }).id;
    return typeof candidate === "string" ? candidate : null;
  }

  return null;
}

export const renderSpaceMemberOption: SelectProps["renderOption"] & MultiSelectProps["renderOption"] = ({
  option,
}) => {
  const member = option as SpaceMemberSelectOption;

  return (
    <Group gap="sm" wrap="nowrap">
      <CustomAvatar avatarUrl={member.avatarUrl} size={20} name={member.label} />
      <div>
        <Text size="sm" lineClamp={1}>
          {member.label}
        </Text>
        {member.email && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {member.email}
          </Text>
        )}
      </div>
    </Group>
  );
};

export function renderSpaceMemberValue(member?: SpaceMemberSelectOption | null) {
  if (!member) {
    return undefined;
  }

  return <CustomAvatar avatarUrl={member.avatarUrl} size={18} name={member.label} />;
}

export function getSpaceMemberSearchProps(
  config: SpaceMemberSearchConfig,
  searchValue: string,
  setSearchValue: (value: string) => void,
  isLoading: boolean,
): SpaceMemberSearchProps {
  return {
    placeholder: config.placeholder,
    searchable: true,
    clearable: true,
    filter: ({ options }) => options.filter(isSpaceMemberSelectOption),
    searchValue,
    onSearchChange: setSearchValue,
    renderOption: renderSpaceMemberOption,
    nothingFoundMessage: isLoading ? config.loadingMessage : config.nothingFoundMessage,
  };
}

export function useSpaceMemberSelectOptions(
  spaceId: string,
  selectedIds: string[],
  config?: SpaceMemberSelectOptionsConfig,
) {
  const [searchValue, setSearchValue] = useState("");
  const [debouncedQuery] = useDebouncedValue(searchValue, 400);
  const [knownUsersById, setKnownUsersById] = useState<Record<string, SpaceMemberSelectOption>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["spaceMemberUsers", spaceId, debouncedQuery],
    queryFn: () =>
      getSpaceMemberUsers(spaceId, {
        query: debouncedQuery,
        limit: 20,
      }),
    enabled: !!spaceId,
  });

  const unresolvedSelectedIds = useMemo(
    () =>
      [...new Set(selectedIds.filter((id) => !!id && !knownUsersById[id]))],
    [knownUsersById, selectedIds],
  );

  const { data: resolvedPageUsers } = useQuery({
    queryKey: ["pageAccessResolvedUsers", config?.pageId, unresolvedSelectedIds],
    queryFn: () =>
      resolvePageAccessUsers(config?.pageId ?? "", {
        userIds: unresolvedSelectedIds,
      }),
    enabled: Boolean(config?.pageId && unresolvedSelectedIds.length > 0),
  });

  useEffect(() => {
    const userItems = data?.items ?? [];

    if (!userItems.length) {
      return;
    }

    setKnownUsersById((current) => {
      const next = { ...current };

      userItems.forEach((member) => {
        next[member.id] = {
          value: member.id,
          label: member.name,
          avatarUrl: member.avatarUrl,
          email: member.email,
        };
      });

      return next;
    });
  }, [data]);

  useEffect(() => {
    if (!resolvedPageUsers?.length) {
      return;
    }

    setKnownUsersById((current) => {
      const next = { ...current };

      resolvedPageUsers.forEach((user) => {
        next[user.id] = {
          value: user.id,
          label: user.name || user.email || user.id,
          avatarUrl: user.avatarUrl ?? undefined,
          email: user.email,
        };
      });

      return next;
    });
  }, [resolvedPageUsers]);

  const options = useMemo(() => {
    const currentItems = (data?.items ?? []).map((member) => ({
      value: member.id,
      label: member.name,
      avatarUrl: member.avatarUrl,
      email: member.email,
    }));

    const selectedItems = selectedIds
      .map((id) => knownUsersById[id] ?? { value: id, label: id })
      .filter((item, index, array) => array.findIndex((candidate) => candidate.value === item.value) === index);

    return [...selectedItems, ...currentItems].filter(
      (item, index, array) => array.findIndex((candidate) => candidate.value === item.value) === index,
    );
  }, [data?.items, knownUsersById, selectedIds]);

  return {
    options,
    searchValue,
    setSearchValue,
    isLoading,
    knownUsersById,
  };
}
