import { Box } from "@mantine/core";
import React from "react";
import classes from "./responsive-settings-row.module.css";

interface ResponsiveSettingsRowProps {
  children: React.ReactNode;
}

export function ResponsiveSettingsRow({
  children,
}: ResponsiveSettingsRowProps) {
  return <Box className={classes.row}>{children}</Box>;
}

interface ResponsiveSettingsContentProps {
  children: React.ReactNode;
}

export function ResponsiveSettingsContent({
  children,
}: ResponsiveSettingsContentProps) {
  return <Box className={classes.content}>{children}</Box>;
}

interface ResponsiveSettingsControlProps {
  children: React.ReactNode;
}

export function ResponsiveSettingsControl({
  children,
}: ResponsiveSettingsControlProps) {
  return <Box className={classes.control}>{children}</Box>;
}
