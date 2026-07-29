import { useId, useMemo, useState } from "react";
import { Box, Button, Collapse } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "@mantine/hooks";
import { sanitizeAiMarkdown } from "@/features/ai/utils/ai-markdown.ts";
import classes from "./ai-panel.module.css";

export function AiReasoningDisclosure({ reasoning }: { reasoning: string }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [opened, setOpened] = useState(false);
  const contentId = useId();
  const labelId = `${contentId}-label`;
  const html = useMemo(() => sanitizeAiMarkdown(reasoning || ""), [reasoning]);

  if (!reasoning.trim()) {
    return null;
  }

  return (
    <Box className={classes.reasoning}>
      <Button
        id={labelId}
        variant="subtle"
        color="gray"
        size="compact-xs"
        leftSection={
          opened ? (
            <IconChevronDown size={14} aria-hidden />
          ) : (
            <IconChevronRight size={14} aria-hidden />
          )
        }
        aria-expanded={opened}
        aria-controls={contentId}
        onClick={() => setOpened((value) => !value)}
        className={classes.reasoningToggle}
      >
        {t("ai.reasoning")}
      </Button>
      <Collapse in={opened} transitionDuration={reduceMotion ? 0 : 160}>
        <Box
          id={contentId}
          role="region"
          aria-labelledby={labelId}
          className={`${classes.markdown} ${classes.reasoningContent}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Collapse>
    </Box>
  );
}
