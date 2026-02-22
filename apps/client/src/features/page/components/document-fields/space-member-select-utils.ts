import { useEffect, useMemo, useState } from "react";
import { ComboboxItem } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { getSpaceMemberUsers } from "@/features/space/services/space-service.ts";
import { SpaceUserInfo } from "@/features/space/types/space.types.ts";

export interface SpaceMemberSelectOption extends ComboboxItem {
  avatarUrl?: string;
  email?: string;
}

export function useSpaceMemberSelectOptions(spaceId: string, selectedIds: string[]) {
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
