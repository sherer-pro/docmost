import { Box } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./ai-panel.module.css";

interface AiComposerShellProps {
  contextRail?: ReactNode;
  editor: ReactNode;
  commandPalette?: ReactNode;
  children: ReactNode;
}

export function AiComposerShell({
  contextRail,
  editor,
  commandPalette,
  children,
}: AiComposerShellProps) {
  return (
    <Box className={classes.composerCard}>
      {contextRail && (
        <Box
          className={classes.composerContextRail}
          data-testid="ai-composer-context-rail"
        >
          {contextRail}
        </Box>
      )}
      <Box className={classes.composerEditor}>{editor}</Box>
      {commandPalette}
      {children}
    </Box>
  );
}
