import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconLinkOff,
  IconRefresh,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useAtomValue } from "jotai";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import {
  PAGE_DETAILS_QUERY_KEYS,
  usePageTemplateProvenanceQuery,
} from "@/features/page/queries/page-details-query";
import {
  createIndependentPageCopy,
  detachSyncedPageTemplate,
} from "@/features/page-template/services/page-template-api";
import { hashTemplateInstanceContent } from "@/features/page-template/services/page-template-draft-hash";
import { queryClient } from "@/lib/query-client";
import { invalidateSidebarTree } from "@/features/page/queries/cache-invalidation";
import { buildPageUrl } from "@/features/page/page.utils";
import type { TemplateInstanceStatus } from "@/features/page-template/types/page-template.types";
import { getTemplateSyncErrorLabel } from "./template-sync-status";

const DETACHABLE_TEMPLATE_STATUSES: TemplateInstanceStatus[] = [
  "active",
  "syncing",
  "error",
];

export function TemplateInstanceAlert({
  pageId,
  editable,
}: {
  pageId: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const editor = useAtomValue(pageEditorAtom);
  const { data, isLoading, isError, isFetching, refetch } =
    usePageTemplateProvenanceQuery(pageId);
  const [detachOpened, setDetachOpened] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [copying, setCopying] = useState(false);

  if (isLoading) return <Skeleton h={46} radius="md" mb="sm" />;

  if (isError) {
    return (
      <Paper
        component="section"
        withBorder
        radius="md"
        px="sm"
        py={8}
        mb="sm"
        aria-label={t("Linked template status")}
      >
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            <IconAlertTriangle
              size={18}
              color="var(--mantine-color-red-6)"
              aria-hidden="true"
            />
            <div>
              <Text fw={600} size="sm">
                {t("Could not load template details.")}
              </Text>
              <Text size="xs" c="dimmed">
                {t(
                  "This page remains available. Try loading its link status again.",
                )}
              </Text>
            </div>
          </Group>
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<IconRefresh size={15} />}
            loading={isFetching}
            onClick={() => void refetch()}
          >
            {t("Retry")}
          </Button>
        </Group>
      </Paper>
    );
  }

  if (
    !data?.createdFromTemplate ||
    data.kind !== "synced" ||
    data.status === "detached"
  ) {
    return null;
  }

  const canDetach =
    editable &&
    data.canDetach === true &&
    DETACHABLE_TEMPLATE_STATUSES.includes(data.status ?? "active");
  const provenanceBroken =
    data.provenanceState === "source_missing" ||
    data.provenanceState === "invalid";

  const detach = async () => {
    if (!editor) return;
    setDetaching(true);
    try {
      await detachSyncedPageTemplate({
        pageId,
        baseContentHash: await hashTemplateInstanceContent(editor.getJSON()),
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

  const createIndependentCopy = async () => {
    setCopying(true);
    try {
      const { page: copiedPage } = await createIndependentPageCopy({ pageId });
      invalidateSidebarTree(
        { spaceId: copiedPage.spaceId },
        { client: queryClient },
      );
      navigate(
        copiedPage.space?.slug
          ? buildPageUrl(
              copiedPage.space.slug,
              copiedPage.slugId,
              copiedPage.title,
            )
          : `/p/${copiedPage.slugId}`,
      );
      notifications.show({ message: t("Independent copy created") });
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ??
          t("Could not create independent copy."),
      });
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <Paper
        component="section"
        withBorder
        radius="md"
        px="sm"
        py={8}
        mb="sm"
        aria-label={t("Linked template status")}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            {provenanceBroken ? (
              <IconAlertTriangle
                size={18}
                color="var(--mantine-color-red-6)"
                aria-hidden="true"
              />
            ) : (
              <IconLink size={18} aria-hidden="true" />
            )}
            <Text fw={600} size="sm">
              {data.provenanceState === "source_missing"
                ? t("The source template is no longer available.")
                : data.provenanceState === "invalid"
                  ? t("Could not load template details.")
                  : (data.sourceTemplate?.title ?? t("Linked page"))}
            </Text>
            {!provenanceBroken && (
              <TemplateInstanceStatusBadge status={data.status} />
            )}
            <Text size="xs" c="dimmed">
              {t("Version {{current}} of {{latest}}", {
                current: data.appliedRevision ?? "—",
                latest: data.latestRevision ?? "—",
              })}
            </Text>
          </Group>
          <Group gap="xs" wrap="wrap">
            {provenanceBroken && (
              <Button
                size="compact-sm"
                variant="default"
                leftSection={<IconRefresh size={15} />}
                loading={isFetching}
                onClick={() => void refetch()}
              >
                {t("Retry")}
              </Button>
            )}
            {data.sourceTemplate?.spaceSlug && data.canReadTemplate && (
              <Button
                component={Link}
                to={buildPageUrl(
                  data.sourceTemplate.spaceSlug,
                  data.sourceTemplate.slugId,
                  data.sourceTemplate.title ?? undefined,
                )}
                size="compact-sm"
                variant="subtle"
                leftSection={<IconExternalLink size={15} />}
              >
                {t("Open template")}
              </Button>
            )}
            {data.canCreateIndependentCopy && (
              <Button
                size="compact-sm"
                variant="light"
                leftSection={<IconCopy size={15} />}
                loading={copying}
                onClick={() => void createIndependentCopy()}
              >
                {t("Create independent copy")}
              </Button>
            )}
            {canDetach && (
              <Button
                size="compact-sm"
                variant="default"
                color="red"
                leftSection={<IconLinkOff size={15} />}
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
        {data.provenanceState === "restricted" && (
          <Text size="xs" c="dimmed" mt={4}>
            {t(
              "The source template is restricted, but this page remains usable.",
            )}
          </Text>
        )}
        {provenanceBroken && (
          <Text size="xs" c="dimmed" mt={4}>
            {t(
              "This page remains available. Try loading its link status again.",
            )}
          </Text>
        )}
        {!provenanceBroken && data.status === "error" && (
          <Text size="xs" c="dimmed" mt={4}>
            {getTemplateSyncErrorLabel(data.lastErrorCode, t)}
          </Text>
        )}
      </Paper>

      <Modal
        opened={detachOpened}
        onClose={() => setDetachOpened(false)}
        title={t("Detach from linked template?")}
        centered
        closeButtonProps={{ "aria-label": t("Close") }}
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
              {t("Detach and keep this page")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function TemplateInstanceStatusBadge({
  status,
}: {
  status: TemplateInstanceStatus | undefined;
}) {
  const { t } = useTranslation();
  if (status === "syncing") {
    return (
      <Badge
        size="sm"
        color="blue"
        variant="light"
        c="var(--mantine-color-text)"
        aria-live="polite"
      >
        {t("Updating")}
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge
        size="sm"
        color="red"
        variant="light"
        c="var(--mantine-color-text)"
        aria-live="polite"
      >
        {t("Update failed")}
      </Badge>
    );
  }
  return (
    <Badge
      size="sm"
      color="green"
      variant="light"
      c="var(--mantine-color-text)"
      aria-live="polite"
    >
      {t("Up to date")}
    </Badge>
  );
}
