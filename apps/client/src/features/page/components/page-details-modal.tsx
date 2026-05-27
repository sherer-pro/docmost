import { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useAddPageLabelsMutation,
  useBacklinksCountQuery,
  useBacklinksQuery,
  usePageLabelsQuery,
  useRemovePageLabelMutation,
} from "@/features/page/queries/page-details-query";
import { buildPageUrl } from "@/features/page/page.utils";
import { BacklinkDirection } from "@/features/page/services/page-service";
import { IPage } from "@/features/page/types/page.types";
import { formattedDate } from "@/lib/time";
import { Trans } from "react-i18next";
import { useTimeAgo } from "@/hooks/use-time-ago";

interface PageDetailsModalProps {
  pageId: string;
  page?: Partial<IPage>;
  open: boolean;
  onClose: () => void;
  readOnly?: boolean;
}

function normalizeLabelInput(value: string): string {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

export default function PageDetailsModal({
  pageId,
  page,
  open,
  onClose,
  readOnly,
}: PageDetailsModalProps) {
  const { t } = useTranslation();
  const { data: labels } = usePageLabelsQuery(pageId, open);
  const { data: counts } = useBacklinksCountQuery(pageId, open);
  const addLabels = useAddPageLabelsMutation(pageId);
  const removeLabel = useRemovePageLabelMutation(pageId);
  const [labelInput, setLabelInput] = useState("");
  const pageUpdatedAt = useTimeAgo(page?.updatedAt ?? new Date());
  const creatorName = page?.creator?.name || t("Unknown");
  const lastUpdatedByName = page?.lastUpdatedBy?.name || t("Unknown");

  const submitLabel = () => {
    const nextLabel = normalizeLabelInput(labelInput);
    if (!nextLabel) {
      return;
    }

    addLabels.mutate([nextLabel], {
      onSuccess: () => setLabelInput(""),
    });
  };

  return (
    <Modal opened={open} onClose={onClose} title={t("Page details")} size="lg">
      <Stack gap="lg">
        {page && (
          <>
            <Stack gap={4}>
              <Text size="sm" c="dimmed" lineClamp={1}>
                <Trans
                  defaults="Created by: <b>{{creatorName}}</b>"
                  values={{ creatorName }}
                  components={{ b: <Text span fw={500} c="var(--mantine-color-text)" /> }}
                />
              </Text>
              {page.createdAt && (
                <Text size="sm" c="dimmed">
                  {t("Created at: {{time}}", {
                    time: formattedDate(new Date(page.createdAt)),
                  })}
                </Text>
              )}
              {page.updatedAt && (
                <Text size="sm" c="dimmed">
                  {t("Edited by {{name}} {{time}}", {
                    name: lastUpdatedByName,
                    time: pageUpdatedAt,
                  })}
                </Text>
              )}
            </Stack>
            <Divider />
          </>
        )}

        <Stack gap="xs">
          <Text fw={500}>{t("Labels")}</Text>
          <Group gap="xs">
            {(labels?.items ?? []).map((label) => (
              <Badge
                key={label.id}
                variant="light"
                rightSection={
                  readOnly ? null : (
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      aria-label={t("Remove label")}
                      onClick={() => removeLabel.mutate(label.id)}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  )
                }
              >
                {label.name}
              </Badge>
            ))}
            {labels?.items?.length === 0 && (
              <Text size="sm" c="dimmed">
                {t("No labels")}
              </Text>
            )}
          </Group>
          {!readOnly && (
            <Group gap="xs" align="flex-end">
              <TextInput
                size="xs"
                value={labelInput}
                onChange={(event) => setLabelInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitLabel();
                  }
                }}
                placeholder={t("Add label")}
              />
              <Button
                size="xs"
                leftSection={<IconPlus size={14} />}
                loading={addLabels.isPending}
                onClick={submitLabel}
              >
                {t("Add")}
              </Button>
            </Group>
          )}
        </Stack>

        <Tabs defaultValue="incoming">
          <Tabs.List>
            <Tabs.Tab value="incoming">
              {t("Backlinks")} ({counts?.incoming ?? 0})
            </Tabs.Tab>
            <Tabs.Tab value="outgoing">
              {t("Outgoing")} ({counts?.outgoing ?? 0})
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="incoming" pt="sm">
            <BacklinkList pageId={pageId} direction="incoming" open={open} />
          </Tabs.Panel>
          <Tabs.Panel value="outgoing" pt="sm">
            <BacklinkList pageId={pageId} direction="outgoing" open={open} />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}

function BacklinkList({
  pageId,
  direction,
  open,
}: {
  pageId: string;
  direction: BacklinkDirection;
  open: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useBacklinksQuery(pageId, direction, open);
  const pages = data?.items ?? [];

  if (isLoading) {
    return <Text c="dimmed">{t("Loading...")}</Text>;
  }

  if (pages.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t("No pages")}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {pages.map((page: Partial<IPage>) => (
        <Anchor
          key={page.id}
          component={Link}
          to={
            page.space?.slug && page.slugId
              ? buildPageUrl(page.space.slug, page.slugId, page.title)
              : "#"
          }
          underline="never"
        >
          <Text size="sm" c="var(--mantine-color-text)" truncate>
            {page.title || t("Untitled")}
          </Text>
          {page.space?.name && (
            <Text size="xs" c="dimmed" truncate>
              {page.space.name}
            </Text>
          )}
        </Anchor>
      ))}
    </Stack>
  );
}
