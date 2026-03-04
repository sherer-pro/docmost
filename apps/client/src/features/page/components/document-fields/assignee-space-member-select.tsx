import React from "react";
import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  getSpaceMemberSearchProps,
  renderSpaceMemberValue,
  useSpaceMemberSelectOptions,
} from "@/features/page/components/document-fields/space-member-select-utils.tsx";

interface AssigneeSpaceMemberSelectProps {
  spaceId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
}

export function AssigneeSpaceMemberSelect({ spaceId, value, onChange, onBlur }: AssigneeSpaceMemberSelectProps) {
  const { t } = useTranslation();
  const { options, searchValue, setSearchValue, isLoading, knownUsersById } = useSpaceMemberSelectOptions(
    spaceId,
    value ? [value] : [],
  );

  // In readOnly/controlled state, show the avatar of the currently selected member.
  const selectedMember = value ? knownUsersById[value] : undefined;

  return (
    <Select
      data={options}
      value={value}
      onChange={(nextValue) => onChange(nextValue || null)}
      {...getSpaceMemberSearchProps(
        {
          placeholder: t("Select member"),
          loadingMessage: t("Loading..."),
          nothingFoundMessage: t("No members found"),
        },
        searchValue,
        setSearchValue,
        isLoading,
      )}
      leftSection={renderSpaceMemberValue(selectedMember)}
      onBlur={onBlur}
    />
  );
}

export default AssigneeSpaceMemberSelect;
