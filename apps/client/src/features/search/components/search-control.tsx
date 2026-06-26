import { IconSearch } from "@tabler/icons-react";
import cx from "clsx";
import {
  BoxProps,
  ElementProps,
  Group,
  rem,
  Text,
  UnstyledButton,
} from "@mantine/core";
import classes from "./search-control.module.css";
import React from "react";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";

interface SearchControlProps extends BoxProps, ElementProps<"button"> {}

export function SearchControl({ className, ...others }: SearchControlProps) {
  const { t } = useTranslation();

  return (
    <UnstyledButton
      aria-label={t("Search")}
      {...others}
      className={cx(classes.root, className)}
    >
      <Group gap="xs" wrap="nowrap">
        <IconSearch style={{ width: rem(15), height: rem(15) }} stroke={1.5} />
        <Text fz="sm" c="dimmed" pr={80}>
          {t("Search")}
        </Text>
        <Text fw={700} className={classes.shortcut}>
          {t("Ctrl + K")}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

interface SearchMobileControlProps {
  onSearch: () => void;
}

export function SearchMobileControl({ onSearch }: SearchMobileControlProps) {
  const { t } = useTranslation();

  return (
    <AccessibleActionIcon
      label={t("Search")}
      variant="subtle"
      color="dark"
      onClick={onSearch}
    >
      <IconSearch size={20} stroke={2} />
    </AccessibleActionIcon>
  );
}
