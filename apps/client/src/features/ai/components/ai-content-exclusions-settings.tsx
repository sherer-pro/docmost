import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconFileOff,
  IconFileText,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  useAiSpaceContentPolicyCandidatesQuery,
  useAiSpaceContentPolicyQuery,
  useUpdateAiSpaceContentPolicyMutation,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiContextSource,
  AiSpaceContentPolicy,
} from "@/features/ai/types/ai.types.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";

export function AiContentExclusionsSettings({ spaceId }: { spaceId: string }) {
  const { t, i18n } = useTranslation();
  const policyQuery = useAiSpaceContentPolicyQuery(spaceId);
  const updatePolicy = useUpdateAiSpaceContentPolicyMutation(spaceId);
  const [searchOpened, setSearchOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const candidates = useAiSpaceContentPolicyCandidatesQuery(
    spaceId,
    debouncedQuery,
  );
  const candidateItems = useMemo(
    () => candidates.data?.pages.flatMap((page) => page.items) ?? [],
    [candidates.data?.pages],
  );
  const excludedIds = useMemo(
    () => new Set(policyQuery.data?.exclusions.map((item) => item.pageId)),
    [policyQuery.data?.exclusions],
  );

  const persist = async (
    transform: (
      current: AiSpaceContentPolicy["exclusions"],
    ) => AiSpaceContentPolicy["exclusions"],
  ) => {
    const policy = policyQuery.data;
    if (!policy) return;
    try {
      await updatePolicy.mutateAsync({
        expectedRevision: policy.revision,
        exclusions: transform(policy.exclusions).map((item) => ({
          pageId: item.pageId,
          includeDescendants: item.includeDescendants,
        })),
      });
    } catch (error) {
      notifications.show({
        color: "red",
        message: resolveAiErrorMessage(
          t,
          i18n,
          error?.["response"]?.data?.code,
        ),
      });
      await policyQuery.refetch();
      throw error;
    }
  };

  const add = async (source: AiContextSource, includeDescendants: boolean) => {
    await persist((current) =>
      current.some((item) => item.pageId === source.pageId)
        ? current
        : [
            ...current,
            {
              pageId: source.pageId,
              title: source.title,
              icon: source.icon,
              breadcrumbs: source.breadcrumbs,
              includeDescendants,
              effectivePageCount: 1,
              available: true,
            },
          ],
    );
    setSearchOpened(false);
    setQuery("");
  };

  if (policyQuery.isLoading) {
    return (
      <Paper withBorder radius="md" p="md">
        <Group justify="center">
          <Loader size="sm" />
        </Group>
      </Paper>
    );
  }

  if (policyQuery.isError || !policyQuery.data) {
    return (
      <Alert color="red" title={t("ai.settings.exclusionsTitle")}>
        {t("ai.settings.exclusionsLoadFailed")}
      </Alert>
    );
  }

  return (
    <>
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group wrap="nowrap" align="flex-start">
            <IconFileOff size={20} />
            <Box flex={1}>
              <Text size="sm" fw={600}>
                {t("ai.settings.exclusionsTitle")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("ai.settings.exclusionsDescription")}
              </Text>
            </Box>
            <Badge variant="light">
              {policyQuery.data.exclusions.length}/100
            </Badge>
          </Group>

          {policyQuery.data.exclusions.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("ai.settings.exclusionsEmpty")}
            </Text>
          ) : (
            <Stack gap="xs">
              {policyQuery.data.exclusions.map((item) => (
                <Paper key={item.pageId} withBorder radius="sm" p="xs">
                  <Group wrap="nowrap">
                    <IconFileText size={16} />
                    <Box flex={1} miw={0}>
                      <Text size="sm" fw={500} truncate>
                        {item.title || t("ai.untitled")}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {item.breadcrumbs.join(" / ") ||
                          t("ai.context.spaceRoot")}
                        {" · "}
                        {t("ai.settings.exclusionsEffectiveCount", {
                          count: item.effectivePageCount,
                        })}
                      </Text>
                    </Box>
                    <Select
                      size="xs"
                      w={172}
                      allowDeselect={false}
                      value={item.includeDescendants ? "all" : "none"}
                      aria-label={t("ai.settings.exclusionsScope")}
                      data={[
                        {
                          value: "none",
                          label: t("ai.settings.exclusionsOnlyDocument"),
                        },
                        {
                          value: "all",
                          label: t("ai.settings.exclusionsWithDescendants"),
                        },
                      ]}
                      disabled={updatePolicy.isPending}
                      onChange={(value) =>
                        void persist((current) =>
                          current.map((candidate) =>
                            candidate.pageId === item.pageId
                              ? {
                                  ...candidate,
                                  includeDescendants: value === "all",
                                }
                              : candidate,
                          ),
                        ).catch(() => undefined)
                      }
                    />
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      color="red"
                      size={32}
                      disabled={updatePolicy.isPending}
                      aria-label={t("ai.settings.exclusionsRemove")}
                      onClick={() =>
                        void persist((current) =>
                          current.filter(
                            (candidate) => candidate.pageId !== item.pageId,
                          ),
                        ).catch(() => undefined)
                      }
                    >
                      <IconTrash size={15} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          <Group justify="space-between">
            <Text size="xs" c="dimmed" maw={560}>
              {t("ai.settings.exclusionsAsyncHint")}
            </Text>
            <Button
              type="button"
              size="compact-sm"
              variant="light"
              leftSection={<IconPlus size={14} />}
              disabled={
                policyQuery.data.exclusions.length >= 100 ||
                updatePolicy.isPending
              }
              onClick={() => setSearchOpened(true)}
            >
              {t("ai.settings.exclusionsAdd")}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Modal
        opened={searchOpened}
        onClose={() => setSearchOpened(false)}
        title={t("ai.settings.exclusionsAddTitle")}
        centered
        size="md"
      >
        <Stack gap="sm">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("ai.settings.exclusionsSearchPlaceholder")}
            leftSection={<IconSearch size={16} />}
            autoFocus
          />
          <ScrollArea h={360}>
            {candidates.isLoading ? (
              <Group justify="center" py="xl">
                <Loader size="sm" />
              </Group>
            ) : candidateItems.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                {query.trim()
                  ? t("ai.context.noResults")
                  : t("ai.settings.exclusionsSearchHint")}
              </Text>
            ) : (
              <Stack gap={4}>
                {candidateItems.map((source) => {
                  const disabled = excludedIds.has(source.pageId);
                  return (
                    <Paper key={source.pageId} withBorder radius="sm" p="xs">
                      <Group wrap="nowrap">
                        <Box flex={1} miw={0}>
                          <Text size="sm" fw={500} truncate>
                            {source.title || t("ai.untitled")}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {disabled
                              ? t("ai.settings.exclusionsAlreadyAdded")
                              : source.breadcrumbs.join(" / ") ||
                                t("ai.context.spaceRoot")}
                          </Text>
                        </Box>
                        <Button
                          type="button"
                          size="compact-xs"
                          variant="default"
                          disabled={disabled || updatePolicy.isPending}
                          onClick={() =>
                            void add(source, false).catch(() => undefined)
                          }
                        >
                          {t("ai.settings.exclusionsOnlyDocument")}
                        </Button>
                        <Button
                          type="button"
                          size="compact-xs"
                          disabled={disabled || updatePolicy.isPending}
                          onClick={() =>
                            void add(source, true).catch(() => undefined)
                          }
                        >
                          {t("ai.settings.exclusionsWithDescendants")}
                        </Button>
                      </Group>
                    </Paper>
                  );
                })}
                {candidates.hasNextPage && (
                  <Button
                    type="button"
                    variant="subtle"
                    loading={candidates.isFetchingNextPage}
                    onClick={() => void candidates.fetchNextPage()}
                  >
                    {t("ai.context.loadMore")}
                  </Button>
                )}
              </Stack>
            )}
          </ScrollArea>
        </Stack>
      </Modal>
    </>
  );
}
