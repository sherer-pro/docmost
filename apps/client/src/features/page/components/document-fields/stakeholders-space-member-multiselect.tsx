import React from "react";
import { Group, MultiSelect, MultiSelectProps, Text } from "@mantine/core";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import {
  SpaceMemberSelectOption,
  useSpaceMemberSelectOptions,
} from "@/features/page/components/document-fields/space-member-select-utils.ts";

interface StakeholdersSpaceMemberMultiSelectProps {
  spaceId: string;
  value: string[];
  onChange: (value: string[]) => void;
}

const renderMultiSelectOption: MultiSelectProps["renderOption"] = ({ option }) => {
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

export function StakeholdersSpaceMemberMultiSelect({
  spaceId,
  value,
  onChange,
}: StakeholdersSpaceMemberMultiSelectProps) {
  const { options, searchValue, setSearchValue, isLoading } = useSpaceMemberSelectOptions(spaceId, value);

  return (
    <MultiSelect
      data={options}
      value={value}
      onChange={onChange}
      placeholder="Select stakeholders"
      searchable
      clearable
      filter={({ options }) => options}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      renderOption={renderMultiSelectOption}
      nothingFoundMessage={isLoading ? "Loading..." : "No members found"}
      hidePickedOptions
    />
  );
}

export default StakeholdersSpaceMemberMultiSelect;
