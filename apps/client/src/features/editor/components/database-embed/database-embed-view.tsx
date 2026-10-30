import { useContext, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useGetDatabaseQuery } from "@/features/database/queries/database-query";
import { useDatabaseViewsQuery } from "@/features/database/queries/database-table-query";
import { usePageQuery } from "@/features/page/queries/page-query";
import { DatabaseTableView } from "@/features/database/components/database-table-view";
import { getPageById } from "@/features/page/services/page-service";
import { extractPageSlugId } from "@/lib";
import { parseDatabaseEmbedUrl } from "./database-embed-url";
import { PublicDocumentContext } from "./database-embed-context";
import { useEditorEditable } from "../transclusion/use-editor-editable";

export default function DatabaseEmbedView(props: NodeViewProps) {
  const { t } = useTranslation();
  const isPublic = useContext(PublicDocumentContext);
  return (
    <NodeViewWrapper contentEditable={false} data-type="databaseEmbed">
      <Paper withBorder p="sm" radius="md">
        {isPublic ? (
          <Text c="dimmed">{t("dbBoard.sourceUnavailable")}</Text>
        ) : (
          <Source {...props} />
        )}
      </Paper>
    </NodeViewWrapper>
  );
}

function Source({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const editable = useEditorEditable(editor);
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const databaseId =
    typeof node.attrs.databaseId === "string" &&
    /^[a-f0-9-]{36}$/i.test(node.attrs.databaseId)
      ? node.attrs.databaseId
      : undefined;
  const source = useGetDatabaseQuery(databaseId);
  const page = usePageQuery({ pageId: source.data?.pageId ?? undefined });
  const views = useDatabaseViewsQuery(databaseId);
  const connect = async () => {
    setPending(true);
    setError(false);
    try {
      const parsed = parseDatabaseEmbedUrl(url);
      if (!parsed) throw new Error("Invalid internal database URL");
      const sourcePage = await getPageById({
        pageId: extractPageSlugId(parsed.pageSlug),
      });
      if (!sourcePage.databaseId) throw new Error("Not a database");
      updateAttributes({
        databaseId: sourcePage.databaseId,
        viewId: parsed.viewId ?? null,
      });
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  if (!databaseId)
    return (
      <Stack gap="xs">
        <Text fw={600}>{t("dbBoard.embed")}</Text>
        {editable && (
          <Group>
            <TextInput
              aria-label={t("Link")}
              placeholder={t("dbBoard.sourceLink")}
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            <Button loading={pending} onClick={() => void connect()}>
              {t("Insert")}
            </Button>
          </Group>
        )}
        {error && (
          <Text c="red" role="alert">
            {t("dbBoard.sourceUnavailable")}
          </Text>
        )}
      </Stack>
    );
  if (
    source.isError ||
    page.isError ||
    (source.isSuccess && !source.data?.pageId)
  )
    return <Text c="dimmed">{t("dbBoard.sourceUnavailable")}</Text>;
  if (source.isPending || page.isPending)
    return <Loader aria-label={t("Loading...")} />;
  if (
    !source.data ||
    !page.data ||
    source.isError ||
    page.isError ||
    (node.attrs.viewId &&
      views.isSuccess &&
      !views.data.some((v) => v.id === node.attrs.viewId))
  )
    return <Text c="dimmed">{t("dbBoard.sourceUnavailable")}</Text>;
  const spaceSlug = page.data.space?.slug ?? "";
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>{source.data.name}</Text>
        <Button
          variant="subtle"
          component={Link}
          to={`/s/${spaceSlug}/db/${page.data.slugId}`}
        >
          {t("dbBoard.openSource")}
        </Button>
        {editable && (
          <Select
            aria-label={t("View")}
            value={node.attrs.viewId ?? null}
            data={(views.data ?? []).map((v) => ({
              value: v.id,
              label: v.name,
            }))}
            clearable
            onChange={(viewId) => updateAttributes({ viewId })}
          />
        )}
      </Group>
      <DatabaseTableView
        key={`${databaseId}:${node.attrs.viewId ?? ""}`}
        databaseId={databaseId}
        spaceId={source.data.spaceId}
        spaceSlug={spaceSlug}
        isEditable={page.data.access?.capabilities?.canWrite === true}
        initialViewId={node.attrs.viewId ?? undefined}
        embedded
      />
    </Stack>
  );
}
