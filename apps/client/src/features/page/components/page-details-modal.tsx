import { type ReactNode, useMemo, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  TagsInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCalendar,
  IconCheck,
  IconFileDescription,
  IconMinus,
  IconPencil,
  IconPlus,
  IconTemplate,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useAddPageLabelsMutation,
  useBacklinksCountQuery,
  useBacklinksQuery,
  usePageLabelsQuery,
  usePageTemplateProvenanceQuery,
  useRemovePageLabelMutation,
} from "@/features/page/queries/page-details-query";
import { buildPageUrl } from "@/features/page/page.utils";
import { BacklinkDirection } from "@/features/page/services/page-service";
import { IPage } from "@/features/page/types/page.types";
import { formattedDate } from "@/lib/time";
import { useSearchLabelsQuery } from "@/features/search/queries/search-query";
import { getPageIcon } from "@/lib/utils";

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
  const { data: labels, isLoading: labelsLoading } = usePageLabelsQuery(
    pageId,
    open,
  );
  const { data: counts, isLoading: countsLoading } = useBacklinksCountQuery(
    pageId,
    open,
  );
  const {
    data: templateProvenance,
    isLoading: provenanceLoading,
    isError: provenanceError,
  } = usePageTemplateProvenanceQuery(pageId, open);
  const removeLabel = useRemovePageLabelMutation(pageId);
  const creatorName = page?.creator?.name || t("Unknown");
  const lastUpdatedByName = page?.lastUpdatedBy?.name || t("Unknown");
  const pageStats = useMemo(
    () =>
      getPageTextStats((page as { content?: unknown } | undefined)?.content),
    [page],
  );

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={t("Page details")}
      size="xl"
      centered
      radius="md"
      overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <Stack gap="md">
        <Paper withBorder radius="md" p="md">
          <Group wrap="nowrap" align="flex-start">
            <ThemeIcon size={44} radius="md" variant="light" color="gray">
              {getPageIcon(page?.icon ?? "", 24)}
            </ThemeIcon>
            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
              <Text fw={650} size="lg" lineClamp={1}>
                {page?.title || t("Untitled")}
              </Text>
              {page?.space?.name && (
                <Text size="sm" c="dimmed" lineClamp={1}>
                  {page.space.name}
                </Text>
              )}
            </Stack>
          </Group>
        </Paper>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TemplateStatus
            icon={<IconTemplate size={20} />}
            label={t("Template status")}
            active={Boolean(page?.templateKind)}
            activeText={
              page?.templateKind === "synced"
                ? t("Synchronized template")
                : t("Regular template")
            }
            inactiveText={t("Regular page")}
            description={
              page?.templateKind
                ? t("Changes to this page affect future pages created from it.")
                : t("This page is not used as a template.")
            }
          />
          <TemplateStatus
            icon={<IconFileDescription size={20} />}
            label={t("Created from template")}
            active={
              provenanceError
                ? undefined
                : templateProvenance?.createdFromTemplate
            }
            loading={provenanceLoading}
            activeText={t("Yes, created from a template")}
            inactiveText={t("No, created without a template")}
            unavailableText={t("Status unavailable")}
            description={
              templateProvenance?.createdFromTemplate
                ? t("The page started as a snapshot of a template.")
                : t("No source template is associated with this page.")
            }
          >
            {templateProvenance?.sourceTemplate?.spaceSlug && (
              <Anchor
                component={Link}
                to={buildPageUrl(
                  templateProvenance.sourceTemplate.spaceSlug,
                  templateProvenance.sourceTemplate.slugId,
                  templateProvenance.sourceTemplate.title ?? undefined,
                )}
                size="sm"
                fw={500}
              >
                {t("Source template: {{title}}", {
                  title:
                    templateProvenance.sourceTemplate.title || t("Untitled"),
                })}
              </Anchor>
            )}
          </TemplateStatus>
        </SimpleGrid>

        <Tabs
          defaultValue="overview"
          keepMounted={false}
          styles={{ tab: { minWidth: 0, paddingInline: 6 } }}
        >
          <Tabs.List grow>
            <Tabs.Tab value="overview">{t("Overview")}</Tabs.Tab>
            <Tabs.Tab value="incoming">
              {t("Incoming")} ({counts?.incoming ?? 0})
            </Tabs.Tab>
            <Tabs.Tab value="outgoing">
              {t("Outgoing")} ({counts?.outgoing ?? 0})
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <Stack gap="md">
              {page && (
                <Paper withBorder radius="md" p="md">
                  <Text fw={600} mb="sm">
                    {t("Page activity")}
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <DetailItem
                      icon={<IconUser size={18} />}
                      label={t("Created by")}
                    >
                      {creatorName}
                    </DetailItem>
                    {page.createdAt && (
                      <DetailItem
                        icon={<IconCalendar size={18} />}
                        label={t("Created at")}
                      >
                        {formattedDate(new Date(page.createdAt))}
                      </DetailItem>
                    )}
                    {page.updatedAt && (
                      <DetailItem
                        icon={<IconPencil size={18} />}
                        label={t("Last edited")}
                      >
                        {t("Edited by {{name}} {{time}}", {
                          name: lastUpdatedByName,
                          time: formattedDate(new Date(page.updatedAt)),
                        })}
                      </DetailItem>
                    )}
                  </SimpleGrid>
                </Paper>
              )}

              <Paper withBorder radius="md" p="md">
                <Text fw={600} mb="sm">
                  {t("Content statistics")}
                </Text>
                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
                  <Stat label={t("Words")} value={pageStats.words} />
                  <Stat label={t("Characters")} value={pageStats.characters} />
                  <Stat
                    label={t("Backlinks")}
                    value={counts?.incoming ?? 0}
                    loading={countsLoading}
                  />
                  <Stat
                    label={t("Outgoing")}
                    value={counts?.outgoing ?? 0}
                    loading={countsLoading}
                  />
                </SimpleGrid>
              </Paper>

              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text fw={600}>{t("Labels")}</Text>
                  {labelsLoading ? (
                    <Skeleton height={24} width="40%" />
                  ) : (
                    <Group gap="xs">
                      {(labels?.items ?? []).map((label) => (
                        <Group key={label.id} gap={2}>
                          <Badge
                            color={getLabelColor(label.name)}
                            variant="light"
                            style={{
                              color:
                                "light-dark(var(--mantine-color-dark-9), var(--mantine-color-gray-0))",
                            }}
                          >
                            {label.name}
                          </Badge>
                          {!readOnly && (
                            <ActionIcon
                              size={32}
                              variant="subtle"
                              aria-label={t("Remove label")}
                              onClick={() => removeLabel.mutate(label.id)}
                            >
                              <IconX size={16} />
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
                  )}
                  {!readOnly && (
                    <LabelPicker
                      pageId={pageId}
                      spaceId={page?.spaceId}
                      existingLabelNames={(labels?.items ?? []).map(
                        (label) => label.name,
                      )}
                    />
                  )}
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="incoming" pt="md">
            <BacklinkList pageId={pageId} direction="incoming" open={open} />
          </Tabs.Panel>
          <Tabs.Panel value="outgoing" pt="md">
            <BacklinkList pageId={pageId} direction="outgoing" open={open} />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}

function TemplateStatus({
  icon,
  label,
  active,
  loading,
  activeText,
  inactiveText,
  unavailableText,
  description,
  children,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  loading?: boolean;
  activeText: string;
  inactiveText: string;
  unavailableText?: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Group wrap="nowrap" align="flex-start">
        <ThemeIcon
          color={active ? "teal" : "gray"}
          variant="light"
          radius="xl"
          size="lg"
        >
          {icon}
        </ThemeIcon>
        <Stack gap={5} style={{ minWidth: 0, flex: 1 }}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            {label}
          </Text>
          {loading ? (
            <Skeleton height={22} width="70%" />
          ) : (
            <Badge
              color={active === undefined ? "gray" : active ? "teal" : "gray"}
              variant={active ? "filled" : "light"}
              leftSection={
                active ? <IconCheck size={12} /> : <IconMinus size={12} />
              }
              style={{ alignSelf: "flex-start" }}
            >
              {active === undefined
                ? unavailableText
                : active
                  ? activeText
                  : inactiveText}
            </Badge>
          )}
          {!loading && active !== undefined && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
          {children}
        </Stack>
      </Group>
    </Paper>
  );
}

function DetailItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <Group wrap="nowrap" align="flex-start" gap="sm">
      <ThemeIcon variant="light" color="gray" size="lg" radius="xl">
        {icon}
      </ThemeIcon>
      <Stack gap={1} style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="sm">{children}</Text>
      </Stack>
    </Group>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {loading ? (
        <Skeleton height={24} width={48} />
      ) : (
        <Text fw={650} size="lg">
          {value.toLocaleString()}
        </Text>
      )}
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
    const names = [...pendingLabels, search]
      .map(normalizeLabelInput)
      .filter((label, index, labels) => {
        return label && !existing.has(label) && labels.indexOf(label) === index;
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
