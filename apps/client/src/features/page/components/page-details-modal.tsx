import { useMemo, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TagsInput,
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
import { useSearchLabelsQuery } from "@/features/search/queries/search-query";

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

const LABEL_COLORS = [
  "blue",
  "green",
  "violet",
  "red",
  "yellow",
  "orange",
  "pink",
  "gray",
  "cyan",
  "teal",
] as const;

function getLabelColor(labelName: string): string {
  let hash = 0;
  const input = labelName.trim().toLowerCase();

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

function extractTextFromDoc(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    try {
      return extractTextFromDoc(JSON.parse(value));
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(extractTextFromDoc).filter(Boolean).join(" ");
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }

  return extractTextFromDoc(record.content);
}

function getPageTextStats(content: unknown) {
  const text = extractTextFromDoc(content).replace(/\s+/g, " ").trim();
  const words = text ? text.split(/\s+/u).length : 0;

  return {
    characters: text.length,
    words,
  };
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
  const removeLabel = useRemovePageLabelMutation(pageId);
  const pageUpdatedAt = useTimeAgo(page?.updatedAt ?? new Date());
  const creatorName = page?.creator?.name || t("Unknown");
  const lastUpdatedByName = page?.lastUpdatedBy?.name || t("Unknown");
  const pageStats = useMemo(
    () => getPageTextStats((page as { content?: unknown } | undefined)?.content),
    [page],
  );

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={t("Page details")}
      size="lg"
      closeButtonProps={{ "aria-label": t("Close") }}
    >
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

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Stat label={t("Words")} value={pageStats.words} />
          <Stat label={t("Characters")} value={pageStats.characters} />
          <Stat label={t("Backlinks")} value={counts?.incoming ?? 0} />
          <Stat label={t("Outgoing")} value={counts?.outgoing ?? 0} />
        </SimpleGrid>

        <Stack gap="xs">
          <Text fw={500}>{t("Labels")}</Text>
          <Group gap="xs">
            {(labels?.items ?? []).map((label) => (
              <Group key={label.id} gap={2}>
                <Badge
                  color={getLabelColor(label.name)}
                  variant="light"
                >
                  {label.name}
                </Badge>
                {!readOnly && (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    aria-label={t("Remove label")}
                    onClick={() => removeLabel.mutate(label.id)}
                  >
                    <IconX size={12} />
                  </ActionIcon>
                )}
              </Group>
            ))}
            {labels?.items?.length === 0 && (
              <Text size="sm" c="dimmed">
                {t("No labels")}
              </Text>
            )}
          </Group>
          {!readOnly && (
            <LabelPicker
              pageId={pageId}
              spaceId={page?.spaceId}
              existingLabelNames={(labels?.items ?? []).map((label) => label.name)}
            />
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value.toLocaleString()}</Text>
    </Stack>
  );
}

function LabelPicker({
  pageId,
  spaceId,
  existingLabelNames,
}: {
  pageId: string;
  spaceId?: string;
  existingLabelNames: string[];
}) {
  const { t } = useTranslation();
  const [pendingLabels, setPendingLabels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const addLabels = useAddPageLabelsMutation(pageId);
  const { data: suggestedLabels = [] } = useSearchLabelsQuery(
    { query: search, limit: 20, spaceId },
    Boolean(spaceId),
  );
  const existing = new Set(existingLabelNames.map(normalizeLabelInput));
  const labelOptions = suggestedLabels
    .map((label) => label.name)
    .filter((label) => !existing.has(normalizeLabelInput(label)));

  const submitLabels = () => {
    const names = [
      ...pendingLabels,
      search,
    ]
      .map(normalizeLabelInput)
      .filter((label, index, labels) => {
        return (
          label &&
          !existing.has(label) &&
          labels.indexOf(label) === index
        );
      });

    if (names.length === 0) {
      return;
    }

    addLabels.mutate(names, {
      onSuccess: () => {
        setPendingLabels([]);
        setSearch("");
      },
    });
  };

  return (
    <Group gap="xs" align="flex-end">
      <TagsInput
        size="xs"
        value={pendingLabels}
        data={labelOptions}
        searchValue={search}
        onSearchChange={setSearch}
        onChange={setPendingLabels}
        placeholder={t("Add label")}
        aria-label={t("Add label")}
      />
      <Button
        size="xs"
        leftSection={<IconPlus size={14} />}
        loading={addLabels.isPending}
        onClick={submitLabels}
      >
        {t("Add")}
      </Button>
    </Group>
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
