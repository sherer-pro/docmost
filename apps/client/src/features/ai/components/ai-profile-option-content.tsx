import { Box, Text } from "@mantine/core";
import classes from "./ai-panel.module.css";

export function AiProfileOptionContent({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <Box className={classes.composerProfileOptionContent}>
      <Text size="sm" fw={600} lineClamp={1}>
        {label}
      </Text>
      <Text
        size="xs"
        c="dimmed"
        lineClamp={2}
        data-testid="ai-profile-option-description"
      >
        {description}
      </Text>
    </Box>
  );
}
