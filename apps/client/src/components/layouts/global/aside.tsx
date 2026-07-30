import { Box, CloseButton, Group, ScrollArea, Text } from "@mantine/core";
import CommentListWithTabs from "@/features/comment/components/comment-list-with-tabs.tsx";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import React, { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TableOfContents } from "@/features/editor/components/table-of-contents/table-of-contents.tsx";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { AiPanel } from "@/features/ai/components/ai-panel.tsx";
import { useAiAssistantIdentity } from "@/features/ai/hooks/use-ai-assistant-identity.ts";

export default function Aside() {
  const [{ tab }, setAsideState] = useAtom(asideStateAtom);
  const { t } = useTranslation();
  const assistantIdentity = useAiAssistantIdentity();
  const pageEditor = useAtomValue(pageEditorAtom);

  let title: string;
  let component: ReactNode;

  switch (tab) {
    case "comments":
      component = <CommentListWithTabs />;
      title = t("Comments");
      break;
    case "toc":
      component = <TableOfContents editor={pageEditor} />;
      title = t("Table of contents");
      break;
    case "ai":
      component = null;
      title = assistantIdentity.name;
      break;
    default:
      component = null;
      title = "";
  }

  return (
    <Box
      p="md"
      h="100%"
      style={{
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {(component || tab === "ai") && (
        <>
          <Group justify="space-between" mb="sm" wrap="nowrap">
            <Text fw={500} truncate title={title} style={{ minWidth: 0 }}>
              {title}
            </Text>
            <CloseButton
              aria-label={t("Close panel")}
              size="md"
              onClick={() => setAsideState({ tab, isAsideOpen: false })}
            />
          </Group>

          <Box
            style={{
              display: tab === "ai" ? "block" : "none",
              flex: tab === "ai" ? "1 1 auto" : undefined,
              minHeight: 0,
            }}
            aria-hidden={tab === "ai" ? undefined : true}
          >
            <AiPanel />
          </Box>

          {tab === "comments" ? (
            component
          ) : tab === "ai" ? null : (
            <ScrollArea
              style={{ height: "85vh" }}
              scrollbarSize={5}
              type="scroll"
            >
              <div style={{ paddingBottom: "200px" }}>{component}</div>
            </ScrollArea>
          )}
        </>
      )}
    </Box>
  );
}
