import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconDotsVertical,
  IconLayoutKanban,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DatabaseSummary, DatabaseViewState } from "@docmost/api-contract";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useDatabaseRowsQuery,
  useBatchUpdateDatabaseCellsMutation,
} from "../queries/database-table-query";
import type { IDatabaseProperty, IDatabaseView } from "../types/database.types";
import type { IDatabaseRowWithCells } from "../types/database-table.types";
import {
  getDatabaseSelectSettings,
  extractCurrentDatabaseCellValue,
} from "../utils/database-cell-value";
import { getRowTitle } from "../utils/database-markdown";
import { DatabaseCellRenderer } from "./database-cell-renderer";
import api from "@/lib/api-client";
import classes from "./database-kanban-view.module.css";

type Props = {
  databaseId: string;
  spaceId: string;
  isEditable: boolean;
  view?: IDatabaseView;
  state: DatabaseViewState;
  properties: IDatabaseProperty[];
  summary?: DatabaseSummary;
  onChange: (state: DatabaseViewState) => void;
  onOpen: (row: IDatabaseRowWithCells, pageIds?: string[]) => void;
  selection: Record<string, boolean>;
  onSelect: (pageId: string, selected: boolean) => void;
};

export function DatabaseKanbanView(props: Props) {
  const { t } = useTranslation();
  const [dragged, setDragged] = useState<IDatabaseRowWithCells | null>(null);
  const property = props.properties.find(
    (p) => p.id === props.state.groupBy && p.type === "select",
  );
  const layout = props.state.kanban ?? {
    columnOrder: [],
    hiddenColumns: [],
    cardProperties: [],
  };
  const options = property ? getDatabaseSelectSettings(property).options : [];
  const columns = [
    { key: "null", value: null, label: t("dbBoard.emptyColumn") },
    ...options.map((o) => ({
      key: JSON.stringify(o.value),
      value: o.value,
      label: o.label,
    })),
  ];
  for (const group of props.summary?.groups ?? [])
    if (!columns.some((c) => c.key === group.key)) {
      try {
        columns.push({
          key: group.key,
          value: JSON.parse(group.key),
          label: group.label,
        });
      } catch {
        /* Invalid legacy keys are not rendered. */
      }
    }
  const initialOrder = columns.map((c) => c.key);
  columns.sort((a, b) => {
    const rank = (key: string) =>
      layout.columnOrder.includes(key)
        ? layout.columnOrder.indexOf(key)
        : layout.columnOrder.length + initialOrder.indexOf(key);
    return rank(a.key) - rank(b.key);
  });
  const updateLayout = (next: Partial<typeof layout>) =>
    props.onChange({
      ...props.state,
      version: 3,
      kanban: { ...layout, ...next },
    });
  return (
    <Stack className={classes.board}>
      <Group align="flex-start" className={classes.controls}>
        <Select
          w={220}
          label={t("dbTable.groupBy")}
          value={property?.id ?? null}
          data={props.properties
            .filter((p) => p.type === "select")
            .map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) =>
            props.onChange({
              ...props.state,
              version: 3,
              groupBy: id,
              kanban: { ...layout, columnOrder: [], hiddenColumns: [] },
            })
          }
        />
        <MultiSelect
          w={240}
          label={t("dbBoard.cardFields")}
          value={layout.cardProperties}
          data={props.properties
            .filter((p) => p.id !== property?.id)
            .map((p) => ({ value: p.id, label: p.name }))}
          onChange={(cardProperties) => updateLayout({ cardProperties })}
        />
        <MultiSelect
          label={t("dbBoard.hiddenColumns")}
          value={layout.hiddenColumns}
          data={columns.map((c) => ({ value: c.key, label: c.label }))}
          onChange={(hiddenColumns) => updateLayout({ hiddenColumns })}
        />
        {props.state.sorts.length > 0 && (
          <Text size="sm" c="dimmed">
            {t("dbBoard.sorted")}
          </Text>
        )}
      </Group>
      {!property ? (
        <EmptyState
          icon={IconLayoutKanban}
          title={t("dbBoard.selectRequired")}
        />
      ) : (
        <ScrollArea type="auto" scrollbars="x" offsetScrollbars="x">
          <Group
            align="flex-start"
            wrap="nowrap"
            gap="md"
            pb="md"
            role="region"
            aria-label={t("dbBoard.board")}
          >
            {columns
              .filter((c) => !layout.hiddenColumns.includes(c.key))
              .map((column, index) => (
                <Stack
                  key={column.key}
                  role="group"
                  aria-label={column.label}
                  gap="sm"
                  className={classes.column}
                >
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Text fw={600}>{column.label}</Text>
                      <Badge variant="light">
                        {props.summary?.groups.find((g) => g.key === column.key)
                          ?.count ?? 0}
                      </Badge>
                    </Group>
                    <Menu>
                      <Menu.Target>
                        <AccessibleActionIcon
                          label={t("dbBoard.columnActions")}
                          variant="subtle"
                        >
                          <IconDotsVertical size={16} />
                        </AccessibleActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {[-1, 1].map((delta) => (
                          <Menu.Item
                            key={delta}
                            leftSection={
                              delta < 0 ? (
                                <IconArrowUp size={14} />
                              ) : (
                                <IconArrowDown size={14} />
                              )
                            }
                            disabled={
                              index + delta < 0 ||
                              index + delta >= columns.length
                            }
                            onClick={() => {
                              const keys = columns.map((c) => c.key),
                                current = keys.indexOf(column.key),
                                target = current + delta;
                              if (target >= 0 && target < keys.length) {
                                [keys[current], keys[target]] = [
                                  keys[target],
                                  keys[current],
                                ];
                                updateLayout({ columnOrder: keys });
                              }
                            }}
                          >
                            {t(delta < 0 ? "Move left" : "Move right")}
                          </Menu.Item>
                        ))}
                        <Menu.Item
                          onClick={() =>
                            updateLayout({
                              hiddenColumns: [
                                ...layout.hiddenColumns,
                                column.key,
                              ],
                            })
                          }
                        >
                          {t("Hide")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                  <KanbanColumn
                    {...props}
                    column={column}
                    groupProperty={property}
                    cardProperties={layout.cardProperties}
                    columns={columns}
                    dragged={dragged}
                    onDrag={setDragged}
                  />
                </Stack>
              ))}
          </Group>
        </ScrollArea>
      )}
    </Stack>
  );
}

function KanbanColumn(
  props: Props & {
    column: { key: string; label: string; value: string | null };
    columns: Array<{ key: string; label: string; value: string | null }>;
    groupProperty: IDatabaseProperty;
    cardProperties: string[];
    dragged: IDatabaseRowWithCells | null;
    onDrag: (row: IDatabaseRowWithCells | null) => void;
  },
) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const rows = useDatabaseRowsQuery(props.databaseId, {
    viewState: JSON.stringify(props.state),
    viewId: props.view?.id,
    groupKey: props.column.key,
    limit: 30,
  });
  const update = useBatchUpdateDatabaseCellsMutation(props.databaseId);
  const move = useMutation({
    mutationFn: async ({
      row,
      value,
      before,
    }: {
      row: IDatabaseRowWithCells;
      value: string | null;
      before?: string;
    }) => {
      const cell = row.cells?.find(
        (c) => c.propertyId === props.groupProperty.id,
      );
      const current = extractCurrentDatabaseCellValue(cell?.value);
      if (JSON.stringify(current ?? null) !== JSON.stringify(value)) {
        await update.mutateAsync({
          pageId: row.pageId,
          payload: {
            cells: [
              {
                propertyId: props.groupProperty.id,
                value,
                expectedRevision: cell?.revision ?? 0,
              },
            ],
          },
        });
      } else if (props.view && !props.state.sorts.length) {
        await api.post(
          `/databases/${props.databaseId}/views/${props.view.id}/rows/actions/move`,
          {
            pageId: row.pageId,
            beforePageId: before,
            expectedPosition:
              row.viewPosition ?? row.pagePosition ?? row.page?.position ?? "",
            expectedViewRevision: props.view.revision ?? 1,
          },
        );
      }
    },
    onSettled: () => {
      props.onDrag(null);
      void client.invalidateQueries({
        queryKey: ["database", props.databaseId],
      });
    },
  });
  const items = rows.data?.items ?? [];
  const drop = (before?: string) => {
    if (
      props.dragged &&
      props.isEditable &&
      props.dragged.canWrite !== false &&
      props.dragged.pageId !== before
    )
      move.mutate({ row: props.dragged, value: props.column.value, before });
  };
  return (
    <ScrollArea h="min(65vh, 620px)" type="auto" offsetScrollbars>
      <Stack
        gap="xs"
        p="xs"
        style={{
          minHeight: "min(60vh, 560px)",
          border: "1px dashed var(--mantine-color-default-border)",
          borderRadius: 8,
        }}
        onDragOver={(event) => {
          if (props.dragged && props.isEditable) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          drop();
        }}
      >
        {rows.isError ? (
          <Button variant="subtle" onClick={() => void rows.refetch()}>
            {t("Retry")}
          </Button>
        ) : (
          items.map((row, index) => (
            <Paper
              key={row.pageId}
              withBorder
              p="sm"
              radius="md"
              draggable={
                props.isEditable && row.canWrite !== false && !move.isPending
              }
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.pageId);
                props.onDrag(row);
              }}
              onDragEnd={() => props.onDrag(null)}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                drop(row.pageId);
              }}
            >
              <Group wrap="nowrap" align="flex-start">
                <Checkbox
                  aria-label={t("Select row")}
                  checked={Boolean(props.selection[row.pageId])}
                  onChange={(event) =>
                    props.onSelect(row.pageId, event.currentTarget.checked)
                  }
                />
                <Button
                  variant="subtle"
                  color="gray"
                  styles={{
                    label: {
                      whiteSpace: "normal",
                      textAlign: "start",
                      color: "var(--mantine-color-text)",
                    },
                    root: { height: "auto", flex: 1, minWidth: 0 },
                  }}
                  onClick={() =>
                    props.onOpen(
                      row,
                      items.map((r) => r.pageId),
                    )
                  }
                >
                  {getRowTitle(row, t("untitled"))}
                </Button>
              </Group>
              {props.properties
                .filter((p) => props.cardProperties.includes(p.id))
                .map((property) => (
                  <Stack key={property.id} gap={2} mt="xs">
                    <Text size="xs" c="dimmed">
                      {property.name}
                    </Text>
                    <DatabaseCellRenderer
                      property={property}
                      value={extractCurrentDatabaseCellValue(
                        row.cells?.find((c) => c.propertyId === property.id)
                          ?.value,
                      )}
                      spaceId={props.spaceId}
                      isEditable={false}
                      isEditing={false}
                      editingValue={null}
                      onStartEdit={() => {}}
                      onChange={() => {}}
                      onSave={() => {}}
                    />
                  </Stack>
                ))}
              {props.isEditable && row.canWrite !== false && (
                <Group mt="sm" gap="xs">
                  <Select
                    size="xs"
                    aria-label={t("dbBoard.moveTo")}
                    data={props.columns.map((c) => ({
                      value: c.key,
                      label: c.label,
                    }))}
                    value={props.column.key}
                    disabled={move.isPending}
                    onChange={(key) => {
                      const target = props.columns.find((c) => c.key === key);
                      if (target) move.mutate({ row, value: target.value });
                    }}
                  />
                  {props.view && !props.state.sorts.length && index > 0 && (
                    <AccessibleActionIcon
                      label={t("Move up")}
                      disabled={move.isPending}
                      onClick={() =>
                        move.mutate({
                          row,
                          value: props.column.value,
                          before: items[index - 1].pageId,
                        })
                      }
                    >
                      <IconArrowUp size={16} />
                    </AccessibleActionIcon>
                  )}
                </Group>
              )}
            </Paper>
          ))
        )}
        {rows.isPending && <Text role="status">{t("Loading...")}</Text>}
        {!rows.isPending && !rows.isError && !items.length && (
          <Text size="sm" c="dimmed">
            {t("No results")}
          </Text>
        )}
        {rows.data?.hasMore && (
          <Button
            variant="default"
            loading={rows.isFetching}
            onClick={() => void rows.fetchNextPage()}
          >
            {t("Load more")}
          </Button>
        )}
        {move.isError && (
          <Text c="red" role="alert">
            {t("dbBoard.moveFailed")}
          </Text>
        )}
      </Stack>
    </ScrollArea>
  );
}
