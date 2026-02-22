import { useEffect, useMemo, useState } from "react";
import { ComboboxItem } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useSpaceMembersQuery } from "@/features/space/queries/space-query.ts";
import { ISpaceMember, SpaceUserInfo } from "@/features/space/types/space.types.ts";

export interface SpaceMemberSelectOption extends ComboboxItem {
  avatarUrl?: string;
  email?: string;
}

function isUserMember(member: ISpaceMember): member is { role: string } & SpaceUserInfo {
  return member.type === "user";
}

export function useSpaceMemberSelectOptions(spaceId: string, selectedIds: string[]) {
  const [searchValue, setSearchValue] = useState("");
  const [debouncedQuery] = useDebouncedValue(searchValue, 400);
  const [knownUsersById, setKnownUsersById] = useState<Record<string, SpaceMemberSelectOption>>({});

  const { data, isLoading } = useSpaceMembersQuery(spaceId, {
    query: debouncedQuery,
    limit: 20,
  });

  useEffect(() => {
    const userItems = (data?.items ?? []).filter(isUserMember);

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
    const currentItems = (data?.items ?? [])
      .filter(isUserMember)
      .map((member) => ({
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
