import { Box, Button, Group, SegmentedControl, Tooltip } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./ai-panel.module.css";

interface AiComposerShellProps {
  contextControl: ReactNode;
  editor: ReactNode;
  children: ReactNode;
  agentAvailable: boolean;
  agentMode: boolean;
  spaceSearchAvailable: boolean;
  spaceSearchEnabled: boolean;
  settingsDisabled: boolean;
  profileControl?: ReactNode;
  /**
   * Rendered next to the mode control. Used for the external-tool consent
   * popover, which only matters in agent mode.
   */
  externalToolsControl?: ReactNode;
  onAgentModeChange: (enabled: boolean) => void;
  onSpaceSearchChange: (enabled: boolean) => void;
}

export function AiComposerShell({
  contextControl,
  editor,
  children,
  agentAvailable,
  agentMode,
  spaceSearchAvailable,
  spaceSearchEnabled,
  settingsDisabled,
  profileControl,
  externalToolsControl,
  onAgentModeChange,
  onSpaceSearchChange,
}: AiComposerShellProps) {
  const { t } = useTranslation();

  return (
    <Box className={classes.composerCard}>
      <Group
        justify="space-between"
        gap="xs"
        wrap="nowrap"
        className={classes.composerToolbar}
      >
        <Group gap={6} wrap="nowrap" className={classes.composerToolbarStart}>
          {contextControl}
          {spaceSearchAvailable && (
            <Tooltip label={t("ai.spaceSearchToggle")} withArrow>
              <Button
                variant={spaceSearchEnabled ? "light" : "subtle"}
                size="compact-sm"
                leftSection={<IconSearch size={15} />}
                disabled={settingsDisabled}
                className={classes.composerSearchButton}
                aria-label={t("ai.spaceSearchToggle")}
                aria-pressed={spaceSearchEnabled}
                onClick={() => onSpaceSearchChange(!spaceSearchEnabled)}
              >
                <span className={classes.composerResponsiveLabel}>
                  {t("ai.composer.spaceSearchShort")}
                </span>
              </Button>
            </Tooltip>
          )}
        </Group>

        <Group gap="xs" wrap="nowrap">
          {profileControl}
          {externalToolsControl}
          {agentAvailable && (
            <Tooltip label={t("ai.agent.modeDescription")} withArrow>
              <SegmentedControl
                size="xs"
                value={agentMode ? "agent" : "chat"}
                disabled={settingsDisabled}
                className={classes.composerModeControl}
                aria-label={t("ai.composer.mode")}
                data={[
                  { label: t("ai.composer.chat"), value: "chat" },
                  { label: t("ai.agent.mode"), value: "agent" },
                ]}
                onChange={(value) => onAgentModeChange(value === "agent")}
              />
            </Tooltip>
          )}
        </Group>
      </Group>

      <Box className={classes.composerEditor}>{editor}</Box>
      {children}
    </Box>
  );
}
