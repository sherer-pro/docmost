import { Box, Group, SegmentedControl, Switch, Tooltip } from "@mantine/core";
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
        data-testid="ai-composer-toolbar"
      >
        <Group gap={6} wrap="nowrap" className={classes.composerToolbarStart}>
          {contextControl}
          {spaceSearchAvailable && (
            <Tooltip label={t("ai.spaceSearchToggle")} withArrow>
              <Switch
                size="sm"
                label={t("ai.composer.spaceSearchShort")}
                disabled={settingsDisabled}
                checked={spaceSearchEnabled}
                className={classes.composerSearchSwitch}
                aria-label={t("ai.spaceSearchToggle")}
                onChange={(event) =>
                  onSpaceSearchChange(event.currentTarget.checked)
                }
              />
            </Tooltip>
          )}
        </Group>

        <Group gap="xs" wrap="nowrap" className={classes.composerToolbarEnd}>
          {externalToolsControl && (
            <Box className={classes.composerExternalTools}>
              {externalToolsControl}
            </Box>
          )}
          {agentAvailable && (
            <Tooltip label={t("ai.agent.modeDescription")} withArrow>
              <SegmentedControl
                size="xs"
                value={agentMode ? "agent" : "chat"}
                disabled={settingsDisabled}
                className={classes.composerModeControl}
                data-testid="ai-composer-mode"
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
