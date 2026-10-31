import { useContext } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconBrandFigma,
  IconBrandGithub,
  IconBrandGitlab,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { parseIntegrationPreviewUrl } from "@docmost/editor-ext";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { useEditorPageId } from "@/features/editor/hooks/use-editor-page-id";
import { PublicDocumentContext } from "../database-embed/database-embed-context";
import { resolveIntegrationPreview } from "@/features/integration-preview/integration-preview-service";
import classes from "./integration-preview.module.css";

export default function IntegrationPreviewView({
  node,
  editor,
  selected,
}: NodeViewProps) {
  const { t } = useTranslation();
  const publicDocument = useContext(PublicDocumentContext);
  const current = useAtomValue(currentUserAtom);
  const target = parseIntegrationPreviewUrl(node.attrs.url);
  const pageId = useEditorPageId(editor);
  const query = useQuery({
    queryKey: [
      "integration-previews",
      "resolved",
      current?.user?.id,
      pageId,
      target?.url,
    ],
    queryFn: () => resolveIntegrationPreview(pageId!, target!.url),
    enabled: !publicDocument && !!current?.user?.id && !!pageId && !!target,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const inline = node.type.name === "integrationMention";
  const data =
    !publicDocument && query.data?.status === "ready" ? query.data : null;
  const Icon =
    target?.provider === "figma"
      ? IconBrandFigma
      : target?.provider === "gitlab"
        ? IconBrandGitlab
        : IconBrandGithub;
  const status = query.isError ? "unavailable" : query.data?.status;
  if (!target)
    return (
      <NodeViewWrapper as={inline ? "span" : "div"} contentEditable={false}>
        <Text component="span" c="dimmed">
          {t("integrationPreviews.unavailable")}
        </Text>
      </NodeViewWrapper>
    );
  const title = data?.title || target.url;
  const link = (
    <Anchor
      href={target.url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      className={classes.title}
    >
      {title}
    </Anchor>
  );
  if (inline)
    return (
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-type="integrationMention"
        className={classes.mention}
        data-selected={selected || undefined}
      >
        <Tooltip label={target.url}>
          <span>
            <Icon size={15} aria-hidden />
            {link}
          </span>
        </Tooltip>
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper
      contentEditable={false}
      data-type="integrationPreview"
      className={classes.card}
      data-selected={selected || undefined}
    >
      <Paper
        withBorder
        p="sm"
        radius="md"
        aria-busy={query.isFetching || undefined}
      >
        <Stack gap={6}>
          <Group gap="xs">
            <Icon size={20} aria-hidden />
            <Text size="xs" c="dimmed">
              {target.provider === "github"
                ? "GitHub"
                : target.provider === "gitlab"
                  ? "GitLab"
                  : "Figma"}
            </Text>
            {data?.state && (
              <Badge size="sm" variant="light">
                {t(`integrationPreviews.state.${data.state}`)}
              </Badge>
            )}
          </Group>
          {link}
          {data?.description && (
            <Text size="sm" lineClamp={3}>
              {data.description}
            </Text>
          )}
          {!publicDocument && status && status !== "ready" && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {t(`integrationPreviews.${status}`)}
              </Text>
              {status === "connectionRequired" ? (
                <Button
                  component={Link}
                  to="/settings/account/connections?tab=previews"
                  size="compact-xs"
                  mih={32}
                  variant="subtle"
                >
                  {t("integrationPreviews.connections")}
                </Button>
              ) : (
                status !== "disabled" && (
                  <Button
                    size="compact-xs"
                    mih={32}
                    variant="subtle"
                    loading={query.isFetching}
                    onClick={() => query.refetch()}
                  >
                    {t("integrationPreviews.retry")}
                  </Button>
                )
              )}
            </Group>
          )}
        </Stack>
      </Paper>
    </NodeViewWrapper>
  );
}
