import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { IconDatabase } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { formatDatabaseValue } from "@docmost/api-contract";
import { EmptyState } from "@/components/ui/empty-state";
import { getAiDatabaseResultRows } from "../services/ai-database-result-service";
import { AiDatabaseResultDetails } from "../components/ai-database-results";

export default function AiDatabaseResultsPage() {
  const { runId, stepId } = useParams();
  const { t, i18n } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: ["ai", "database-result-rows", runId, stepId],
    queryFn: ({ pageParam }) =>
      getAiDatabaseResultRows(runId!, stepId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
    enabled: Boolean(runId && stepId),
    retry: false,
  });
  const first = query.data?.pages[0];
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const order = first?.card.viewState.columnOrder ?? [];
  const properties = [...(first?.properties ?? [])].sort((a, b) => {
    const position = (id: string) =>
      order.includes(id) ? order.indexOf(id) : order.length;
    return position(a.id) - position(b.id);
  });
  const errorCode = (query.error as any)?.response?.data?.code;
  return (
    <Container
      size="xl"
      py="lg"
      w="100%"
      data-testid="ai-database-results-page"
    >
      <Stack>
        <Title order={2}>{t("ai.database.results.heading")}</Title>
        {query.isPending && (
          <Loader aria-label={t("ai.database.results.loading")} />
        )}
        {query.isError ? (
          <Alert color="orange" title={t("ai.database.results.unavailable")}>
            <Stack gap="xs">
              <Text size="sm">
                {t(
                  errorCode === "database_result_schema_changed"
                    ? "ai.database.results.schemaChanged"
                    : "ai.database.results.accessChanged",
                )}
              </Text>
              <Button variant="light" onClick={() => void query.refetch()}>
                {t("Retry")}
              </Button>
            </Stack>
          </Alert>
        ) : (
          first && (
            <>
              <AiDatabaseResultDetails card={first.card} />
              <Alert color="blue" p="sm">
                {t("ai.database.results.currentRows")}
              </Alert>
              <Group justify="space-between">
                <Anchor component={Link} to={first.card.sourceUrl}>
                  {t("ai.database.results.openSource")}
                </Anchor>
                <Button
                  variant="light"
                  loading={query.isRefetching}
                  onClick={() => void query.refetch()}
                >
                  {t("ai.database.results.refresh")}
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                {t("ai.database.results.rowsAsOf", {
                  time: new Date(first.asOf).toLocaleString(i18n.language),
                })}
              </Text>
              {rows.length ? (
                <>
                  <Text size="xs" c="dimmed">
                    {t("Scroll horizontally to see all columns")}
                  </Text>
                  <ScrollArea
                    type="auto"
                    tabIndex={0}
                    aria-label={t("ai.database.results.heading")}
                  >
                    <Table
                      withTableBorder
                      withColumnBorders
                      miw={Math.max(700, properties.length * 160)}
                    >
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t("Title")}</Table.Th>
                          {properties.map((property) => (
                            <Table.Th key={property.id}>
                              {property.name}
                            </Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {rows.map((row, index) => (
                          <Table.Tr
                            key={`${row.pageId}:${index}`}
                            data-ai-database-result-row={row.pageId}
                          >
                            <Table.Td
                              maw={300}
                              style={{ overflowWrap: "anywhere" }}
                            >
                              {row.title}
                            </Table.Td>
                            {properties.map((property) => (
                              <Table.Td
                                key={property.id}
                                maw={300}
                                style={{
                                  whiteSpace: "pre-wrap",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {formatDatabaseValue(
                                  property.type,
                                  row.cells.find(
                                    (cell) => cell.propertyId === property.id,
                                  )?.value,
                                  property.settings,
                                  i18n.language,
                                )}
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </>
              ) : (
                <EmptyState
                  icon={IconDatabase}
                  title={t("ai.database.results.noRows")}
                />
              )}
              {query.hasNextPage && (
                <Button
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("Load more")}
                </Button>
              )}
            </>
          )
        )}
      </Stack>
    </Container>
  );
}
