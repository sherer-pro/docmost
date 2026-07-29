import { useMemo } from "react";
import { Anchor, Box, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { IconFile, IconTable, IconTextCaption } from "@tabler/icons-react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { AiCitation } from "@/features/ai/types/ai.types.ts";
import { safeSourceUrl } from "@/features/ai/utils/source-url.ts";
import classes from "./ai-panel.module.css";
import { useTranslation } from "react-i18next";

function SourceIcon({ sourceType }: Pick<AiCitation, "sourceType">) {
  if (sourceType === "attachment" || sourceType === "chat_file") {
    return <IconFile size={14} aria-hidden />;
  }
  if (sourceType === "database_row") {
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
  const html = useMemo(
    () =>
      DOMPurify.sanitize(String(marked.parse(content || "")), {
        USE_PROFILES: { html: true },
      }),
    [content],
  );
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
        <Paper withBorder p="xs" radius="md">
          <Text size="xs" fw={600} mb={6}>
            {t("ai.sources")}
          </Text>
          <Group gap={6}>
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
                        href.startsWith("/") ? undefined : "noopener noreferrer"
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
        </Paper>
      )}
    </Stack>
  );
}
