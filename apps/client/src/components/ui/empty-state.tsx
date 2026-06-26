import { Stack, Text } from "@mantine/core";
import { type TablerIcon } from "@tabler/icons-react";
import { ReactNode } from "react";
import classes from "./empty-state.module.css";

type EmptyStateProps = {
  icon: TablerIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: EmptyStateProps) {
  return (
    <div className={`${classes.root} ${compact ? classes.compact : ""}`}>
      <Stack align="center" gap="xs">
        <Icon
          size={compact ? 32 : 40}
          stroke={1.5}
          color="var(--mantine-color-dimmed)"
        />
        <Text size={compact ? "sm" : "lg"} fw={500}>
          {title}
        </Text>
        {description && (
          <Text size="sm" c="dimmed" maw={350}>
            {description}
          </Text>
        )}
        {action}
      </Stack>
    </div>
  );
}
