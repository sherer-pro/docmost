import { useMemo, useState } from "react";
import {
  Anchor,
  Box,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconTable,
  IconTextCaption,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { AiCitation } from "@/features/ai/types/ai.types.ts";
import { safeSourceUrl } from "@/features/ai/utils/source-url.ts";
import { sanitizeAiMarkdown } from "@/features/ai/utils/ai-markdown.ts";
import classes from "./ai-panel.module.css";

function SourceIcon({ sourceType }: Pick<AiCitation, "sourceType">) {
  if (sourceType === "attachment" || sourceType === "chat_file") {
    return <IconFile size={14} aria-hidden />;
  }
  if (sourceType === "database" || sourceType === "database_row") {
    return <IconTable size={14} aria-hidden />;
  }
  return <IconTextCaption size={14} aria-hidden />;
}

export function AiMessageContent({
  content,
  sources = [],
}: {
  content: string;
  sources?: AiCitation[];
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [sourcesOpened, setSourcesOpened] = useState(false);
  const html = useMemo(() => sanitizeAiMarkdown(content || ""), [content]);
  const sortedSources = useMemo(
    () => [...sources].sort((left, right) => left.position - right.position),
    [sources],
  );

  return (
    <Stack gap="xs">
      <Box
        className={classes.markdown}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {sortedSources.length > 0 && (
        <Box className={classes.sourcesDisclosure}>
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            leftSection={
              sourcesOpened ? (
                <IconChevronDown size={14} aria-hidden />
              ) : (
                <IconChevronRight size={14} aria-hidden />
              )
            }
            aria-expanded={sourcesOpened}
            onClick={() => setSourcesOpened((value) => !value)}
          >
            {t("ai.sources")} · {sortedSources.length}
          </Button>
          <Collapse
            in={sourcesOpened}
            transitionDuration={reduceMotion ? 0 : 160}
          >
            <Group gap={6} mt={6}>
              {sortedSources.map((source) => {
                const href = safeSourceUrl(source.sourceUrl);
                const label = `S${source.position + 1} · ${source.sourceTitle}`;
                const chip = (
                  <Group gap={4} wrap="nowrap">
                    <SourceIcon sourceType={source.sourceType} />
                    <Text size="xs" lineClamp={1}>
                      {label}
                    </Text>
                  </Group>
                );

                return (
                  <Tooltip
                    key={source.id}
                    label={source.excerpt || source.sourceTitle}
                    multiline
                    maw={320}
                  >
                    {href ? (
                      <Anchor
                        href={href}
                        target={href.startsWith("/") ? undefined : "_blank"}
                        rel={
                          href.startsWith("/")
                            ? undefined
                            : "noopener noreferrer"
                        }
                        className={classes.sourceChip}
                      >
                        {chip}
                      </Anchor>
                    ) : (
                      <Box className={classes.sourceChip}>{chip}</Box>
                    )}
                  </Tooltip>
                );
              })}
            </Group>
          </Collapse>
        </Box>
      )}
    </Stack>
  );
}
