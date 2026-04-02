import React from "react";
import { MultiSelect } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  getSpaceMemberSearchProps,
  useSpaceMemberSelectOptions,
} from "@/features/page/components/document-fields/space-member-select-utils.tsx";

interface StakeholdersSpaceMemberMultiSelectProps {
  pageId: string;
  spaceId: string;
  value: string[];
  onChange: (value: string[]) => void;
  onBlur?: () => void;
}

export function StakeholdersSpaceMemberMultiSelect({
  pageId,
  spaceId,
  value,
  onChange,
  onBlur,
}: StakeholdersSpaceMemberMultiSelectProps) {
  const { t } = useTranslation();
  // Options are limited to members of the current space; search is performed on the server.
  const { options, searchValue, setSearchValue, isLoading } = useSpaceMemberSelectOptions(
    spaceId,
    value,
    { pageId },
  );

  return (
    <MultiSelect
      data={options}
      value={value}
      onChange={onChange}
      {...getSpaceMemberSearchProps(
        {
          placeholder: t("Select members"),
          loadingMessage: t("Loading..."),
          nothingFoundMessage: t("No members found"),
        },
        searchValue,
        setSearchValue,
        isLoading,
      )}
      hidePickedOptions
      onBlur={onBlur}
    />
  );
}

export default StakeholdersSpaceMemberMultiSelect;
