import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
  AiDatabaseResultCard,
  DatabaseFilterGroup,
} from "@docmost/api-contract";
import { getAiDatabaseResults } from "../services/ai-database-result-service";

export function AiDatabaseResultDetails({
  card,
}: {
  card: AiDatabaseResultCard;
}) {
  const { t, i18n } = useTranslation();
  const name = (id: string) =>
    id === "title" ? t("Title") : (card.receipt.propertyLabels[id] ?? id);
  const value = (input: unknown): string =>
    input == null
      ? t("dbTable.empty")
      : typeof input === "number"
        ? input.toLocaleString(i18n.language)
        : typeof input === "string"
          ? input
          : JSON.stringify(input);
  const filter = (group: DatabaseFilterGroup): string => {
    const conditions = group.conditions.map((condition) => {
      if ("conjunction" in condition) return filter(condition);
      const operand =
        condition.value === undefined ? "" : ` ${value(condition.value)}`;
      return `${name(condition.propertyId)} ${t(`dbTable.${condition.operator}`)}${operand}`;
    });
    return `(${conditions.join(` ${t(`dbTable.${group.conjunction}`)} `)})`;
  };
  const columnOrder = card.viewState.columnOrder ?? [];
  const columns = ["title", ...Object.keys(card.receipt.propertyLabels)]
    .filter(
      (id) => id === "title" || card.viewState.visibleColumns[id] !== false,
    )
    .sort((a, b) => {
      if (a === "title") return -1;
      if (b === "title") return 1;
      const position = (id: string) =>
        columnOrder.includes(id)
          ? columnOrder.indexOf(id)
          : columnOrder.length + (id === "title" ? 0 : 1);
      return position(a) - position(b);
    });
  return (
    <Stack gap={5} style={{ overflowWrap: "anywhere" }}>
      <Group gap="xs">
        <Text fw={600} size="sm">
          {card.receipt.databaseTitle}
        </Text>
        <Badge variant="light">{t("ai.database.results.serverResult")}</Badge>
      </Group>
      <Text size="sm">
        {card.summary
          ? t("ai.database.results.counted", { count: card.summary.count })
          : t("ai.database.results.returned", { count: card.returnedRows })}
      </Text>
      {card.summary &&
        Object.entries(card.summary.values).map(([id, result]) => (
          <Text key={id} size="sm">
            {name(id)} (
            {t(`dbTable.${card.viewState.calculations[id] ?? "count"}`)}):{" "}
            <strong>
              {card.receipt.calculationDisplays?.[id] || value(result)}
            </strong>
            {Boolean(card.summary?.errors?.[id]) &&
              ` · ${t("ai.database.results.errors", { count: card.summary!.errors![id] })}`}
          </Text>
        ))}
      {card.incomplete && (
        <Alert color="orange" p="xs">
          {t("ai.database.results.incomplete")}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        {t("ai.database.results.scope")}
      </Text>
      {card.receipt.selectedRowCount > 0 && (
        <Text size="xs">
          {t("ai.database.results.selected", {
            count: card.receipt.selectedRowCount,
          })}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {t("ai.database.results.asOf", {
          time: new Date(card.receipt.asOf).toLocaleString(i18n.language),
        })}
      </Text>
      <details>
        <summary style={{ cursor: "pointer" }}>
          {t("ai.database.results.conditions")}
        </summary>
        <Stack gap={5} mt="xs">
          <Text size="xs">
            {t("Filters")}:{" "}
            {card.viewState.filter?.conditions.length
              ? filter(card.viewState.filter)
              : t("ai.database.results.noFilters")}
          </Text>
          <Text size="xs">
            {t("Sort")}:{" "}
            {card.viewState.sorts.length
              ? card.viewState.sorts
                  .map(
                    (sort) =>
                      `${name(sort.propertyId)} (${t(sort.direction === "asc" ? "Ascending" : "Descending")})`,
                  )
                  .join(", ")
              : t("ai.database.results.viewOrder")}
          </Text>
          {card.viewState.groupBy && (
            <Text size="xs">
              {t("dbTable.groupBy")}: {name(card.viewState.groupBy)}
              {card.groupKey === undefined
                ? ""
                : ` = ${value(JSON.parse(card.groupKey))}`}
            </Text>
          )}
          <Text size="xs">
            {t("Columns")}: {columns.map(name).join(", ")}
          </Text>
        </Stack>
      </details>
    </Stack>
  );
}

export function AiDatabaseResults({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["ai", "database-results", runId],
    queryFn: () => getAiDatabaseResults(runId),
  });
  if (query.isPending)
    return (
      <Text size="xs" role="status">
        {t("ai.database.results.loading")}
      </Text>
    );
  if (query.isError)
    return (
      <Alert color="orange" p="xs">
        {t("ai.database.results.unavailable")}{" "}
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => void query.refetch()}
        >
          {t("Retry")}
        </Button>
      </Alert>
    );
  return (
    <Stack gap="xs">
      {query.data.map((card) => (
        <Paper
          key={card.stepId}
          withBorder
          p="sm"
          radius="sm"
          data-ai-database-result={card.stepId}
        >
          <Stack gap="sm">
            <AiDatabaseResultDetails card={card} />
            <Group gap="sm">
              {card.canOpenRows ? (
                <Button size="xs" component={Link} to={card.resultUrl}>
                  {t("ai.database.results.openRows")}
                </Button>
              ) : (
                <Text size="xs" c="dimmed">
                  {t("ai.database.results.queryDisabled")}
                </Text>
              )}
              <Anchor size="xs" component={Link} to={card.sourceUrl}>
                {t("ai.database.results.openSource")}
              </Anchor>
            </Group>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
