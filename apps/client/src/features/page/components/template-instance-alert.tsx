import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { IconExternalLink, IconLink, IconLinkOff } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useAtomValue } from "jotai";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import {
  PAGE_DETAILS_QUERY_KEYS,
  usePageTemplateProvenanceQuery,
} from "@/features/page/queries/page-details-query";
import {
  detachSyncedPageTemplate,
  hashProseMirrorJson,
} from "@/features/page-template/services/page-template-api";
import { queryClient } from "@/lib/query-client";

export function TemplateInstanceAlert({
  pageId,
  editable,
}: {
  pageId: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const { data, isLoading } = usePageTemplateProvenanceQuery(pageId);
  const [detachOpened, setDetachOpened] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [detaching, setDetaching] = useState(false);

  if (isLoading) return <Skeleton h={72} radius="md" mb="sm" />;
  if (
    !data?.createdFromTemplate ||
    data.kind !== "synced" ||
    data.status === "detached"
  ) {
    return null;
  }

  const detach = async () => {
    if (!editor) return;
    setDetaching(true);
    try {
      await detachSyncedPageTemplate({
        pageId,
        baseContentHash: await hashProseMirrorJson(editor.getJSON()),
      });
      await queryClient.invalidateQueries({
        queryKey: PAGE_DETAILS_QUERY_KEYS.templateProvenance(pageId),
      });
      setDetachOpened(false);
      notifications.show({ message: t("Page detached from template") });
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ??
          t("Could not detach page from template."),
      });
    } finally {
      setDetaching(false);
    }
  };

  return (
    <>
      <Alert
        color={data.status === "error" ? "red" : "teal"}
        variant="light"
        radius="md"
        icon={<IconLink size={20} />}
        title={t("Linked to a synchronized template")}
        mb="sm"
      >
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Badge variant="light">
              {data.status === "syncing"
                ? t("Updating")
                : data.status === "error"
                  ? t("Update failed")
                  : t("Up to date")}
            </Badge>
            <Text size="sm" c="dimmed">
              {t("Version {{current}} of {{latest}}", {
                current: data.appliedRevision ?? "—",
                latest: data.latestRevision ?? "—",
              })}
            </Text>
          </Group>
          <Group gap="xs">
            {data.sourceTemplate && data.canReadTemplate && (
              <Button
                component={Link}
                to={`/p/${data.sourceTemplate.slugId}`}
                variant="subtle"
                leftSection={<IconExternalLink size={16} />}
              >
                {t("Open template")}
              </Button>
            )}
            {editable && data.canDetach && (
              <Button
                variant="subtle"
                color="red"
                leftSection={<IconLinkOff size={16} />}
                onClick={() => {
                  setConfirmed(false);
                  setDetachOpened(true);
                }}
              >
                {t("Detach")}
              </Button>
            )}
          </Group>
        </Group>
        {!data.canReadTemplate && (
          <Text size="sm" c="dimmed" mt="xs">
            {t(
              "The source template is restricted, but this page remains usable.",
            )}
          </Text>
        )}
      </Alert>

      <Modal
        opened={detachOpened}
        onClose={() => setDetachOpened(false)}
        title={t("Detach from synchronized template?")}
        centered
      >
        <Stack>
          <Text size="sm">
            {t(
              "The current visible content will stay, but this page will never receive future template updates. It cannot be linked again.",
            )}
          </Text>
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            label={t("I understand this action is irreversible")}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDetachOpened(false)}>
              {t("Cancel")}
            </Button>
            <Button
              color="red"
              disabled={!confirmed || !editor}
              loading={detaching}
              onClick={() => void detach()}
            >
              {t("Detach and make a regular page")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
