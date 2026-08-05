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
  wide?: boolean;
}

export function ResponsiveSettingsControl({
  children,
  wide = false,
}: ResponsiveSettingsControlProps) {
  return (
    <Box
      className={[classes.control, wide && classes.wide]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Box>
  );
}
