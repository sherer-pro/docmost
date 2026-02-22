import React from "react";
import { Group, Select, SelectProps, Text } from "@mantine/core";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import {
  SpaceMemberSelectOption,
  useSpaceMemberSelectOptions,
} from "@/features/page/components/document-fields/space-member-select-utils.ts";

interface AssigneeSpaceMemberSelectProps {
  spaceId: string;
  value: string | null;
  onChange: (value: string | null) => void;
}

const renderSelectOption: SelectProps["renderOption"] = ({ option }) => {
  const member = option as SpaceMemberSelectOption;

  return (
    <Group gap="sm" wrap="nowrap">
      <CustomAvatar avatarUrl={member.avatarUrl} size={20} name={member.label} />
      <div>
        <Text size="sm" lineClamp={1}>{member.label}</Text>
        {member.email && <Text size="xs" c="dimmed" lineClamp={1}>{member.email}</Text>}
      </div>
    </Group>
  );
};

export function AssigneeSpaceMemberSelect({ spaceId, value, onChange }: AssigneeSpaceMemberSelectProps) {
  const { options, searchValue, setSearchValue, isLoading, knownUsersById } = useSpaceMemberSelectOptions(
    spaceId,
    value ? [value] : [],
  );

  const selectedMember = value ? knownUsersById[value] : undefined;

  return (
    <Select
      data={options}
      value={value}
      onChange={(nextValue) => onChange(nextValue || null)}
      placeholder="Select assignee"
      searchable
      clearable
      filter={({ options }) => options}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      renderOption={renderSelectOption}
      leftSection={
        selectedMember ? (
          <CustomAvatar avatarUrl={selectedMember.avatarUrl} size={18} name={selectedMember.label} />
        ) : undefined
      }
      nothingFoundMessage={isLoading ? "Loading..." : "No members found"}
    />
  );
}

export default AssigneeSpaceMemberSelect;
